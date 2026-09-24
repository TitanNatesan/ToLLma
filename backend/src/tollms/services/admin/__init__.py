"""Platform administration analytics engines.

Engine-keyed reusable services (never feature-keyed): every module aggregates
platform-wide usage, tokens, costs, media and health from existing tables.
Privacy invariant: no module here may read message content, prompts,
responses, attachment bytes, or provider credentials.

Dependency rule: these engines import from `models/` and other `services/`
only — never from `api/`.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AdminWindow:
    """Resolved analysis window (UTC instants) plus its preceding comparison."""

    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime
    preset: str = "last_7d"
    timezone: str = "UTC"
    granularity: str = "day"


__all__ = ["AdminWindow"]
