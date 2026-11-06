"""Centralized security audit log (F6 envelope, frozen 2026-11-07).

Append-only: no UPDATE/DELETE path at the API layer; retention/purge is the
only writer besides `record_event` (Agent B retention rules apply, 400d hot).
`event_id` is the PK per the frozen envelope (not the usual `id`), with
`created_at`/`updated_at` + soft-delete columns matching the repo conventions.
Secrets policy: `metadata_` carries ids/codes/counters only — the service
scrubs secret-marked keys before persisting (mirrors the `emit()` backstop).

NOTE: orchestrator must add `from tollms.models.security_audit import ...`
to `models/__init__.py` (shared file, Agent C may not touch it).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from tollms.db.base import Base


class SecurityActorType(str, enum.Enum):
    USER = "user"
    API_KEY = "api_key"
    SYSTEM = "system"
    ANONYMOUS = "anonymous"


class SecurityEventType(str, enum.Enum):
    AUTH_LOGIN = "auth.login"
    AUTH_LOGIN_FAILED = "auth.login_failed"
    AUTH_LOCKOUT = "auth.lockout"
    AUTH_REFRESH_REUSE = "auth.refresh_reuse"
    SESSION_REVOKED = "session.revoked"
    KEY_CREATED = "key.created"
    KEY_ROTATED = "key.rotated"
    KEY_DELETED = "key.deleted"
    PROVIDER_CREDENTIALS_WRITTEN = "provider.credentials_written"
    PROVIDER_VALIDATED = "provider.validated"
    GATEWAY_DENIED = "gateway.denied"
    GATEWAY_OVERBUDGET = "gateway.overbudget"
    ORG_PERM_CHANGED = "org.perm_changed"
    ORG_MEMBER_REMOVED = "org.member_removed"
    EGRESS_BLOCKED = "egress.blocked"
    CONFIG_SECURITY_CHANGED = "config.security_changed"


class SecuritySeverity(str, enum.Enum):
    INFO = "info"
    WARN = "warn"
    CRITICAL = "critical"


class SecurityOutcome(str, enum.Enum):
    ALLOWED = "allowed"
    DENIED = "denied"
    ERROR = "error"


_ACTOR_VALUES = ", ".join(f"'{v.value}'" for v in SecurityActorType)
_EVENT_VALUES = ", ".join(f"'{v.value}'" for v in SecurityEventType)
_SEVERITY_VALUES = ", ".join(f"'{v.value}'" for v in SecuritySeverity)
_OUTCOME_VALUES = ", ".join(f"'{v.value}'" for v in SecurityOutcome)


class SecurityAuditEvent(Base):
    __tablename__ = "security_audit"
    __table_args__ = (
        CheckConstraint(f"actor_type IN ({_ACTOR_VALUES})", name="ck_security_audit_actor_type"),
        CheckConstraint(f"event_type IN ({_EVENT_VALUES})", name="ck_security_audit_event_type"),
        CheckConstraint(f"severity IN ({_SEVERITY_VALUES})", name="ck_security_audit_severity"),
        CheckConstraint(f"outcome IN ({_OUTCOME_VALUES})", name="ck_security_audit_outcome"),
        Index("ix_security_audit_occurred", "occurred_at", "event_id"),
        Index("ix_security_audit_actor", "actor_user_id", "occurred_at"),
        Index("ix_security_audit_target", "target_type", "target_id"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_key_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default=SecuritySeverity.INFO.value)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default=SecurityOutcome.ALLOWED.value)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # `metadata` is reserved on SQLAlchemy models; the column is `metadata`.
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
