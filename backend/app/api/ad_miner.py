"""Módulo 5 — Minerador de Anúncios: consulta avulsa por URL, sem cadastro."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AdMinerScan, AdMinerScanStatus
from app.schemas.ad_miner import AdMinerScanCreate, AdMinerScanOut
from app.services.competitor_service import normalize_domain
from app.tasks.ad_miner import run_ad_miner_scan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ad-miner", tags=["ad-miner"])


@router.post("/scans", response_model=AdMinerScanOut, status_code=201)
def create_scan(payload: AdMinerScanCreate, db: Session = Depends(get_db)):
    domain = normalize_domain(payload.url)
    if not domain or "." not in domain:
        raise HTTPException(400, "URL inválida — cola o link da loja (ex: lojaexemplo.com)")

    scan = AdMinerScan(domain=domain, operation=payload.operation, status=AdMinerScanStatus.PENDING)
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
def get_scan(scan_id: int, db: Session = Depends(get_db)):
    scan = db.get(AdMinerScan, scan_id)
    if not scan:
        raise HTTPException(404, "Scan não encontrado")
    return scan
