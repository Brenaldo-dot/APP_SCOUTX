"""Módulo 1 — gerenciamento de concorrentes."""

import logging
import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentUser, get_current_user, resolve_target_user
from app.database import get_db
from app.models import Alert, Competitor, CompetitorStatus, CompetitorTracker, Product
from app.schemas.competitor import CompetitorCreate, CompetitorDetailOut, CompetitorOut, CompetitorUpdate
from app.services.competitor_service import normalize_domain, register_competitor
from app.tasks.ads_monitor import run_ads_monitor_one
from app.tasks.daily_snapshot import run_daily_snapshot_one
from app.tasks.onboarding import run_onboarding_xray

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/competitors", tags=["competitors"])


def _enqueue(task, *args, label: str) -> None:
    # send_task/.delay() é uma chamada SÍNCRONA e bloqueante (kombu/redis-py
    # puro, não asyncio). Visto ao vivo: chamada direto dentro de um `async
    # def` do FastAPI, ela trava 20-30s pra publicar no Redis (mesmo com
    # Postgres, CPU e o Redis em si saudáveis — confirmado via
    # /api/_debug/pg_activity rodando em paralelo sem nenhum lock, e via
    # `railway metrics` com CPU/memória ociosas o tempo todo); o MESMO worker
    # Celery conecta no mesmo Redis instantaneamente no próprio startup. Não
    # foi possível confirmar a causa exata (provável fricção entre o cliente
    # bloqueante do kombu e o event loop do uvicorn), então em vez de
    # persegui-la, tiramos essa chamada do caminho síncrono da resposta HTTP:
    # roda numa thread solta, sem o cliente esperar. Cadastro/rescan
    # continuam funcionando (a task só entra na fila alguns segundos depois),
    # só não trava mais quem está cadastrando a próxima loja.
    def _run():
        try:
            task.delay(*args)
        except Exception:
            logger.warning(
                "Não consegui enfileirar %s (fila/Redis indisponível?)",
                label,
            )

    threading.Thread(target=_run, daemon=True).start()


def _owned_query(db: Session, user_id: int):
    """Só os concorrentes que ESSE usuário rastreia (competitor_trackers) —
    o dado em si (Competitor) é compartilhado entre quem rastreia a mesma
    loja, mas a LISTA de cada um é só a dela. Admin usa isso igual todo
    mundo pra própria aba; ver outro usuário é sempre explícito (parâmetro
    `as_user_id` nos endpoints de leitura, nunca um bypass automático)."""
    return db.query(Competitor).join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id).filter(
        CompetitorTracker.user_id == user_id
    )


def _assert_operation_allowed(db: Session, current_user: CurrentUser, effective_operation: str) -> None:
    """Limite de países do plano (Módulo de planos/organizações) — só entra
    em ação pra quem tem organização com teto definido (org_max_operations
    vindo do Node via header, ver api/deps.py); conta admin e plano Enterprise
    não mandam esse header, ficam sem limite. `operation` é texto livre (o
    frontend deixa digitar qualquer país, ver OperationContext.jsx no React),
    então não dá pra validar contra uma lista fixa — conta os países
    DISTINTOS que já aparecem de verdade nos concorrentes rastreados por
    qualquer colega da mesma organização."""
    if current_user.org_max_operations is None or not current_user.org_member_ids:
        return
    used = {
        row[0]
        for row in db.query(Competitor.operation)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id.in_(current_user.org_member_ids))
        .distinct()
        .all()
    }
    if effective_operation in used:
        return
    if len(used) >= current_user.org_max_operations:
        raise HTTPException(
            400,
            f"Sua organização já está no limite de {current_user.org_max_operations} país(es) do plano — "
            "fale com um administrador pra liberar mais países.",
        )


def _assert_competitor_limit_allowed(
    db: Session, current_user: CurrentUser, existing_competitor_id: int | None
) -> None:
    """Limite de concorrentes cadastrados do plano (mesmo módulo do limite de
    países acima) — org_max_competitors vem do Node via header, ver
    api/deps.py; conta admin e plano Enterprise não mandam esse header, ficam
    sem limite. Reaproveitar um concorrente que a organização já rastreia
    (mesmo domínio, cadastrado por outro colega) não consome vaga nova — só
    um concorrente de verdade INÉDITO pra organização conta, mesmo raciocínio
    do "país já usado" acima."""
    if current_user.org_max_competitors is None or not current_user.org_member_ids:
        return
    owned_ids = {
        row[0]
        for row in db.query(Competitor.id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id.in_(current_user.org_member_ids))
        .distinct()
        .all()
    }
    if existing_competitor_id is not None and existing_competitor_id in owned_ids:
        return
    if len(owned_ids) >= current_user.org_max_competitors:
        raise HTTPException(
            400,
            f"Sua organização já está no limite de {current_user.org_max_competitors} concorrente(s) cadastrado(s) "
            "do plano — fale com um administrador pra liberar mais, ou remova um concorrente antes de cadastrar outro.",
        )


@router.post("", response_model=CompetitorOut, status_code=201)
async def create_competitor(
    payload: CompetitorCreate, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    domain = normalize_domain(payload.domain)
    existing_for_user = (
        _owned_query(db, current_user.id).filter(Competitor.domain == domain).first()
    )
    if existing_for_user and existing_for_user.operation != payload.operation:
        raise HTTPException(
            409,
            f'{domain} já está na sua lista na operação "{existing_for_user.operation}" (como '
            f'"{existing_for_user.name}") — um domínio só pode pertencer a uma operação por vez. Troque pra '
            "essa operação pra ver o cadastro, ou exclua-o antes de recadastrar em outra.",
        )

    # Domínio já rastreado por outro usuário: register_competitor reaproveita
    # a linha e IGNORA o payload.operation, mantendo o país original — o
    # limite tem que ser checado contra esse país de verdade, não contra o
    # que o formulário mandou, senão adicionar uma loja que a própria
    # organização já rastreia consumiria uma vaga de país à toa.
    existing_competitor = db.query(Competitor).filter(Competitor.domain == domain).first()
    effective_operation = existing_competitor.operation if existing_competitor else payload.operation
    _assert_operation_allowed(db, current_user, effective_operation)
    _assert_competitor_limit_allowed(db, current_user, existing_competitor.id if existing_competitor else None)

    competitor, is_new_competitor, _is_new_tracker = await register_competitor(
        db, payload.domain, payload.name, payload.niche, payload.tags, current_user.id, payload.operation
    )
    # Só dispara o raio-x se o DOMÍNIO em si é inédito — se outro usuário já
    # rastreia (dado reaproveitado, ver register_competitor), não faz sentido
    # raspar tudo de novo só porque mais alguém passou a rastrear também.
    if is_new_competitor:
        _enqueue(run_onboarding_xray, competitor.id, label=f"o raio-x inicial de {competitor.domain}")
    return competitor


@router.get("", response_model=list[CompetitorOut])
def list_competitors(
    status: CompetitorStatus | None = None,
    operation: str | None = None,
    as_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_user = resolve_target_user(current_user, as_user_id)
    query = _owned_query(db, target_user)
    if status:
        query = query.filter(Competitor.status == status)
    if operation:
        query = query.filter(Competitor.operation == operation)
    competitors = query.order_by(Competitor.created_at.desc()).all()

    # "Desde quando essa loja está no mercado" (filtro "Lojas mais antigas" no
    # front) — não é uma coluna cacheada no Competitor, calcula na hora a
    # partir do produto ATIVO mais antigo de cada um (mesma data
    # shopify_created_at que EspionarLoja usa pra "criado há Xd", só que aqui
    # é o MENOR valor da loja inteira, não o de 1 produto). Uma query só pra
    # todos os concorrentes da página, não uma por card.
    if competitors:
        oldest_rows = (
            db.query(Product.competitor_id, func.min(Product.shopify_created_at))
            .filter(
                Product.competitor_id.in_([c.id for c in competitors]),
                Product.is_active.is_(True),
                Product.shopify_created_at.isnot(None),
            )
            .group_by(Product.competitor_id)
            .all()
        )
        oldest_by_competitor = dict(oldest_rows)
        for c in competitors:
            c.oldest_product_at = oldest_by_competitor.get(c.id)
    return competitors


@router.get("/my-operations-limit")
def my_operations_limit(db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    """Pra qualquer usuário logado (não só admin) — o seletor de país e o
    formulário de cadastrar concorrente usam isso pra mostrar o que já cabe
    no plano da própria organização e o que está travado, ANTES de tentar
    cadastrar (mesma conta usada em _assert_operation_allowed e
    _assert_competitor_limit_allowed, só que exposta pra decisão de UI em vez
    de bloqueio de escrita)."""
    used_operations: set[str] = set()
    used_competitor_ids: set[int] = set()
    if current_user.org_member_ids:
        rows = (
            db.query(Competitor.operation, Competitor.id)
            .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
            .filter(CompetitorTracker.user_id.in_(current_user.org_member_ids))
            .distinct()
            .all()
        )
        used_operations = {r[0] for r in rows}
        used_competitor_ids = {r[1] for r in rows}
    return {
        "maxOperations": current_user.org_max_operations,
        "usedOperations": sorted(used_operations),
        "maxCompetitors": current_user.org_max_competitors,
        "usedCompetitors": len(used_competitor_ids),
    }


@router.get("/summary-by-user")
def summary_by_user(db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    """Painel de auditoria do admin — quantos concorrentes cada usuário
    rastreia, por operação, e quantos alertas já foram gerados pras lojas
    que rastreia (métrica de uso — separa quem usa de verdade de conta
    esquecida). Nomes de usuário não existem aqui (app_users vive no banco
    do app Node, ver api/deps.py) — o frontend cruza esse `user_id` com a
    lista de /api/admin/users que já busca pra tela de Usuários."""
    if not current_user.is_admin:
        raise HTTPException(403, "Só administradores podem ver isso.")
    rows = (
        db.query(CompetitorTracker.user_id, Competitor.operation, func.count(CompetitorTracker.id))
        .join(Competitor, Competitor.id == CompetitorTracker.competitor_id)
        .group_by(CompetitorTracker.user_id, Competitor.operation)
        .all()
    )
    by_user: dict[int, dict[str, int]] = {}
    for user_id, operation, count in rows:
        by_user.setdefault(user_id, {})[operation] = count

    alert_rows = (
        db.query(CompetitorTracker.user_id, func.count(Alert.id))
        .join(Competitor, Competitor.id == CompetitorTracker.competitor_id)
        .join(Alert, Alert.competitor_id == Competitor.id)
        .group_by(CompetitorTracker.user_id)
        .all()
    )
    alerts_by_user = dict(alert_rows)

    return [
        {
            "user_id": user_id,
            "by_operation": operations,
            "total": sum(operations.values()),
            "alerts_total": alerts_by_user.get(user_id, 0),
        }
        for user_id, operations in by_user.items()
    ]


@router.get("/search-trackers")
def search_trackers(
    q: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Busca admin: qual usuário rastreia tal loja — digita um pedaço do
    domínio ou nome e recebe, pra cada concorrente que bater, quem rastreia
    (varre TODOS os concorrentes do banco, não só os de quem chamou —
    diferente de list_competitors/_owned_query, por isso admin-only)."""
    if not current_user.is_admin:
        raise HTTPException(403, "Só administradores podem buscar por todos os usuários.")
    term = q.strip()
    if len(term) < 2:
        return []
    like = f"%{term}%"
    rows = (
        db.query(Competitor)
        .options(selectinload(Competitor.trackers))
        .filter(or_(Competitor.domain.ilike(like), Competitor.name.ilike(like)))
        .order_by(Competitor.name)
        .limit(20)
        .all()
    )
    return [
        {
            "competitor_id": c.id,
            "domain": c.domain,
            "name": c.name,
            "operation": c.operation,
            "tracker_user_ids": [t.user_id for t in c.trackers],
        }
        for c in rows
    ]


@router.get("/operations-usage")
def operations_usage(
    user_ids: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Quantos países distintos e quantos concorrentes distintos os
    concorrentes de um grupo de usuários já usam — pra tela admin de
    Organizações mostrar "X de Y países" e "X de Y concorrentes" por
    organização (o Node manda os `user_ids` de quem é da mesma organização;
    aqui só soma, não sabe nada de plano/organização, isso é concern do
    Node)."""
    if not current_user.is_admin:
        raise HTTPException(403, "Só administradores podem ver isso.")
    ids = [int(v) for v in user_ids.split(",") if v.strip().isdigit()]
    if not ids:
        return {"operations": [], "count": 0, "competitorsCount": 0}
    rows = (
        db.query(Competitor.operation, Competitor.id)
        .join(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.user_id.in_(ids))
        .distinct()
        .all()
    )
    ops = sorted({r[0] for r in rows})
    competitor_ids = {r[1] for r in rows}
    return {"operations": ops, "count": len(ops), "competitorsCount": len(competitor_ids)}


@router.post("/claim-orphaned")
def claim_orphaned(db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    """Concorrente sem NENHUM rastreador (órfão) vira do usuário que chamar
    isso — cobre tanto quem nunca tinha dono (época pré-multi-tenant) quanto
    qualquer coisa que fique órfã por outro motivo no futuro. Admin-only de
    propósito, mesma razão do antigo claim-unowned (v1, baseado em owner_id,
    já removido): não pode virar um jeito de qualquer conta "roubar" dado
    velho sem dono."""
    if not current_user.is_admin:
        raise HTTPException(403, "Só administradores podem reivindicar concorrentes órfãos.")
    orphaned_ids = [
        row[0]
        for row in db.query(Competitor.id)
        .outerjoin(CompetitorTracker, CompetitorTracker.competitor_id == Competitor.id)
        .filter(CompetitorTracker.id.is_(None))
        .all()
    ]
    for competitor_id in orphaned_ids:
        db.add(CompetitorTracker(competitor_id=competitor_id, user_id=current_user.id))
    db.commit()
    return {"claimed": len(orphaned_ids)}


@router.get("/{competitor_id}", response_model=CompetitorDetailOut)
def get_competitor(
    competitor_id: int,
    as_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_user = resolve_target_user(current_user, as_user_id)
    competitor = (
        _owned_query(db, target_user)
        .options(selectinload(Competitor.tech_stack))
        .filter(Competitor.id == competitor_id)
        .first()
    )
    if not competitor:
        raise HTTPException(404, "Concorrente não encontrado")
    return competitor


@router.patch("/{competitor_id}", response_model=CompetitorOut)
def update_competitor(
    competitor_id: int,
    payload: CompetitorUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    competitor = _owned_query(db, current_user.id).filter(Competitor.id == competitor_id).first()
    if not competitor:
        raise HTTPException(404, "Concorrente não encontrado")
    if payload.status is not None:
        competitor.status = payload.status
    if payload.niche is not None:
        competitor.niche = payload.niche
    if payload.tags is not None:
        competitor.tags = payload.tags
    if payload.operation is not None and payload.operation != competitor.operation:
        _assert_operation_allowed(db, current_user, payload.operation)
        competitor.operation = payload.operation
    db.commit()
    db.refresh(competitor)
    return competitor


@router.delete("/{competitor_id}", status_code=204)
def delete_competitor(
    competitor_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    competitor = _owned_query(db, current_user.id).filter(Competitor.id == competitor_id).first()
    if not competitor:
        raise HTTPException(404, "Concorrente não encontrado")

    tracker = (
        db.query(CompetitorTracker)
        .filter(CompetitorTracker.competitor_id == competitor_id, CompetitorTracker.user_id == current_user.id)
        .first()
    )
    db.delete(tracker)
    db.flush()

    # Ninguém mais rastreando = sem razão pra guardar (decisão explícita do
    # usuário) — apaga o concorrente inteiro (cascata: produtos, anúncios,
    # alertas, snapshots). Se outro usuário ainda rastreia, só a linha dele
    # em competitor_trackers some — o dado raspado continua servindo quem
    # ainda rastreia.
    remaining = db.query(CompetitorTracker).filter(CompetitorTracker.competitor_id == competitor_id).count()
    if remaining == 0:
        db.delete(competitor)
    db.commit()


@router.post("/{competitor_id}/rescan-ads", status_code=202)
def rescan_ads(
    competitor_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    # Fora do cron diário (ver tasks/ads_monitor.py) — pra concorrente que já
    # existia antes de um fix no scraper entrar no ar (caso real: bug de
    # falso-negativo corrigido em scrapers/meta_ads.py deixava um concorrente
    # ativo sem NENHUM anúncio na tela até o próximo cron das 8h; isso deixa
    # forçar o re-scan na hora em vez de esperar até amanhã).
    competitor = _owned_query(db, current_user.id).filter(Competitor.id == competitor_id).first()
    if not competitor:
        raise HTTPException(404, "Concorrente não encontrado")
    if competitor.status != CompetitorStatus.ACTIVE:
        raise HTTPException(400, "Concorrente não está ativo")
    _enqueue(run_ads_monitor_one, competitor.id, label=f"o rescan de anúncios de {competitor.domain}")
    return {"status": "queued"}


@router.post("/{competitor_id}/rescore", status_code=202)
def rescore(competitor_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    # Score (services/scoring_service.py) só recalcula no snapshot diário
    # (6h). Sem isso, corrigir um dado que o score usa (ex: bug real de
    # started_at do anúncio vindo em inglês e nunca sendo parseado — ver
    # scrapers/meta_ads.py) só refletia em "Produtos Quentes" no dia
    # seguinte, mesmo com o dado já certo no banco.
    competitor = _owned_query(db, current_user.id).filter(Competitor.id == competitor_id).first()
    if not competitor:
        raise HTTPException(404, "Concorrente não encontrado")
    if competitor.status != CompetitorStatus.ACTIVE:
        raise HTTPException(400, "Concorrente não está ativo")
    _enqueue(run_daily_snapshot_one, competitor.id, label=f"o recálculo de score de {competitor.domain}")
    return {"status": "queued"}
