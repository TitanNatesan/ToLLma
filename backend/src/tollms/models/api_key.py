"""API Gateway keys: virtual-key schema (keys, policies, IP rules, model access).

Raw keys are never stored — only a SHA-256 hash plus a public prefix for
identification. Policies, IP rules and per-model overrides are nullable:
NULL means unlimited / not restricted. `parent_key_id`, `routing_strategy` and
`metadata` are reserved for future virtual-key routing (fallback chains, load
balancing, provider weights) so no schema rewrite is needed.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.message import Message
    from tollms.models.guardrail import GuardrailAssignment, GuardrailTrigger
    from tollms.models.organization import Organization
    from tollms.models.prompt_logging import PromptLog, PromptLoggingKeyTarget


class IpRuleType(str, enum.Enum):
    ALLOW = "allow"
    DENY = "deny"


class ApiKey(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint("key_prefix", name="uq_api_keys_prefix"),
        UniqueConstraint("key_hash", name="uq_api_keys_hash"),
        Index("ix_api_keys_user", "user_id"),
        Index("ix_api_keys_org", "org_id"),
        Index("ix_api_keys_issued_by", "issued_by"),
        Index("ix_api_keys_created", "created_at"),
        Index("ix_api_keys_enabled", "enabled"),
        Index("ix_api_keys_parent", "parent_key_id"),
        # Key names unique per org among live org rows (NULL org_id =
        # personal keys, which carry no DB name constraint — see service).
        Index(
            "uq_api_keys_org_name_live",
            "org_id",
            "name",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NOT NULL"),
        ),
        # One primary key per personal user: only personal (org_id IS NULL),
        # live, primary rows participate — org keys and non-primary
        # personal keys are unconstrained.
        Index(
            "uq_api_keys_primary_per_user",
            "user_id",
            unique=True,
            postgresql_where=text(
                "is_deleted = false AND org_id IS NULL AND is_primary = true"
            ),
        ),
        # One default key per personal user: the most-recent personal key
        # (primary is system-managed allow-list; default is the newest
        # personal key used for password-less flows). Org keys never
        # participate.
        Index(
            "uq_api_keys_default_per_user",
            "user_id",
            unique=True,
            postgresql_where=text(
                "is_deleted = false AND org_id IS NULL AND is_default = true"
            ),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # NULL = personal key (owned by user_id). Non-NULL = org-scoped key.
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    # User who issued the key (audit trail, like invitations.invited_by).
    issued_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Public, non-secret identifier shown in lists (e.g. "tma_sk_live_ab12cd34").
    key_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    # SHA-256 hex of the raw key. The raw value is shown exactly once at creation.
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Personal-key default for password-less flows. At most one live
    # primary per personal user (see uq_api_keys_primary_per_user).
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Personal-key default (most-recent personal key) vs primary (system
    # allow-list key): a primary is usually also the default, but a newer
    # user-created key takes over the default slot while the primary stays.
    is_default: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rotation_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Reserved for future virtual keys: a child key inherits/routes through a
    # parent; routing_strategy + metadata carry fallback chains, weights, etc.
    parent_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    routing_strategy: Mapped[str | None] = mapped_column(String(32), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    policy: Mapped["ApiKeyPolicy | None"] = relationship(
        back_populates="api_key", cascade="all, delete-orphan", uselist=False
    )
    organization: Mapped["Organization | None"] = relationship(back_populates="api_keys")
    ip_rules: Mapped[list["ApiKeyIpRule"]] = relationship(
        back_populates="api_key", cascade="all, delete-orphan"
    )
    model_permissions: Mapped[list["ApiKeyModelPermission"]] = relationship(
        back_populates="api_key", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(back_populates="api_key")
    guardrail_assignments: Mapped[list["GuardrailAssignment"]] = relationship(back_populates="api_key")
    guardrail_triggers: Mapped[list["GuardrailTrigger"]] = relationship(back_populates="api_key")
    prompt_logs: Mapped[list["PromptLog"]] = relationship(back_populates="api_key")
    prompt_logging_key_targets: Mapped[list["PromptLoggingKeyTarget"]] = relationship(
        back_populates="api_key"
    )


class ApiKeyPolicy(TimestampedModel):
    """One policy row per key. NULL = unlimited; 0 means blocked when set."""

    __tablename__ = "api_key_policies"
    __table_args__ = (UniqueConstraint("api_key_id", name="uq_api_key_policies_key"),)

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False
    )
    max_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    budget_reset_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rph: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rpd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tpd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_spend_limit: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    monthly_spend_limit: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)

    api_key: Mapped["ApiKey"] = relationship(back_populates="policy")


class ApiKeyIpRule(TimestampedModel):
    __tablename__ = "api_key_ip_rules"
    __table_args__ = (
        Index("ix_api_key_ip_rules_key", "api_key_id"),
        UniqueConstraint("api_key_id", "type", "cidr", name="uq_api_key_ip_rule"),
    )

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[IpRuleType] = mapped_column(
        Enum(IpRuleType, name="api_key_ip_rule_type"), nullable=False
    )
    # Single IP or CIDR block, IPv4 or IPv6 (validated at the API layer).
    cidr: Mapped[str] = mapped_column(String(64), nullable=False)

    api_key: Mapped["ApiKey"] = relationship(back_populates="ip_rules")


class ApiKeyModelPermission(TimestampedModel):
    """Per-model override. A key with any row is restricted to those rows'
    enabled models; provider_id/model_id NULL means "any" for that dimension."""

    __tablename__ = "api_key_model_permissions"
    __table_args__ = (
        Index("ix_api_key_model_perms_key", "api_key_id"),
        Index("ix_api_key_model_perms_model", "model_id"),
        UniqueConstraint("api_key_id", "provider_id", "model_id", name="uq_api_key_model_scope"),
    )

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    rpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tpm: Mapped[int | None] = mapped_column(Integer, nullable=True)

    api_key: Mapped["ApiKey"] = relationship(back_populates="model_permissions")


class ApiRequestLog(TimestampedModel):
    """One row per public-gateway request. Aggregates only — no payloads."""

    __tablename__ = "api_request_logs"
    __table_args__ = (
        Index("ix_api_request_logs_key_created", "api_key_id", "created_at"),
        Index("ix_api_request_logs_user_created", "user_id", "created_at"),
        Index("ix_api_request_logs_org_created", "org_id", "created_at"),
        Index("ix_api_request_logs_created", "created_at"),
        Index("ix_api_request_logs_model_created", "model", "created_at"),
        Index("ix_api_request_logs_endpoint", "endpoint"),
        Index("ix_api_request_logs_country", "country"),
    )

    request_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Org attribution for the org usage ledger (NULL = personal-key traffic).
    # Populated by the backend layer; column-only (no relationship), mirroring
    # audit_logs/notification org columns.
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    endpoint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="success", nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(nullable=True)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 8), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    browser: Mapped[str | None] = mapped_column(String(32), nullable=True)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    region: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_streaming: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # True when token/cost figures are locally estimated (provider silent)
    # rather than provider-reported. Failed in-app rows that estimated from
    # partial output set this; unknown values stay NULL, not zero.
    usage_estimated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
