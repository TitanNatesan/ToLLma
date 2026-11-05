"""Invitation / join-request request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from tollms.api.auth.schemas import UserRead


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

