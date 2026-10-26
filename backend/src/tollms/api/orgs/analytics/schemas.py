"""Org usage-ledger models (aggregates only)."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class AnalyticsTotals(BaseModel):
    requests: int = 0
    tokens: int = 0
    # Null when the caller lacks Analytics.ViewCost.
    cost: Decimal | None = None



class AnalyticsDayPoint(BaseModel):
    date: str
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsModelRow(BaseModel):
    model: str
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsProviderRow(BaseModel):
    provider: str
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsUserRow(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = None
    # True when the user no longer holds ACTIVE membership in the org.
    removed_badge: bool = False
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsKeyRow(BaseModel):
    """Per-key gateway attribution from api_request_logs (reliable: every
    gateway row carries its key). In-app request_logs traffic has no key and
    is excluded here (it still counts in totals/by_user)."""

    key_id: uuid.UUID
    key_name: str | None = None
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsTeamRow(BaseModel):
    """Per-team attribution placeholder. Always empty: a user belongs to any
    number of teams, so splitting shared usage across teams would
    double-count (no reliable single-owner attribution exists). Use
    ?team_id= to scope the whole overview to one team's roster instead."""

    team_id: uuid.UUID
    name: str | None = None
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None



class AnalyticsOverview(BaseModel):
    """Org usage ledger from request_logs + api_request_logs (metadata only).

    These tables never hold prompts or responses — aggregates only.
    ?from/?to bound the window (lifetime when absent); ?team_id scopes every
    section to users on that team's roster (documented approximation);
    ?key_id scopes to one gateway key. by_team is always empty (see
    AnalyticsTeamRow); by_key attributes gateway traffic per key.
    """

    totals: AnalyticsTotals = Field(default_factory=AnalyticsTotals)
    by_day: list[AnalyticsDayPoint] = Field(default_factory=list)
    by_model: list[AnalyticsModelRow] = Field(default_factory=list)
    by_provider: list[AnalyticsProviderRow] = Field(default_factory=list)
    by_user: list[AnalyticsUserRow] = Field(default_factory=list)
    by_team: list[AnalyticsTeamRow] = Field(default_factory=list)
    by_key: list[AnalyticsKeyRow] = Field(default_factory=list)
    # Reliability signals over the same window/filters (all statuses).
    # success_rate / cache_hit_rate are percent-scale floats (None when empty).
    successful_requests: int = 0
    total_requests: int = 0
    success_rate: float | None = None
    cache_read_tokens: int = 0
    input_tokens: int = 0
    cache_hit_rate: float | None = None



class MemberAnalyticsKeyRow(BaseModel):
    """Per-key attribution for one member: gateway rows grouped by key plus
    in-app request_logs rows that reference a key. Keyless in-app rows count
    in totals but not here."""

    key_id: uuid.UUID
    key_name: str | None = None
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None


class MemberAnalyticsTrendPoint(BaseModel):
    bucket: str
    requests: int = 0
    tokens: int = 0
    cost: Decimal | None = None


class MemberAnalytics(BaseModel):
    """One member's org-scoped usage: org-attributed internal generations
    (request_logs by user+org) plus the member's org-issued gateway keys
    (api_request_logs by user+org). The two tables are disjoint planes
    (internal vs public gateway) — in-app keyed generations write only
    request_logs — so summing them never double-counts.

    Personal-key traffic (org_id NULL) is excluded by the org_id filter;
    revoked/deleted keys stay attributed (history retained, names resolved
    best-effort). blocked counts guardrail blocks (action=blocked) for the
    member+org in the window — window-scoped, not per-request joined — and
    blocked_source names the approximation."""

    user_id: uuid.UUID
    requests: int = 0
    succeeded: int = 0
    failed: int = 0
    blocked: int = 0
    blocked_source: str = "guardrail_triggers"
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    # Null when the caller lacks Analytics.ViewCost.
    total_cost: Decimal | None = None
    avg_cost_per_request: Decimal | None = None
    by_model: list[AnalyticsModelRow] = Field(default_factory=list)
    by_provider: list[AnalyticsProviderRow] = Field(default_factory=list)
    by_key: list[MemberAnalyticsKeyRow] = Field(default_factory=list)
    trend: list[MemberAnalyticsTrendPoint] = Field(default_factory=list)
    last_activity: str | None = None
    last_model: str | None = None
    last_key: str | None = None
