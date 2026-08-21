"""Histórico de alertas disparados."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentUser, get_current_user, resolve_target_user
from app.database import get_db
from app.models import Alert, AlertType, Competitor, CompetitorTracker
from app.schemas.alert import AlertCountsOut, AlertListOut, AlertOut
from app.services import alert_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Mesmo agrupamento usado na aba Alertas do frontend (components/Badges.jsx
# ALERT_CATEGORIES) — duplicado aqui de propósito porque quem filtra e conta
# agora é o backend (paginação de verdade exige isso; filtrar categoria só
# no que já veio na página não dá pra achar nada fora da primeira leva —
# ver commit que corrigiu o "sumiço" de alerta antigo depois de uma rajada
# de "novo anúncio" enterrar tudo além do limite antigo de 100-200 linhas).
# Se mudar de um lado, muda do outro.
ALERT_CATEGORY_TYPES: dict[str, list[AlertType]] = {
    "produto": [AlertType.NEW_PRODUCT, AlertType.PRODUCT_REMOVED],
    "fornecedor": [AlertType.VENDOR_CHANGED, AlertType.SUPPLIER_ID_CHANGED],
    "anuncios": [AlertType.NEW_AD, AlertType.WINNING_AD, AlertType.AD_KILLED],
    "escala": [AlertType.SCALING_DETECTED, AlertType.DUPLICATE_DETECTED, AlertType.VARIATIONS_ADDED],
    "preco_estoque": [AlertType.PRICE_CHANGE, AlertType.STOCK_CHANGE],
    "outros": [AlertType.NOT_SHOPIFY, AlertType.TITLE_CHANGE, AlertType.IMAGE_CHANGE, AlertType.URGENCY_DETECTED],
}


def _base_query(db: Session, target_user: int, competitor_id: int | None, operation: str | None):
    query = (
        db.query(Alert)
        .join(Competitor, Competitor.id == Alert.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == target_user)
    )
    if competitor_id:
        query = query.filter(Alert.competitor_id == competitor_id)
    if operation:
        query = query.filter(Competitor.operation == operation)
    return query


@router.get("", response_model=AlertListOut)
def list_alerts(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    category: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_user = resolve_target_user(current_user, as_user_id)
    query = _base_query(db, target_user, competitor_id, operation).options(
        selectinload(Alert.ad), selectinload(Alert.competitor), selectinload(Alert.product)
    )
    if category and category in ALERT_CATEGORY_TYPES:
        query = query.filter(Alert.alert_type.in_(ALERT_CATEGORY_TYPES[category]))

    # `total` conta ANTES do limit/offset — sem isso a tela não sabe quantas
    # páginas existem, e um filtro de categoria (ex: "Sinais de escala") só
    # acharia o que já estivesse na primeira leva, deixando alerta antigo de
    # verdade inacessível pra sempre na prática.
    total = query.order_by(None).count()
    items = (
        query.order_by(Alert.created_at.desc()).limit(limit).offset((page - 1) * limit).all()
    )
    return AlertListOut(items=items, total=total)


@router.get("/counts", response_model=AlertCountsOut)
def alert_counts(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Contagem por categoria pros botões de filtro da aba Alertas — calculada
    no banco sobre TODO o histórico, não só na página carregada (mesma razão
    do endpoint acima)."""
    target_user = resolve_target_user(current_user, as_user_id)
    base = _base_query(db, target_user, competitor_id, operation)
    by_category = {key: base.filter(Alert.alert_type.in_(types)).count() for key, types in ALERT_CATEGORY_TYPES.items()}
    return AlertCountsOut(total=base.order_by(None).count(), by_category=by_category)


@router.post("/test", response_model=AlertOut, status_code=201)
async def send_test_alert(
    competitor_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cria um alerta de teste de verdade (aparece na aba Alertas igual
    qualquer outro) e dispara pro Discord — só pra confirmar que a notificação
    tá saindo, sem precisar esperar um evento real acontecer numa loja."""
    owned = (
        db.query(Competitor)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == current_user.id)
    )
    competitor = (
        owned.filter(Competitor.id == competitor_id).first() if competitor_id else owned.order_by(Competitor.id).first()
    )
    if not competitor:
        raise HTTPException(400, "Cadastra pelo menos um concorrente antes de testar o alerta")

    alert = await alert_service.create_alert(
        db,
        competitor,
        AlertType.NEW_PRODUCT,
        "🧪 Alerta de teste — se essa mensagem chegou no Discord, a notificação tá funcionando.",
    )
    db.commit()
    db.refresh(alert)
    return alert
