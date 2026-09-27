"""Analytics endpoints. Thin: window parsing + delegation into service.py.

All endpoints are session-authenticated. ``/platform`` requires
``platform_admin_required``; per-key routes are user-scoped (foreign keys 404).
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.analytics_api import schemas, service
from tollms.core.deps import get_db
from tollms.core.security import get_current_user, platform_admin_required, require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def analytics_query(
    preset: str = Query(default="7d", max_length=16),
    timezone: str = Query(default="UTC", max_length=64),
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
) -> service.AnalyticsQuery:
    """Shared range contract: preset (24h|7d|30d|90d|custom) + custom bounds."""
    return service.AnalyticsQuery(preset=preset, timezone=timezone, start=start, end=end)


@router.get("/platform", response_model=schemas.PlatformAnalytics)
def platform(
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> schemas.PlatformAnalytics:
    return service.platform(db, user, query)


@router.get("/platform/export")
def platform_export(
    query: service.AnalyticsQuery = Depends(analytics_query),
    dataset: service.ExportDataset = Query(default="summary"),
    format: service.ExportFormat = Query(default="csv"),
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> Response:
    """Platform export (uncached CSV/XLSX/JSON; same dataset contract as the user analytics export)."""
    content, filename, media_type, _row_count = service.export_platform(db, user, query, dataset, format)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api-keys", response_model=schemas.ApiKeyListResponse)
def api_keys(
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> schemas.ApiKeyListResponse:
    return service.api_keys(db, user, query)


@router.get("/api-keys/{key_id}", response_model=schemas.ApiKeyDetailResponse)
def api_key_detail(
    key_id: uuid.UUID,
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> schemas.ApiKeyDetailResponse:
    return service.api_key_detail(db, user, key_id, query)


@router.get("/api-keys/{key_id}/timeseries", response_model=schemas.TimeseriesResponse)
def api_key_timeseries(
    key_id: uuid.UUID,
    group_by: schemas.GroupBy = Query(default="model"),
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> schemas.TimeseriesResponse:
    return service.api_key_timeseries(db, user, key_id, query, group_by)


@router.get("/api-keys/{key_id}/network", response_model=schemas.NetworkResponse)
def api_key_network(
    key_id: uuid.UUID,
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> schemas.NetworkResponse:
    return service.api_key_network(db, user, key_id, query)


@router.get("/api-keys/{key_id}/insights", response_model=schemas.InsightsResponse)
def api_key_insights(
    key_id: uuid.UUID,
    query: service.AnalyticsQuery = Depends(analytics_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> schemas.InsightsResponse:
    return service.api_key_insights(db, user, key_id, query)


@router.get("/api-keys/{key_id}/export")
def api_key_export(
    key_id: uuid.UUID,
    query: service.AnalyticsQuery = Depends(analytics_query),
    dataset: service.ExportDataset = Query(default="summary"),
    format: service.ExportFormat = Query(default="csv"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    """Per-key export (uncached, key-scoped CSV/XLSX/JSON; mirrors the user analytics export)."""
    content, filename, media_type, _row_count = service.export_api_key(db, user, key_id, query, dataset, format)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
