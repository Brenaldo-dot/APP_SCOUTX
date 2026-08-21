from pydantic import BaseModel

from app.schemas.alert import AlertOut


class DashboardSummary(BaseModel):
    total_competitors: int
    active_competitors: int
    total_products: int
    scaling_products: int
    alerts_last_24h: int
    recent_alerts: list[AlertOut]
