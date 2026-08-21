"""Módulo 2.5 — mapa fornecedor -> produto -> loja."""

from sqlalchemy.orm import Session

from app.models import Competitor, EcosystemEntry, Product


def sync_ecosystem_map(db: Session, competitor: Competitor) -> None:
    products = (
        db.query(Product).filter(Product.competitor_id == competitor.id, Product.vendor.isnot(None)).all()
    )
    for product in products:
        vendor = (product.vendor or "").strip()
        if not vendor:
            continue
        entry = (
            db.query(EcosystemEntry)
            .filter(EcosystemEntry.vendor == vendor, EcosystemEntry.product_id == product.id)
            .first()
        )
        if entry:
            entry.last_seen_at = product.last_seen_at
        else:
            db.add(EcosystemEntry(vendor=vendor, product_id=product.id, competitor_id=competitor.id))


def find_shared_vendors(db: Session, min_stores: int = 2) -> list[dict]:
    """Fornecedores que aparecem em 2+ lojas concorrentes — provável agente/dropshipper comum."""
    entries = db.query(EcosystemEntry).all()
    by_vendor: dict[str, set[int]] = {}
    for entry in entries:
        by_vendor.setdefault(entry.vendor, set()).add(entry.competitor_id)

    return [
        {"vendor": vendor, "competitor_ids": sorted(ids), "store_count": len(ids)}
        for vendor, ids in by_vendor.items()
        if len(ids) >= min_stores
    ]
