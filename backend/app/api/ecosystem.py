"""Módulo 2.5 — fornecedores compartilhados entre lojas concorrentes."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.ecosystem_service import find_shared_vendors

router = APIRouter(prefix="/api/ecosystem", tags=["ecosystem"])


@router.get("/shared-vendors")
def shared_vendors(min_stores: int = 2, db: Session = Depends(get_db)):
    return find_shared_vendors(db, min_stores=min_stores)
