"""Org key request/response models (metadata only — never key material)."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.api.keys.schemas import IpRuleIn, IpRuleRead, ModelPermissionIn, ModelPermissionRead, PolicyIn, PolicyRead


class OrgKeyCreate(BaseModel):
    """Issue an org-scoped key to an ACTIVE member of the org.

    Same full field set as personal key creation (expiration, limits,
    network rules, model restrictions) plus the required assignee.
    """

    assignee_user_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    expires_at: datetime | None = None
    max_budget_usd: Decimal | None = Field(default=None, ge=0)
    policy: PolicyIn | None = None
    ip_rules: list[IpRuleIn] = Field(default_factory=list)
    model_permissions: list[ModelPermissionIn] = Field(default_factory=list)



class OrgKeyRead(BaseModel):
    """Org key metadata view. Never carries hashes or raw key material."""

    id: uuid.UUID
    org_id: uuid.UUID
    assignee_user_id: uuid.UUID
    assignee_email: str | None = None
    issued_by: uuid.UUID | None = None
    name: str
    description: str | None = None
    key_prefix: str
    masked: str
    enabled: bool
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    rotation_count: int
    policy: PolicyRead | None = None
    ip_rules: list[IpRuleRead] = Field(default_factory=list)
    model_permissions: list[ModelPermissionRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    # SUM(api_request_logs.cost) for this key over successful gateway
    # requests; 0.0 when the key has no logged traffic.
    spend_usd: float = 0.0



class OrgKeyCreated(BaseModel):
    """Issue response: `raw_key` is shown exactly once, never again."""

    key: OrgKeyRead
    raw_key: str

