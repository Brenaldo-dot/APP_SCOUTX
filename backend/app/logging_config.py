"""Configuração única de logging (API uvicorn + workers/beat do Celery).

Achado em produção (2026-11): o serviço `mega-minerador` gerava ~143 mil
linhas de log por dia (>100/min). A maior parte não vinha do nosso código:
- `httpx` registra TODA requisição em INFO ("HTTP Request: GET ... 200 OK")
  — cada página de /products.json e cada /products/<handle>.json do
  enriquecimento de barcode virava uma linha (log por item);
- o Celery registra "Task received" / "Task succeeded" de toda task e o Beat
  registra "Sending due task" a cada disparo (reconcile a cada 3 min);
- o uvicorn registra uma linha de access log por requisição do proxy Node.

Aqui o nível vem de LOG_LEVEL (padrão INFO) e essas fontes ruidosas ficam em
WARNING, a não ser que LOG_LEVEL=DEBUG (aí tudo volta a aparecer, pra
investigar algo pontual). O que importa de rotina sai como resumo por lote
nas próprias tasks (ver app/tasks/*_all).
"""

import logging
import os

_NOISY_LOGGERS = (
    "httpx",
    "httpcore",
    "uvicorn.access",
    "celery.app.trace",  # "Task ... succeeded in Xs: {...}"
    "celery.worker.strategy",  # "Task ... received"
    "celery.beat",  # "Scheduler: Sending due task ..."
    "kombu",
    "asyncio",
)

_FORMAT = "%(asctime)s %(levelname)s [%(processName)s] %(name)s: %(message)s"

_configured = False


def get_log_level() -> int:
    name = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    level = logging.getLevelName(name)
    return level if isinstance(level, int) else logging.INFO


def configure_logging(force: bool = False) -> None:
    """Idempotente: chamado no import da API e no sinal setup_logging do Celery."""
    global _configured
    if _configured and not force:
        return
    _configured = True

    level = get_log_level()
    logging.basicConfig(level=level, format=_FORMAT, force=True)

    noisy_level = level if level <= logging.DEBUG else max(level, logging.WARNING)
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(noisy_level)
