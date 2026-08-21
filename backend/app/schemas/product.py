from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    competitor_id: int
    shopify_product_id: int
    title: str
    handle: str
    vendor: str | None
    supplier_id: str | None
    product_type: str | None
    tags: list[str]
    price_min: float | None
    price_max: float | None
    variant_count: int
    image_count: int
    total_inventory: int | None
    main_image_url: str | None
    image_urls: list[str]
    description_text: str | None
    is_active: bool
    duplicated: bool
    duplicate_count: int
    duplicate_of: list[dict]
    scaling: bool
    first_seen_at: datetime
    last_seen_at: datetime


class ProductListOut(BaseModel):
    items: list[ProductOut]
    total: int


class ProductEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    details: dict | None
    created_at: datetime


class ProductScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    score: int
    signals: list[str]


class ProductDetailOut(ProductOut):
    events: list[ProductEventOut] = []
    scores: list[ProductScoreOut] = []


class HotProductOut(ProductOut):
    """Módulo 8.2 — produto + o score MAIS RECENTE calculado (services/scoring_service.py)."""

    score: int
    score_label: str
    signals: list[str]
    score_date: date
    active_ad_count: int
    latest_ad_library_url: str | None


class HotProductListOut(BaseModel):
    items: list[HotProductOut]
    total: int
