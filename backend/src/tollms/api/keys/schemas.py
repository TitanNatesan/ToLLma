"""Keys API request/response models. Raw keys and key hashes never appear here."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.models.api_key import IpRuleType

MAX_DESCRIPTION_LENGTH = 2000


class IpRuleIn(BaseModel):
    type: IpRuleType
    cidr: str = Field(min_length=1, max_length=64)


class IpRuleRead(BaseModel):
    id: uuid.UUID
    type: IpRuleType
    cidr: str

    model_config = {"from_attributes": True}


class ModelPermissionIn(BaseModel):
    """NULL provider/model = "any" for that dimension (allow-list row)."""

    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    enabled: bool = True
    max_budget: Decimal | None = Field(default=None, ge=0)
    rpm: int | None = Field(default=None, ge=0)
    tpm: int | None = Field(default=None, ge=0)


class ModelPermissionRead(BaseModel):
    id: uuid.UUID
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    enabled: bool
    max_budget: Decimal | None = None
    rpm: int | None = None
    tpm: int | None = None

    model_config = {"from_attributes": True}


class PolicyIn(BaseModel):
    """Every field nullable = unlimited / not restricted. Set 0 to block."""

    max_budget_usd: Decimal | None = Field(default=None, ge=0)
    budget_reset_days: int | None = Field(default=None, ge=1, le=365)
    expires_at: datetime | None = None
    rpm: int | None = Field(default=None, ge=0)
    rph: int | None = Field(default=None, ge=0)
    rpd: int | None = Field(default=None, ge=0)
    tpm: int | None = Field(default=None, ge=0)
    tpd: int | None = Field(default=None, ge=0)
    daily_spend_limit: Decimal | None = Field(default=None, ge=0)
    monthly_spend_limit: Decimal | None = Field(default=None, ge=0)


class PolicyRead(BaseModel):
    id: uuid.UUID
    max_budget_usd: Decimal | None = None
    budget_reset_days: int | None = None
    expires_at: datetime | None = None
    rpm: int | None = None
    rph: int | None = None
    rpd: int | None = None
    tpm: int | None = None
    tpd: int | None = None
    daily_spend_limit: Decimal | None = None
    monthly_spend_limit: Decimal | None = None

    model_config = {"from_attributes": True}


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    expires_at: datetime | None = None
    policy: PolicyIn | None = None
    ip_rules: list[IpRuleIn] = Field(default_factory=list)
    model_permissions: list[ModelPermissionIn] = Field(default_factory=list)


class ApiKeyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    enabled: bool | None = None
    expires_at: datetime | None = None


class KeyRead(BaseModel):
    """Public key view. Carries only the prefix/mask — never the raw key or hash."""

    id: uuid.UUID
    name: str
    description: str | None = None
    key_prefix: str
    masked: str
    enabled: bool
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    rotation_count: int
    is_primary: bool = False
    is_default: bool = False
    policy: PolicyRead | None = None
    ip_rules: list[IpRuleRead] = Field(default_factory=list)
    model_permissions: list[ModelPermissionRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class KeyCreated(BaseModel):
    """Create/rotate response: `raw_key` is shown exactly once."""

    key: KeyRead
    raw_key: str


class AnalyticsPoint(BaseModel):
    bucket: datetime
    requests: int
    tokens: int
    cost: Decimal
    errors: int


class AnalyticsModelRow(BaseModel):
    model: str
    requests: int
    tokens: int
    cost: Decimal


class AnalyticsEndpointRow(BaseModel):
    endpoint: str
    requests: int
    cost: Decimal


class AnalyticsCountryRow(BaseModel):
    country: str
    requests: int


class KeyAnalytics(BaseModel):
    """Per-key usage roll-up from `api_request_logs` (never log payloads)."""

    range: str
    range_start: datetime
    range_end: datetime
    requests: int
    tokens: int
    cost: Decimal
    avg_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    # Fraction (0..1) of requests whose status is not "success".
    error_rate: float = 0.0
    series: list[AnalyticsPoint] = Field(default_factory=list)
    top_models: list[AnalyticsModelRow] = Field(default_factory=list)
    top_endpoints: list[AnalyticsEndpointRow] = Field(default_factory=list)
    top_countries: list[AnalyticsCountryRow] = Field(default_factory=list)
