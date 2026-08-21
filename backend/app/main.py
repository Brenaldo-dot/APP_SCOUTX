"""Ponto de entrada da API."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text

from app import models  # noqa: F401  garante que todo modelo é registrado no Base.metadata
from app.api import ad_miner, ads, alerts, competitors, dashboard, ecosystem, products
from app.config import get_settings
from app.database import Base, engine

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Conveniência para dev/scaffold: cria tabelas que ainda não existem.
    # Para evolução de schema em produção, use `alembic upgrade head` (ver README).
    Base.metadata.create_all(bind=engine)

    # create_all não altera coluna de tabela já existente. Corrige aqui uma
    # vez: shopify_product_id era INTEGER (visto ao vivo estourando com IDs
    # reais de 17 dígitos do Shopify — 0 de 233 produtos gravados na primeira
    # tentativa contra uma loja real). Idempotente, não falha se já for BIGINT.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE products ALTER COLUMN shopify_product_id TYPE BIGINT"))
        # Coluna nova (Módulo 1.2 — separação por operação/país) numa tabela
        # que já existia com dado real: create_all não adiciona coluna em
        # tabela existente. IF NOT EXISTS + DEFAULT faz o Postgres já
        # preencher 'colombia' em toda linha antiga, então nada que já
        # estava cadastrado muda de operação sozinho.
        conn.execute(
            text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS operation VARCHAR(50) NOT NULL DEFAULT 'colombia'")
        )
        # Canal de alerta trocado de Telegram pra Discord — coluna nova pra
        # não perder o rastro de "esse alerta específico já saiu ou não"
        # (sent_to_telegram fica intacto no dado antigo, só não é mais escrito).
        conn.execute(text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sent_to_discord BOOLEAN NOT NULL DEFAULT false"))

        # ecosystem_map referencia products/competitors sem ON DELETE CASCADE
        # desde sempre — visto ao vivo: excluir um concorrente com produto
        # com `vendor` preenchido (a maioria) quebrava com
        # "ForeignKeyViolation: ecosystem_map_product_id_fkey" e devolvia 500
        # pro usuário no meio do clique de excluir. DROP+ADD é idempotente
        # (constraint recriada do zero toda subida, sem custo real numa
        # tabela desse tamanho).
        conn.execute(text("ALTER TABLE ecosystem_map DROP CONSTRAINT IF EXISTS ecosystem_map_product_id_fkey"))
        conn.execute(
            text(
                "ALTER TABLE ecosystem_map ADD CONSTRAINT ecosystem_map_product_id_fkey "
                "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE"
            )
        )
        conn.execute(text("ALTER TABLE ecosystem_map DROP CONSTRAINT IF EXISTS ecosystem_map_competitor_id_fkey"))
        conn.execute(
            text(
                "ALTER TABLE ecosystem_map ADD CONSTRAINT ecosystem_map_competitor_id_fkey "
                "FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE"
            )
        )

        # Minerador de Anúncios (scan avulso) rodava sempre biblioteca "CO",
        # mesmo pra loja mexicana — ver country_for_operation em
        # services/competitor_service.py.
        conn.execute(
            text("ALTER TABLE ad_miner_scans ADD COLUMN IF NOT EXISTS operation VARCHAR(50) NOT NULL DEFAULT 'colombia'")
        )

        # Multi-tenant, v2 — v1 (owner_id direto em competitors, coluna já
        # removida abaixo) dava cada usuário sua PRÓPRIA cópia do dado raspado;
        # veio feedback ao vivo: melhor um dado só por domínio (mais leve,
        # menos raspagem duplicada) com uma tabela à parte dizendo QUEM
        # rastreia CADA concorrente — dois usuários cadastrando a MESMA loja
        # passam a compartilhar produtos/anúncios/histórico, sem duplicar
        # trabalho de scraping, mas nunca um "herda" o cadastro do outro sem
        # ter cadastrado ele mesmo (competitor_trackers, criada via create_all
        # acima por ser tabela nova).
        #
        # Backfill: quem já tinha reivindicado via owner_id (POST
        # /api/competitors/claim-unowned, usado uma vez em produção) vira uma
        # linha de tracker antes da coluna sumir — sem isso a reivindicação
        # que a pessoa já tinha feito se perderia.
        has_owner_id = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'competitors' AND column_name = 'owner_id'"
            )
        ).first()
        if has_owner_id:
            conn.execute(
                text(
                    "INSERT INTO competitor_trackers (competitor_id, user_id, created_at) "
                    "SELECT id, owner_id, now() FROM competitors WHERE owner_id IS NOT NULL "
                    "ON CONFLICT (competitor_id, user_id) DO NOTHING"
                )
            )
            conn.execute(text("ALTER TABLE competitors DROP COLUMN owner_id"))

        # Domínio volta a ser único GLOBAL (era por dono na v1) — nome que a
        # v1 deu à constraint composta, e o nome padrão que unique=True de
        # coluna ganha no Postgres, cobrindo quem nunca chegou a rodar a v1.
        conn.execute(text("ALTER TABLE competitors DROP CONSTRAINT IF EXISTS uq_competitors_domain_owner"))
        conn.execute(text("ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_domain_key"))
        conn.execute(text("ALTER TABLE competitors ADD CONSTRAINT competitors_domain_key UNIQUE (domain)"))

    yield


app = FastAPI(title="ScoutX", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(competitors.router)
app.include_router(products.router)
app.include_router(ads.router)
app.include_router(alerts.router)
app.include_router(dashboard.router)
app.include_router(ecosystem.router)
app.include_router(ad_miner.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/_debug/tenant_state")
def debug_tenant_state():
    # Temporário — usuário reportou "sumiu todos os concorrentes da conta
    # do Samuel" logo após a migração pra CompetitorTracker. Objetivo: ver
    # se o backfill (owner_id -> competitor_trackers) rodou de verdade, sem
    # precisar de sessão logada (o proxy do Node exige login, então não dá
    # pra testar via curl direto — isso aqui fica alcançável só pela rede
    # interna do Railway mesmo assim, igual todo o resto do FastAPI).
    with engine.connect() as conn:
        total_competitors = conn.execute(text("SELECT count(*) FROM competitors")).scalar()
        total_trackers = conn.execute(text("SELECT count(*) FROM competitor_trackers")).scalar()
        by_user = conn.execute(
            text("SELECT user_id, count(*) FROM competitor_trackers GROUP BY user_id ORDER BY count(*) DESC")
        ).all()
        has_owner_id = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'competitors' AND column_name = 'owner_id'"
            )
        ).first()
        orphan_competitors = conn.execute(
            text(
                "SELECT count(*) FROM competitors c "
                "WHERE NOT EXISTS (SELECT 1 FROM competitor_trackers t WHERE t.competitor_id = c.id)"
            )
        ).scalar()
    return {
        "total_competitors": total_competitors,
        "total_trackers": total_trackers,
        "trackers_by_user": [{"user_id": row[0], "count": row[1]} for row in by_user],
        "owner_id_column_still_exists": bool(has_owner_id),
        "competitors_with_no_tracker": orphan_competitors,
    }
