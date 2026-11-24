import logging

from app.logging_config import configure_logging
from app.tasks.utils import BatchSummary


def test_info_level_silences_per_request_loggers(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    configure_logging(force=True)
    assert logging.getLogger().level == logging.INFO
    for name in ("httpx", "uvicorn.access", "celery.app.trace", "celery.worker.strategy", "celery.beat"):
        assert not logging.getLogger(name).isEnabledFor(logging.INFO), name
        assert logging.getLogger(name).isEnabledFor(logging.WARNING), name


def test_debug_level_reenables_everything(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "debug")
    configure_logging(force=True)
    assert logging.getLogger().level == logging.DEBUG
    assert logging.getLogger("uvicorn.access").isEnabledFor(logging.INFO)
    assert logging.getLogger("celery.app.trace").isEnabledFor(logging.INFO)
    # URL completa (com token de webhook) nunca vai pro log, nem em DEBUG.
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)


def test_invalid_level_falls_back_to_info(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "barulhento")
    configure_logging(force=True)
    assert logging.getLogger().level == logging.INFO


def test_batch_summary_one_line_per_batch(caplog):
    log = logging.getLogger("test.batch")
    caplog.set_level(logging.INFO, logger="test.batch")
    summary = BatchSummary(log, "Lote", total=1200, every=500)
    for i in range(1200):
        if i % 400 == 0:
            summary.error()
        else:
            summary.ok(produtos=2)
    result = summary.finish()
    lines = [r.getMessage() for r in caplog.records if r.name == "test.batch"]
    assert len(lines) == 3  # progresso em 500, 1000 + resumo final
    assert "processados 1200/1200 itens" in lines[-1] and "3 erros" in lines[-1]
    assert caplog.records[-1].levelno == logging.WARNING
    assert result == {"ok": 1197, "failed": 3, "produtos": 2394}
