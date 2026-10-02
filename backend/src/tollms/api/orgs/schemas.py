"""Organizations Phase A schemas: orgs, sets, invitations, members, audit, notifications."""

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

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
