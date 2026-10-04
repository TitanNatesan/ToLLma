"""Organizations Phase A schemas: orgs, sets, invitations, members, audit, notifications."""

import re
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from tollms.api.auth.schemas import UserRead
from tollms.api.keys.schemas import ModelPermissionIn, ModelPermissionRead, PolicyRead

_NAME_RE = re.compile(r"^[\w\s\-.'&(),]{2,120}$", re.UNICODE)


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if v and ("<" in v or ">" in v):
        raise ValueError("angle brackets are not allowed")
    return v or None


class OrgCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=32)

    @field_validator("description", "website", "industry", "location", "size")
    @classmethod
    def _clean_fields(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not _NAME_RE.match(v):
            raise ValueError("invalid organization name")
        return v


class OrgUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=120)
    size: str | None = Field(default=None, max_length=32)
    visibility_mode: str | None = None
    personal_sharing_enforced: bool | None = None

    @field_validator("description", "website", "industry", "location", "size")
    @classmethod
    def _clean_fields(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("visibility_mode")
    @classmethod
    def _mode(cls, v: str | None) -> str | None:
        if v is not None and v not in ("metadata_only", "full_conversation_access"):
            raise ValueError("unknown visibility mode")
        return v


class OrgRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    website: str | None
    industry: str | None
    location: str | None
    size: str | None
    status: str
    visibility_mode: str
    personal_sharing_enforced: bool
    is_root: bool = False
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime


class OrgCard(BaseModel):
    """Public discovery card: no governance data, safe for any authenticated user."""

    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    website: str | None
    industry: str | None


class PermissionSetCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def _clean_description(cls, v: str | None) -> str | None:
        return _clean(v)


class PermissionSetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] | None = None


class PermissionSetRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_system: bool
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime


class AssignSets(BaseModel):
    set_ids: list[uuid.UUID] = Field(default_factory=list)


class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    set_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "<" in v or ">" in v:
            raise ValueError("invalid email")
        return v


class InvitationRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    org_name: str = ""
    org_slug: str = ""
    email: str
    kind: str
    status: str
    expires_at: datetime
    invited_by: uuid.UUID | None
    set_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    # Single-use secret, populated ONLY on the recipient's own queue
    # (my_invitations). Never present on org-managed listings.
    token: str | None = None
    # Enrichment for the invites UI (token behavior unchanged).
    invited_by_email: str | None = None
    invited_by_name: str | None = None
    permission_sets: list["PermissionSetSummary"] = Field(default_factory=list)


class PermissionSetSummary(BaseModel):
    """Set name + resolved permission codes (invitation/preview display)."""

    id: str
    name: str
    codes: list[str] = Field(default_factory=list)


class InviterRef(BaseModel):
    name: str | None = None
    email: str | None = None


class InvitePreview(BaseModel):
    """Public invitation preview: safe for unauthenticated display.

    Returned ONLY for pending + unexpired invitations. Invalid, expired and
    consumed tokens all get an identical 404 body (no existence oracle).
    """

    org_name: str
    org_slug: str
    email: str
    invited_by: InviterRef
    permission_sets: list[PermissionSetSummary] = Field(default_factory=list)
    expires_at: datetime


class AcceptNewRequest(BaseModel):
    """Public new-account accept: creates the account AND consumes the invite.

    No set ids, no roles, no org id from the client — everything server-side
    derives from the invitation. Unknown fields are ignored (pydantic default),
    so client-sent set ids can never take effect.
    """

    full_name: str = Field(min_length=1, max_length=120)
    # Same bounds as signup; strength itself is enforced by the shared
    # set_password validator (upper + lower + digit), not here.
    password: str = Field(min_length=8, max_length=128)
    # Optional echo of the invited address. Never trusted beyond an
    # equality check against the invitation email (case-insensitive).
    email: str | None = Field(default=None, max_length=320)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("full name is required")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if "@" not in v or "<" in v or ">" in v:
            raise ValueError("invalid email")
        return v


class AcceptNewResponse(BaseModel):
    """Login-shaped response for the atomic accept: the same user + token
    fields the frontend login handler reads, plus the joined org id."""

    user: UserRead
    org_id: uuid.UUID
    access_token: str | None = None
    refresh_token: str | None = None
    # False when the Valkey session write failed AFTER the atomic commit:
    # account + membership exist and the invite is consumed — log in normally.
    session_issued: bool = True


class RejectNewResponse(BaseModel):
    status: str = "rejected"


class MemberRead(BaseModel):
    user_id: uuid.UUID
    email: str
    is_root: bool
    state: str
    permission_sets: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class AuditRead(BaseModel):
    id: uuid.UUID
    action: str
    actor_user_id: uuid.UUID | None
    target: dict
    created_at: datetime


class NotificationRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID | None
    kind: str
    title: str
    body: str | None
    ref: dict
    read_at: datetime | None
    created_at: datetime


# --- Phase B: org keys --------------------------------------------------------


class OrgKeyCreate(BaseModel):
    """Issue an org-scoped key to an ACTIVE member of the org."""

    assignee_user_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    max_budget_usd: Decimal | None = Field(default=None, ge=0)
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
    model_permissions: list[ModelPermissionRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class OrgKeyCreated(BaseModel):
    """Issue response: `raw_key` is shown exactly once, never again."""

    key: OrgKeyRead
    raw_key: str


# --- Phase B: budgets ----------------------------------------------------------


class BudgetRead(BaseModel):
    """Org spend cap ledger. NULL max_spend = unlimited."""

    max_spend: Decimal | None = None
    allocated: Decimal = Decimal("0")
    unallocated: Decimal | None = None


class BudgetUpdate(BaseModel):
    """Set or clear the cap. None clears it (unlimited). Must stay >= allocated."""

    max_spend: Decimal | None = Field(default=None, ge=0)


# --- Phase B: analytics ----------------------------------------------------------


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


class AnalyticsOverview(BaseModel):
    """Org usage ledger from request_logs + api_request_logs (metadata only).

    These tables never hold prompts or responses — aggregates only. Team
    scoping is explicitly OUT (teams UI is a placeholder); org level only.
    """

    totals: AnalyticsTotals = Field(default_factory=AnalyticsTotals)
    by_day: list[AnalyticsDayPoint] = Field(default_factory=list)
    by_model: list[AnalyticsModelRow] = Field(default_factory=list)
    by_provider: list[AnalyticsProviderRow] = Field(default_factory=list)
    by_user: list[AnalyticsUserRow] = Field(default_factory=list)
