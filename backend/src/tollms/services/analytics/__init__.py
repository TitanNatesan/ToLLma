"""Gateway analytics engines over ``api_request_logs`` (metadata only).

The package aggregates the public-gateway request log into the frozen
``/api/analytics`` payloads. Every module is an engine-keyed, reusable service:
it reads ``models/`` and other ``services/`` only (never ``api/``), returns
plain mappings validated by the API schemas, and computes everything with
grouped SQL (no per-row lookups, no raw payload reads — only counts, tokens,
costs, latencies and client metadata are stored).

Module map:

* ``aggregations`` — window resolution, scope conditions, request totals and
  endpoint dimensions.
* ``latency`` / ``tokens`` / ``costs`` — metric columns and payload shaping
  used by the totals query and the caching/cost sections.
* ``providers`` / ``models`` — one grouped dimension query (provider+model and
  endpoint grouping sets) plus the fold helpers both sections share.
* ``apikeys`` — key inventory, per-key breakdown and the platform-admin
  API-key sections.
* ``network`` — IP/geo/device/client aggregation and ``detect_client``.
* ``timeseries`` — bucketed request/cost/token/latency series plus the stacked
  grouping used by the per-key chart.
* ``insights`` — pure functions turning aggregates into insight rows.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AnalyticsWindow:
    """Resolved analytics window (UTC instants) plus its comparison window.

    ``granularity`` is picked from the span (hour/day/week) and drives the
    time-series buckets; ``prev_*`` is the equal-length window immediately
    before ``start`` used for period-over-period insights.
    """

    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime
    preset: str = "7d"
    timezone: str = "UTC"
    granularity: str = "day"


__all__ = ["AnalyticsWindow"]
