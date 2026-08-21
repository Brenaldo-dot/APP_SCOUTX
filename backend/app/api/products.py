"""Produtos descobertos por loja + histórico de eventos e score."""

from typing import Literal

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentUser, get_current_user, resolve_target_user
from app.database import get_db
from app.models import Ad, AdStatus, Competitor, CompetitorTracker, Product, ProductScore
from app.scrapers.http_client import build_async_client
from app.schemas.product import HotProductListOut, HotProductOut, ProductDetailOut, ProductListOut, ProductOut
from app.services.scoring_service import score_label

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=ProductListOut)
def list_products(
    competitor_id: int | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    scaling_only: bool = False,
    active_only: bool = True,
    sort: Literal["recent", "duplicates"] = "recent",
    page: int = Query(1, ge=1),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    # Sempre junta com o rastreador desse usuário (multi-tenant, dado
    # compartilhado — ver models/competitor.py:CompetitorTracker) — não é
    # mais opcional como o filtro de `operation`, então entra incondicional.
    target_user = resolve_target_user(current_user, as_user_id)
    query = (
        db.query(Product)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == target_user)
    )
    if competitor_id:
        query = query.filter(Product.competitor_id == competitor_id)
    if operation:
        query = query.filter(Competitor.operation == operation)
    if scaling_only:
        query = query.filter(Product.scaling.is_(True))
    if active_only:
        query = query.filter(Product.is_active.is_(True))

    if sort == "duplicates":
        # Só quem tem duplicata de verdade — sem isso a lista ficaria cheia
        # de produto com 0 duplicatas lá embaixo, o que não é o que se quer
        # ao pedir "os mais duplicados primeiro".
        query = query.filter(Product.duplicate_count > 0).order_by(
            Product.duplicate_count.desc(), Product.last_seen_at.desc()
        )
    else:
        query = query.order_by(Product.last_seen_at.desc())

    # `total` conta ANTES do limit/offset — sem isso a tela não tem como
    # saber quantas páginas existem pra montar "Próxima" (o app tem milhares
    # de produto hoje, 500 por página não dava pra ver o resto de jeito nenhum).
    total = query.order_by(None).count()
    items = query.limit(limit).offset((page - 1) * limit).all()
    return ProductListOut(items=items, total=total)


@router.get("/hot", response_model=HotProductListOut)
def list_hot_products(
    min_score: int = Query(56, ge=0, le=100),
    operation: str | None = None,
    as_user_id: int | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Módulo 8.2 — "Produtos Quentes": score >= 56 (Quente ou Escalando),
    ordenado decrescente. Precisa ficar ANTES de /{product_id} no arquivo —
    senão o FastAPI tenta converter "hot" pra int e devolve 422 em vez de
    cair aqui.

    Usa o score mais recente já calculado por produto (não exige que seja
    "hoje"): no setup local sem Celery Beat, o score só é recalculado quando
    alguém roda o snapshot diário manualmente, então travar em `date==hoje`
    faria essa tela voltar vazia sempre que o último cálculo foi ontem.
    """
    target_user = resolve_target_user(current_user, as_user_id)
    latest_by_product: dict[int, ProductScore] = {}
    rows_query = (
        db.query(ProductScore)
        .join(Product, Product.id == ProductScore.product_id)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(Product.is_active.is_(True), CompetitorTracker.user_id == target_user)
    )
    if operation:
        rows_query = rows_query.filter(Competitor.operation == operation)
    rows = rows_query.order_by(ProductScore.product_id, ProductScore.date.desc()).all()
    for row in rows:
        latest_by_product.setdefault(row.product_id, row)

    qualifying_all = sorted(
        (row for row in latest_by_product.values() if row.score >= min_score),
        key=lambda row: row.score,
        reverse=True,
    )
    total = len(qualifying_all)
    qualifying = qualifying_all[(page - 1) * limit : (page - 1) * limit + limit]

    product_ids = [row.product_id for row in qualifying]
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids))}

    # Anúncios ativos de todos os produtos da página numa query só (não uma
    # por produto) — usuário pediu pra ver anúncio direto no card de
    # Produtos Quentes; buscar um por um faria a tela demorar N requests.
    ads_by_product: dict[int, list[Ad]] = {}
    if product_ids:
        ad_rows = (
            db.query(Ad)
            .filter(Ad.product_id.in_(product_ids), Ad.status == AdStatus.ACTIVE)
            .order_by(Ad.product_id, Ad.started_at.desc())
            .all()
        )
        for ad in ad_rows:
            ads_by_product.setdefault(ad.product_id, []).append(ad)

    results = []
    for row in qualifying:
        product = products.get(row.product_id)
        if not product:
            continue
        product_ads = ads_by_product.get(product.id, [])
        results.append(
            HotProductOut(
                **ProductOut.model_validate(product).model_dump(),
                score=row.score,
                score_label=score_label(row.score),
                signals=row.signals,
                score_date=row.date,
                active_ad_count=len(product_ads),
                latest_ad_library_url=product_ads[0].library_url if product_ads else None,
            )
        )
    return HotProductListOut(items=results, total=total)


def _product_owned_query(db: Session, user_id: int):
    return (
        db.query(Product)
        .join(Competitor, Competitor.id == Product.competitor_id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id == user_id)
    )


@router.get("/{product_id}", response_model=ProductDetailOut)
def get_product(
    product_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    product = (
        _product_owned_query(db, current_user.id)
        .options(selectinload(Product.events), selectinload(Product.scores))
        .filter(Product.id == product_id)
        .first()
    )
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return product


@router.get("/{product_id}/preview")
async def preview_product_page(
    product_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    """
    Devolve a página REAL do produto, buscada no servidor e reservida a
    partir do NOSSO domínio — pra poder entrar num iframe.

    O Shopify bloqueia ser embutido por padrão (header
    `Content-Security-Policy: frame-ancestors 'none'`, confirmado ao vivo
    contra várias lojas), mas esse header só existe na RESPOSTA DELES; ao
    buscar o HTML aqui no back e servir de novo a partir da nossa própria
    origem, o header deles nunca chega no navegador do usuário — quem está
    sendo carregado no iframe é a nossa resposta, não a deles.

    <script> é removido inteiro: essa prévia é só visual (ler a página real,
    com o CSS e as imagens de verdade, sem precisar abrir aba nova), não uma
    réplica funcional — rodar JS de terceiro dentro do nosso domínio abriria
    risco real de XSS contra o próprio app.
    """
    product = _product_owned_query(db, current_user.id).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Produto não encontrado")

    domain = product.competitor.domain
    target_url = f"https://{domain}/products/{product.handle}"

    try:
        async with build_async_client() as client:
            response = await client.get(target_url)
            response.raise_for_status()
            html = response.text
    except httpx.HTTPError:
        return HTMLResponse(_preview_error_page(target_url))

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all("script"):
        tag.decompose()
    for tag in soup.find_all("meta", attrs={"http-equiv": lambda v: bool(v) and v.lower() == "content-security-policy"}):
        tag.decompose()

    head = soup.head
    if head is None:
        head = soup.new_tag("head")
        (soup.html or soup).insert(0, head)
    head.insert(0, soup.new_tag("base", href=f"https://{domain}/"))

    return HTMLResponse(str(soup))


def _preview_error_page(target_url: str) -> str:
    return f"""<!doctype html>
<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:sans-serif;color:#64748b;text-align:center;padding:16px;">
<p>Não foi possível carregar a página agora.<br>
<a href="{target_url}" target="_blank" style="color:#2563eb;">Abrir direto na loja ↗</a></p>
</body></html>"""
