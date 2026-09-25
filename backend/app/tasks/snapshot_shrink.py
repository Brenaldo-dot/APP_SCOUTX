"""Migração única (2026-09-25): encolhe o campo `product_snapshots.raw` de
linhas antigas — antes do fix em services/snapshot_service.py:_save_snapshot,
esse campo guardava quase o item inteiro (descrição até 3000 caracteres,
lista completa de fotos, tags…) de NOVO em toda foto diária de todo produto,
e o único pedaço lido de volta depois é o `supplier_id` (ver
services/snapshot_service.py:_detect_events, comparação de troca de
fornecedor). `product_snapshots` sozinha respondia por ~80% do disco do
Postgres (11,76 GB de ~14,6 GB usados, achado numa investigação de infra).

Snapshots criados DEPOIS do fix já nascem só com {"supplier_id": ...} — esta
migração cuida só do histórico antigo. Rodar de novo (reinício do processo,
redeploy) é seguro: a condição de busca (`raw -> 'image_urls' IS NOT NULL`)
só existe no formato antigo, então uma segunda passada não encontra nada pra
fazer e termina na hora — não precisa de flag de "já rodei" nem de
tabela de controle.

Em lotes, cada um sua própria transação curta, com uma pausa entre eles —
pra nunca segurar uma trava longa nem competir demais com tráfego real
enquanto roda. Ajuste 2026-09-25 (achado ao vivo, rodando em produção): a
versão original refazia a busca do zero em toda passada (`ORDER BY id LIMIT`
sem lembrar de onde parou) — como o id de quem já foi atualizado deixa de
bater na condição, cada lote novo precisava pular por cima de uma fatia cada
vez MAIOR de linhas já prontas antes de achar as próximas, ficando mais
lento a cada passada (visto ao vivo: 200 mil linhas em ~6 minutos). Agora
guarda o maior id já processado (`last_id`) e busca sempre a PARTIR dali —
sempre andando pra frente, nunca reescaneando o que já passou. Testado
contra Postgres real (embedded-postgres) antes de rodar em produção:
preserva supplier_id (inclusive nulo), não mexe em raw já None nem em linha
já no formato novo (mesmo intercaladas no meio do caminho), é idempotente
mesmo reiniciando o marcador do zero depois de já ter terminado."""

import logging
import threading
import time
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import SessionLocal

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50_000
_PAUSE_SECONDS = 0.3
_BATCH_QUERY = text(
    """
    WITH batch AS (
        SELECT id FROM product_snapshots
        WHERE id > :last_id AND raw IS NOT NULL AND raw -> 'image_urls' IS NOT NULL
        ORDER BY id
        LIMIT :batch_size
    )
    UPDATE product_snapshots
    SET raw = json_build_object('supplier_id', raw->>'supplier_id')
    WHERE id IN (SELECT id FROM batch)
    RETURNING id
    """
)

_state: dict = {"status": "not_started", "updated": 0, "batches": 0, "started_at": None, "finished_at": None, "error": None}
_started = False


def get_shrink_state() -> dict:
    return dict(_state)


def _run() -> None:
    _state["status"] = "running"
    _state["started_at"] = datetime.now(timezone.utc).isoformat()
    logger.info("Encolhendo product_snapshots.raw antigo: iniciando (lotes de %d).", _BATCH_SIZE)
    last_id = 0
    try:
        while True:
            db = SessionLocal()
            try:
                result = db.execute(_BATCH_QUERY, {"last_id": last_id, "batch_size": _BATCH_SIZE})
                updated_ids = [row[0] for row in result]
                db.commit()
            finally:
                db.close()
            updated = len(updated_ids)
            if updated_ids:
                last_id = max(updated_ids)
            _state["batches"] += 1
            _state["updated"] += updated
            if _state["batches"] % 5 == 0 or updated == 0:
                logger.info(
                    "Encolhendo product_snapshots.raw: %d linha(s) neste lote, %d no total, %d lote(s).",
                    updated,
                    _state["updated"],
                    _state["batches"],
                )
            if updated == 0:
                break
            time.sleep(_PAUSE_SECONDS)
        _state["status"] = "done"
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(
            "Encolhendo product_snapshots.raw: concluído. %d linha(s) atualizadas em %d lote(s).",
            _state["updated"],
            _state["batches"],
        )
    except Exception as exc:  # noqa: BLE001 - nunca derruba a thread nem o processo
        _state["status"] = "error"
        _state["error"] = str(exc)
        logger.exception("Encolhendo product_snapshots.raw: falhou no meio do caminho (progresso mantido, seguro rodar de novo).")


def start_snapshot_shrink() -> None:
    """Sobe a thread uma única vez por processo (chamado no startup da API).
    Espera um pouco antes de começar pra não competir com as migrações de
    startup (lifespan de main.py) logo na subida do container."""
    global _started
    if _started:
        return
    _started = True

    def _delayed_start():
        time.sleep(15)
        _run()

    threading.Thread(target=_delayed_start, name="snapshot-raw-shrink", daemon=True).start()
    logger.info("Encolhendo product_snapshots.raw: agendado pra começar em 15s.")
