"""Platform admin API: aggregated, privacy-safe analytics over `/api/admin/*`.

Every endpoint is gated by `platform_admin_required` and returns aggregates
only — never message content, prompts, responses, attachment bytes, or
provider credentials.
"""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from tollms.api.analytics.service import RangeQuery, resolve_range
from tollms.api.admin import schemas
from tollms.core.deps import get_db
from tollms.core.exceptions import ValidationError
from tollms.core.security import platform_admin_required
from tollms.services.admin import AdminWindow
from tollms.services.admin import api_keys as api_keys_service
from tollms.services.admin import cache as cache_service
from tollms.services.admin import costs as costs_service
from tollms.services.admin import dashboard as dashboard_service
from tollms.services.admin import errors as errors_service
from tollms.services.admin import health as health_service
from tollms.services.admin import live_health as live_health_service
from tollms.services.admin import media as media_service
from tollms.services.admin import models as models_service
from tollms.services.admin import providers as providers_service
from tollms.services.admin import tokens as tokens_service
from tollms.services.admin import usage as usage_service
from tollms.services.admin import users as users_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _window(
    preset: str = Query(default="last_7d"),
    timezone: str = Query(default="UTC", max_length=64),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    granularity: str | None = Query(default=None),
) -> AdminWindow:
    """Resolve the shared range query into a service-layer window."""
    from datetime import date

    def _date(value: str | None) -> date | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            # Fail closed: an unparseable bound must not silently fall back
            # to the preset window. Unknown *presets* still fall back per
            # `presets.normalize` — only malformed dates are rejected here.
            raise ValidationError(f"invalid date: {value!r}; expected YYYY-MM-DD") from None

    resolved = resolve_range(
        RangeQuery(preset=preset, timezone=timezone, start=_date(start), end=_date(end))
    )
    return AdminWindow(
        start=resolved.start,
        end=resolved.end,
        prev_start=resolved.prev_start,
        prev_end=resolved.prev_end,
        preset=resolved.preset,
        timezone=resolved.timezone,
        granularity=granularity or "day",
    )


@router.get("/dashboard", response_model=schemas.AdminDashboard)
def dashboard(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminDashboard:
    payload = dashboard_service.dashboard(db, window, limit=limit)
    payload["api_keys"] = api_keys_service.api_keys(db, window, limit=limit)
    return payload


@router.get("/api-keys", response_model=schemas.AdminApiKeys)
def api_keys(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminApiKeys:
    """Key inventory, creation trend and top/spend/error/savings rankings.

    Usage rows reflect gateway traffic (`api_request_logs`), not chat
    traffic (`messages`) — the chat-analytics totals are a separate source.
    """
    return api_keys_service.api_keys(db, window, limit=limit)


@router.get("/usage", response_model=schemas.AdminUsage)
def usage(
    window: AdminWindow = Depends(_window),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminUsage:
    return usage_service.usage(db, window)


@router.get("/models", response_model=schemas.AdminModels)
def models(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    search: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminModels:
    return models_service.models(db, window, limit=limit, search=search)


@router.get("/providers", response_model=schemas.AdminProviders)
def providers(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminProviders:
    return providers_service.providers(db, window, limit=limit)


@router.get("/users", response_model=schemas.AdminUsers)
def users(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    search: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminUsers:
    return users_service.users(db, window, limit=limit, search=search)


@router.get("/costs", response_model=schemas.AdminCosts)
def costs(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminCosts:
    return costs_service.costs(db, window, limit=limit)


@router.get("/tokens", response_model=schemas.AdminTokens)
def tokens(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminTokens:
    return tokens_service.tokens(db, window, limit=limit)


@router.get("/cache", response_model=schemas.AdminCache)
def cache(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminCache:
    return cache_service.cache(db, window, limit=limit)


@router.get("/media", response_model=schemas.AdminMedia)
def media(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminMedia:
    return media_service.media(db, window, limit=limit)


@router.get("/errors", response_model=schemas.AdminErrors)
def errors(
    window: AdminWindow = Depends(_window),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminErrors:
    return errors_service.errors(db, window, limit=limit)


@router.get("/health", response_model=schemas.AdminHealth)
def health(
    db: Session = Depends(get_db),
    _admin=Depends(platform_admin_required),
) -> schemas.AdminHealth:
    return health_service.health(db)


@router.get("/health/stream")
async def health_stream(
    request: Request,
    _admin=Depends(platform_admin_required),
) -> StreamingResponse:
    """Live health feed: one JSON frame immediately, then every 2 seconds.

    The connection is read-only telemetry; the generator stops as soon as the
    client disconnects. Each frame carries the same aggregated, privacy-safe
    counters as `GET /api/admin/health` (see `AdminLiveHealth`).
    """
    return StreamingResponse(
        live_health_service.stream(request.is_disconnected),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
