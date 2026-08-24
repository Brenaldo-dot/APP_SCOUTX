"""Módulo 5 — Minerador de Anúncios: consulta avulsa por URL, sem cadastro."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.database import get_db
from app.models import AdMinerScan, AdMinerScanStatus
from app.schemas.ad_miner import AdMinerScanCreate, AdMinerScanOut
from app.services.competitor_service import normalize_domain
from app.tasks.ad_miner import run_ad_miner_scan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ad-miner", tags=["ad-miner"])


@router.post("/scans", response_model=AdMinerScanOut, status_code=201)
def create_scan(
    payload: AdMinerScanCreate, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)
):
    domain = normalize_domain(payload.url)
    if not domain or "." not in domain:
        raise HTTPException(400, "URL inválida — cola o link da loja (ex: lojaexemplo.com)")

    scan = AdMinerScan(
        domain=domain, operation=payload.operation, status=AdMinerScanStatus.PENDING, user_id=current_user.id
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    try:
        run_ad_miner_scan.delay(scan.id)
    except Exception:
        # Mesma lição de api/competitors.py: fila fora do ar não pode virar
        # 500 depois que o registro já foi salvo — só marca falho, front avisa.
        logger.warning(
            "Não consegui enfileirar o scan do Minerador de Anúncios pra %s (fila/Redis indisponível?)", domain
        )
        scan.status = AdMinerScanStatus.FAILED
        scan.error = "Fila de processamento indisponível — tenta de novo em instantes."
        db.commit()
        db.refresh(scan)

    return scan


@router.get("/scans/{scan_id}", response_model=AdMinerScanOut)
def get_scan(scan_id: int, db: Session = Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    # Revisão de segurança: antes lia qualquer scan_id sem checar dono — ver
    # comentário em models/ad_miner.py:user_id.
    query = db.query(AdMinerScan).filter(AdMinerScan.id == scan_id)
    if not current_user.is_admin:
        query = query.filter(AdMinerScan.user_id == current_user.id)
    scan = query.first()
    if not scan:
        raise HTTPException(404, "Scan não encontrado")
    return scan
