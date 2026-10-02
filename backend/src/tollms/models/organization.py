"""Organizations & Teams Phase A: orgs, memberships, permission sets,
invitations/join-requests, audit log, notifications.

Phase A scope only: no teams-owned resources beyond membership grouping
(teams themselves are NOT implemented here), no org providers/keys/budgets.
Conversations stay user-owned; attribution ledger arrives in Phase B.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel


class OrgStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class MembershipState(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REMOVED = "removed"


class InvitationKind(str, enum.Enum):
    INVITE = "invite"  # org -> user (existing or not yet registered)
    REQUEST = "request"  # user -> org (join request)


class InvitationStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CLOSED = "closed"  # revoked by org (invite) or withdrawn/closed (request)


INVITE_TTL_DAYS = 7


class Organization(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "organizations"
    __table_args__ = (
        Index("uq_organizations_slug_live", "slug", unique=True, postgresql_where=text("is_deleted = false")),
        Index("ix_organizations_root", "root_user_id"),
        Index("ix_organizations_status", "status"),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(80), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    root_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=OrgStatus.ACTIVE.value)
    visibility_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="metadata_only")
    personal_sharing_enforced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    audit_retention_days: Mapped[int] = mapped_column(nullable=False, default=365)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="organization")
    permission_sets: Mapped[list["PermissionSet"]] = relationship(back_populates="organization")


class Membership(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "memberships"
    __table_args__ = (
        Index(
            "uq_memberships_org_user_live", "org_id", "user_id", unique=True,
            postgresql_where=text("is_deleted = false"),
        ),
        Index("ix_memberships_user", "user_id"),
        Index("ix_memberships_state", "state"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    is_root: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default=MembershipState.ACTIVE.value)

    organization: Mapped[Organization] = relationship(back_populates="memberships")
    sets: Mapped[list["MembershipPermissionSet"]] = relationship(back_populates="membership")


class PermissionSet(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "permission_sets"
    __table_args__ = (
        Index("uq_permission_sets_org_name", "org_id", "name", unique=True),
        Index("ix_permission_sets_org", "org_id"),
    )

    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    organization: Mapped[Organization | None] = relationship(back_populates="permission_sets")
    permissions: Mapped[list["PermissionSetPermission"]] = relationship(back_populates="permission_set")


class PermissionSetPermission(TimestampedModel):
    __tablename__ = "permission_set_permissions"
    __table_args__ = (Index("uq_set_permissions", "set_id", "code", unique=True),)

    set_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("permission_sets.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)

    permission_set: Mapped[PermissionSet] = relationship(back_populates="permissions")


class MembershipPermissionSet(TimestampedModel):
    __tablename__ = "membership_permission_sets"
    __table_args__ = (Index("uq_membership_sets", "membership_id", "set_id", unique=True),)

    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id"), nullable=False)
    set_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("permission_sets.id"), nullable=False)

    membership: Mapped[Membership] = relationship(back_populates="sets")


class Invitation(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "invitations"
    __table_args__ = (
        # No duplicate live pending invite/request per (org, email, kind).
        Index(
            "uq_invitations_pending", "org_id", "email", "kind", unique=True,
            postgresql_where=text("status = 'pending' AND is_deleted = false"),
        ),
        Index("uq_invitations_token", "token", unique=True),
        Index("ix_invitations_org_status", "org_id", "status"),
        Index("ix_invitations_email", "email"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=InvitationStatus.PENDING.value)
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    set_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class AuditLog(TimestampedModel):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_org_time", "org_id", "created_at"),
        Index("ix_audit_logs_action", "action"),
    )

    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Notification(TimestampedModel):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_unread", "user_id", "read_at", "created_at"),
        Index("ix_notifications_org", "org_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    ref: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
