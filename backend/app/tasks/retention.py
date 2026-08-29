"""Limpeza diária de histórico que ninguém mais lê (achado ao vivo, 2026-08-29:
disco do Postgres em ~50% de um teto de 5GB do plano Hobby, com só 10 dias de
app no ar — bem mais rápido do que o normal, sem essa limpeza o disco batia no
teto em poucas semanas e o banco pararia de aceitar gravação nova, derrubando
o app inteiro).

`product_scores` e `product_snapshots` guardam 1 linha por produto, POR DIA,
pra sempre — mas revisando todo o código que lê essas tabelas, NENHUM lugar
usa mais que os últimos 7 dias (ver dashboard.py:get_highlights) ou a linha
mais recente (score/snapshot "atual" de cada produto, usado em todo o resto
do app). Tudo além disso é peso morto: nunca aparece em tela nenhuma.

Mantém sempre a linha mais recente de cada produto (mesmo que mais velha que
o corte) — importante pra produto "dormente" (não escaneado há um tempo) não
ficar sem nenhum score/snapshot, o que quebraria as contagens de "produtos
quentes" e a comparação de mudança na próxima raspagem."""

import logging

from sqlalchemy import text

from app.database import SessionLocal
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# 14 dias: folga em cima da janela de 7 dias que dashboard.py:get_highlights
# realmente usa, sem guardar histórico que nunca é lido.
RETENTION_DAYS = 14

_PURGE_PRODUCT_SCORES = text(
    """
    DELETE FROM product_scores
    WHERE date < (CURRENT_DATE - make_interval(days => :retention_days))
    AND id NOT IN (
        SELECT DISTINCT ON (product_id) id FROM product_scores ORDER BY product_id, date DESC
    )
    """
)

_PURGE_PRODUCT_SNAPSHOTS = text(
    """
    DELETE FROM product_snapshots
    WHERE captured_at < (now() - make_interval(days => :retention_days))
    AND id NOT IN (
        SELECT DISTINCT ON (product_id) id FROM product_snapshots ORDER BY product_id, captured_at DESC
    )
    """
)


@celery_app.task(name="app.tasks.retention.purge_old_history")
def purge_old_history() -> dict:
    db = SessionLocal()
    try:
        scores_deleted = db.execute(_PURGE_PRODUCT_SCORES, {"retention_days": RETENTION_DAYS}).rowcount
        snapshots_deleted = db.execute(_PURGE_PRODUCT_SNAPSHOTS, {"retention_days": RETENTION_DAYS}).rowcount
        db.commit()
        logger.info(
            "Limpeza de histórico: %d product_scores e %d product_snapshots removidos (mais de %d dias).",
            scores_deleted,
            snapshots_deleted,
            RETENTION_DAYS,
        )
        return {"scores_deleted": scores_deleted, "snapshots_deleted": snapshots_deleted}
    except Exception:
        db.rollback()
        logger.exception("Falha na limpeza diária de histórico.")
        raise
    finally:
        db.close()
