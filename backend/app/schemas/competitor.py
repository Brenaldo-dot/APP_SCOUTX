from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.competitor import CompetitorStatus, ScaleClassification


class CompetitorCreate(BaseModel):
    domain: str
    name: str | None = None
    niche: str | None = None
    tags: list[str] = []
    operation: str = "colombia"


class CompetitorUpdate(BaseModel):
    status: CompetitorStatus | None = None
    niche: str | None = None
    tags: list[str] | None = None
    operation: str | None = None


class CompetitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    domain: str
    name: str
    niche: str | None
    tags: list[str]
    operation: str
    status: CompetitorStatus
    created_at: datetime
    last_checked_at: datetime | None
    total_products: int
    vendor_count: int
    price_min: float | None
    price_max: float | None
    price_avg: float | None
    classification: ScaleClassification | None
    avg_daily_volume: float | None
    hot_products: int


class TechStackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    external_id: str | None
    active: bool
    first_detected_at: datetime
    last_detected_at: datetime


class CompetitorDetailOut(CompetitorOut):
    tech_stack: list[TechStackOut] = []
