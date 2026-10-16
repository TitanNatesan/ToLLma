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

