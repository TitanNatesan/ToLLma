"""Platform-admin API-key section: inventory, growth and top-key rankings.

Composes the reusable analytics key engines (``services/analytics/apikeys``)
against the shared ``AdminWindow`` so the dashboard, the dedicated
``/api/admin/api-keys`` endpoint and the user-facing analytics API all report
the same numbers for the same window. Two grouped queries per call: the
inventory+growth ``ROLLUP`` scan and the per-(key, model) breakdown (which also
carries registered ``AIModel`` prices for cache savings).

Engines return plain mappings (validated by the router's ``AdminApiKeys``
response model); this package never imports from ``tollms.api``.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from tollms.services.admin import AdminWindow
from tollms.services.admin.usage import window_range
from tollms.services.analytics import AnalyticsWindow
from tollms.services.analytics import apikeys as apikeys_engine

logger = logging.getLogger(__name__)


def _analytics_window(window: AdminWindow) -> AnalyticsWindow:
    return AnalyticsWindow(
        start=window.start,
        end=window.end,
        prev_start=window.prev_start,
        prev_end=window.prev_end,
        preset=window.preset,
        timezone=window.timezone,
    )


def api_keys(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Key counts, creation trend and top/spend/error/savings rankings."""
    scoped = _analytics_window(window)
    inventory = apikeys_engine.inventory(db, scoped)
    breakdown = apikeys_engine.key_breakdown(db, scoped)
    metrics = apikeys_engine.key_metrics(breakdown, limit=limit)
    return {
        "range": window_range(window),
        "total": inventory["total"],
        "active": inventory["active"],
        "disabled": inventory["disabled"],
        "expired": inventory["expired"],
        "rotated": inventory["rotated"],
        "top_keys": metrics["top_keys"],
        "spend_by_key": metrics["key_spend"],
        "errors_by_key": metrics["key_errors"],
        "cache_savings_by_key": metrics["key_cache_savings"],
        "growth": inventory["growth"],
    }
