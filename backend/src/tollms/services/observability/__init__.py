"""Observability event surface (Phase 15).

Structured JSON-ish audit/security/gateway events plus best-effort Valkey
counters. Valkey metrics are fail-open (metrics only); enforcement stays
fail-closed where it already is.
"""

from tollms.services.observability.events import emit, incr_counter

__all__ = ["emit", "incr_counter"]
