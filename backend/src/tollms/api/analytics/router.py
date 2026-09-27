"""Analytics endpoints only. All aggregation happens in service.py."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.analytics import service
from tollms.api.analytics.schemas import (
    AnalyticsWidgets,
    AnalyticsBreakdown,
    AnalyticsConversations,
    AnalyticsHeatmap,
    AnalyticsModels,
    AnalyticsPerformance,
    AnalyticsSummary,
    AnalyticsTimeseries,
    ExportDataset,
    ExportFormat,
    Granularity,
    ModelSort,
)
from tollms.core.deps import get_db
from tollms.core.security import require_verified_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def range_query(
    preset: str = Query("this_month", alias="range", max_length=16),
    start: date | None = Query(None),
    end: date | None = Query(None),
    tz: str = Query("UTC", max_length=64),
) -> service.RangeQuery:
    """Shared date-range contract: preset + custom bounds + IANA timezone."""
    return service.RangeQuery(preset=preset, timezone=tz, start=start, end=end)


@router.get("/summary", response_model=AnalyticsSummary)
def summary(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsSummary:
    return service.get_summary(db, user.id, q)


@router.get("/timeseries", response_model=AnalyticsTimeseries)
def timeseries(
    q: service.RangeQuery = Depends(range_query),
    granularity: Granularity | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsTimeseries:
    return service.get_timeseries(db, user.id, q, granularity)


@router.get("/breakdown", response_model=AnalyticsBreakdown)
def breakdown(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsBreakdown:
    return service.get_breakdown(db, user.id, q)


@router.get("/models", response_model=AnalyticsModels)
def models(
    q: service.RangeQuery = Depends(range_query),
    sort: ModelSort = Query("most_expensive"),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsModels:
    return service.get_models(db, user.id, q, sort)


@router.get("/heatmap", response_model=AnalyticsHeatmap)
def heatmap(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsHeatmap:
    return service.get_heatmap(db, user.id, q)


@router.get("/performance", response_model=AnalyticsPerformance)
def performance(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsPerformance:
    return service.get_performance(db, user.id, q)


@router.get("/conversations", response_model=AnalyticsConversations)
def conversations(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsConversations:
    return service.get_conversations(db, user.id, q)


@router.get("/widgets", response_model=AnalyticsWidgets)
def widgets(
    q: service.RangeQuery = Depends(range_query),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> AnalyticsWidgets:
    """History/branching/sharing/export counters."""
    return service.get_widgets(db, user.id, q)


@router.get("/export")
def export(
    q: service.RangeQuery = Depends(range_query),
    dataset: ExportDataset = Query("summary"),
    format: ExportFormat = Query("csv"),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> Response:
    content, filename, media_type = service.export(db, user.id, q, dataset, format)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
