"""Resumo pro Dashboard do frontend."""

from collections import defaultdict
from datetime import date as date_, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentUser, get_current_user, resolve_target_user
from app.database import get_db
from app.models import (
    Ad,
    Alert,
    Competitor,
    CompetitorStatus,
    CompetitorTracker,
    Product,
    ProductEvent,
    ProductEventType,
    ProductScore,
)
from app.schemas.dashboard import DashboardSummary
from app.services.scoring_service import score_label

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Mesmo fuso usado em todo o resto do app pro usuário (utils/date.js no
# frontend) — bucket por dia tem que ser dia de Brasília, não dia UTC, senão
# um produto novo às 22h de Brasília (01h UTC do dia seguinte) contaria pro
# dia errado no gráfico.
BRASILIA_TZ = ZoneInfo("America/Sao_Paulo")


def _resolve_date_range(
    days: int, start_date: date_ | None, end_date: date_ | None
) -> tuple[date_, date_]:
    """Período custom (início+fim) tem prioridade sobre o preset `days` — a
    tela só manda os dois juntos quando a pessoa escolheu um range manual."""
    today_local = datetime.now(BRASILIA_TZ).date()
    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(400, "Data de início não pode ser depois da data de fim")
        return start_date, end_date
    return today_local - timedelta(days=days - 1), today_local


def _daterange(start: date_, end: date_):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    operation: str | None = None,
    as_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_user = resolve_target_user(current_user, as_user_id)
    since = datetime.now(timezone.utc) - timedelta(hours=24)

    competitors_query = (
        db.query(Competitor)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == target_user)
    )
    products_query = (
        db.query(Product)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == target_user)
    )
    alerts_query = (
        db.query(Alert)
        .join(Competitor, Competitor.id == Alert.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == target_user)
    )
    if operation:
        competitors_query = competitors_query.filter(Competitor.operation == operation)
        products_query = products_query.filter(Competitor.operation == operation)
        alerts_query = alerts_query.filter(Competitor.operation == operation)

    total_competitors = competitors_query.count()
    active_competitors = competitors_query.filter(Competitor.status == CompetitorStatus.ACTIVE).count()
    total_products = products_query.filter(Product.is_active.is_(True)).count()
    scaling_products = products_query.filter(Product.is_active.is_(True), Product.scaling.is_(True)).count()
    alerts_last_24h = alerts_query.filter(Alert.created_at >= since).count()
    recent_alerts = (
        alerts_query.options(selectinload(Alert.ad), selectinload(Alert.competitor), selectinload(Alert.product))
        .order_by(Alert.created_at.desc())
        .limit(3)
        .all()
    )

    return DashboardSummary(
        total_competitors=total_competitors,
        active_competitors=active_competitors,
        total_products=total_products,
        scaling_products=scaling_products,
        alerts_last_24h=alerts_last_24h,
        recent_alerts=recent_alerts,
    )


@router.get("/new-products-timeline")
def new_products_timeline(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    days: int = Query(30, ge=1, le=360),
    start_date: date_ | None = None,
    end_date: date_ | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Quantos produtos novos cada dia. Preenche TODO dia do intervalo (inclusive
    os com 0) pra linha mostrar queda de verdade, não um buraco.
    """
    target_user = resolve_target_user(current_user, as_user_id)
    range_start, range_end = _resolve_date_range(days, start_date, end_date)
    since = datetime.combine(range_start, datetime.min.time(), tzinfo=BRASILIA_TZ).astimezone(timezone.utc)

    query = (
        db.query(ProductEvent.created_at)
        .join(Product, Product.id == ProductEvent.product_id)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(
            ProductEvent.event_type == ProductEventType.NEW_PRODUCT,
            ProductEvent.created_at >= since,
            CompetitorTracker.user_id == target_user,
        )
    )
    if competitor_id:
        query = query.filter(Product.competitor_id == competitor_id)
    elif operation:
        query = query.filter(Competitor.operation == operation)

    counts: dict[date_, int] = defaultdict(int)
    for (created_at,) in query.all():
        aware = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        counts[aware.astimezone(BRASILIA_TZ).date()] += 1

    return [{"date": d.isoformat(), "count": counts.get(d, 0)} for d in _daterange(range_start, range_end)]


@router.get("/ads-timeline")
def ads_timeline(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    days: int = Query(30, ge=1, le=360),
    start_date: date_ | None = None,
    end_date: date_ | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Anúncios por dia, quebrado por plataforma — usa `started_at` (data real
    da biblioteca quando dá pra parsear, senão hora que a gente viu pela
    primeira vez — mesmo campo/critério já usado em toda parte do app, ver
    scrapers/meta_ads.py). Ajuda a ver se o concorrente tá subindo criativo
    com mais frequência.
    """
    target_user = resolve_target_user(current_user, as_user_id)
    range_start, range_end = _resolve_date_range(days, start_date, end_date)
    since = datetime.combine(range_start, datetime.min.time(), tzinfo=BRASILIA_TZ).astimezone(timezone.utc)

    query = (
        db.query(Ad.started_at, Ad.platform)
        .join(Competitor, Competitor.id == Ad.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(Ad.started_at >= since, CompetitorTracker.user_id == target_user)
    )
    if competitor_id:
        query = query.filter(Ad.competitor_id == competitor_id)
    elif operation:
        query = query.filter(Competitor.operation == operation)

    counts: dict[date_, dict[str, int]] = defaultdict(lambda: {"meta": 0, "google": 0, "tiktok": 0})
    for started_at, platform in query.all():
        aware = started_at if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
        d = aware.astimezone(BRASILIA_TZ).date()
        if range_start <= d <= range_end:
            counts[d][platform.value] += 1

    return [
        {"date": d.isoformat(), **counts.get(d, {"meta": 0, "google": 0, "tiktok": 0})}
        for d in _daterange(range_start, range_end)
    ]


@router.get("/score-distribution")
def score_distribution(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Quantos produtos ativos em cada faixa de score (Frio/Morno/Quente/
    Escalando) AGORA — não é série temporal, é raio-x do momento. Usa o
    score mais recente de cada produto (mesma lógica de /api/products/hot).
    """
    target_user = resolve_target_user(current_user, as_user_id)
    query = (
        db.query(ProductScore)
        .join(Product, Product.id == ProductScore.product_id)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(Product.is_active.is_(True), CompetitorTracker.user_id == target_user)
    )
    if competitor_id:
        query = query.filter(Product.competitor_id == competitor_id)
    elif operation:
        query = query.filter(Competitor.operation == operation)

    latest_by_product: dict[int, int] = {}
    for row in query.order_by(ProductScore.product_id, ProductScore.date.desc()).all():
        latest_by_product.setdefault(row.product_id, row.score)

    buckets = {"Frio": 0, "Morno": 0, "Quente": 0, "Escalando": 0}
    for score in latest_by_product.values():
        buckets[score_label(score)] += 1

    return [{"label": label, "count": count} for label, count in buckets.items()]
