"""Módulo 2 — raio-x completo, roda toda semana (segunda 7h) via Celery Beat."""

import logging

from app.database import SessionLocal
from app.models import Competitor, CompetitorStatus
from app.services.competitor_service import run_full_xray
from app.tasks.celery_app import celery_app
from app.tasks.utils import BatchSummary, run_async

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.weekly_xray.run_weekly_xray_all")
def run_weekly_xray_all() -> dict:
    db = SessionLocal()
    try:
        competitors = db.query(Competitor).filter(Competitor.status == CompetitorStatus.ACTIVE).all()
        summary = BatchSummary(logger, "Raio-x semanal", total=len(competitors))
        for competitor in competitors:
            try:
                run_async(run_full_xray(db, competitor))
                summary.ok()
            except Exception:
                logger.exception("Falha no raio-x semanal de %s", competitor.domain)
                db.rollback()
                summary.error()
        return summary.finish()
    finally:
        db.close()
