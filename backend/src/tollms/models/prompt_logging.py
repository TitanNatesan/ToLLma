"""Workspace prompt logging: per-workspace capture settings, key targets, immutable log ledger."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.api_key import ApiKey
    from tollms.models.conversation import Conversation
    from tollms.models.organization import Organization
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.scores import Score
    from tollms.models.user import User

MODES = ("global", "keys")
STATUSES = ("completed", "cancelled", "failed", "partial")
SOURCES = ("internal", "external")
PROVENANCES = ("personal", "organization")
MATCH_SOURCES = ("global", "key")

# Bodies are bounded before encryption (chars, not bytes — JSON text).
MAX_BODY_CHARS = 512 * 1024


class PromptLoggingSetting(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "prompt_logging_settings"
    __table_args__ = (
        # Exactly one workspace: personal (user_id set) or org (org_id set).
        CheckConstraint(
            "(user_id IS NULL) != (org_id IS NULL)",
            name="ck_prompt_logging_settings_owner_scope",
        ),
        Index("ix_prompt_logging_settings_user", "user_id"),
        Index("ix_prompt_logging_settings_org", "org_id"),
        Index(
            "uq_prompt_logging_settings_personal_live",
            "user_id",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NULL"),
        ),
        Index(
            "uq_prompt_logging_settings_org_live",
            "org_id",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NOT NULL"),
        ),
    )

    # Ownership mirrors providers: NULL org_id = personal (user_id owner);
    # non-NULL org_id = org-scoped (user_id stays NULL).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="global", nullable=False)
    capture_input: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    capture_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    retention_days: Mapped[int | None] = mapped_column(Integer, default=90, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    owner: Mapped["User | None"] = relationship(back_populates="prompt_logging_settings")
    organization: Mapped["Organization | None"] = relationship(back_populates="prompt_logging_settings")
    key_targets: Mapped[list["PromptLoggingKeyTarget"]] = relationship(
        back_populates="setting", cascade="all, delete-orphan"
    )
    key_overrides: Mapped[list["PromptLoggingKeyOverride"]] = relationship(
        back_populates="setting", cascade="all, delete-orphan"
    )


class PromptLoggingKeyTarget(TimestampedModel):
    """Keys mode allow-list: only these API keys are captured.

    No soft-delete (link table): an empty target list in keys mode logs
    nothing, never falls back to global.
    """

    __tablename__ = "prompt_logging_key_targets"
    __table_args__ = (
        Index("uq_prompt_logging_key_targets", "setting_id", "api_key_id", unique=True),
        Index("ix_prompt_logging_key_targets_setting", "setting_id"),
        Index("ix_prompt_logging_key_targets_key", "api_key_id"),
    )

    setting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False
    )
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False
    )

    setting: Mapped["PromptLoggingSetting"] = relationship(back_populates="key_targets")
    api_key: Mapped["ApiKey"] = relationship(back_populates="prompt_logging_key_targets")


class PromptLoggingKeyOverride(TimestampedModel):
    """Per-key enablement override within one setting (hierarchical enablement).

    The key allow-list (``PromptLoggingKeyTarget``) stays the eligibility
    set: a listed key with no override row defaults to True (inherit). An
    explicit row forces the leg on (True) or off (False, vetoes capture).
    ``enabled=None`` (NULL) is inherit — equivalent to no row; the API
    deletes NULL rows. No soft-delete (link table).
    """

    __tablename__ = "prompt_logging_key_overrides"
    __table_args__ = (
        Index("uq_prompt_logging_key_overrides", "setting_id", "api_key_id", unique=True),
        Index("ix_prompt_logging_key_overrides_setting", "setting_id"),
        Index("ix_prompt_logging_key_overrides_key", "api_key_id"),
    )

    setting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False
    )
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    setting: Mapped["PromptLoggingSetting"] = relationship(back_populates="key_overrides")
    api_key: Mapped["ApiKey"] = relationship(back_populates="prompt_logging_key_overrides")


class PromptLog(TimestampedModel):
    """Append-only prompt ledger. Immutable like guardrail_triggers: expiry
    NULLs the ciphers (content_expired) but metadata rows are never deleted."""

    __tablename__ = "prompt_logs"
    __table_args__ = (
        Index("ix_prompt_logs_org_created", "org_id", "created_at"),
        Index("ix_prompt_logs_user_created", "user_id", "created_at"),
        Index("ix_prompt_logs_key_created", "api_key_id", "created_at"),
        Index("ix_prompt_logs_conversation", "conversation_id", "created_at"),
        Index("ix_prompt_logs_provider", "provider_id", "created_at"),
        Index("ix_prompt_logs_model", "model_id", "created_at"),
        Index("ix_prompt_logs_request", "request_id"),
        # Queue idempotency: redeliveries of one capture (same request_id AND
        # generation_id) collapse here; NULL request_ids (legacy rows) are
        # exempt. Composite — NOT request_id alone: internal chat reuses one
        # request_id per conversation across many generations, so a bare
        # request_id unique index would both brick the migration on live data
        # and drop legitimate rows as "duplicates".
        Index(
            "uq_prompt_logs_request_delivery",
            "request_id",
            "generation_id",
            unique=True,
            postgresql_where=text("request_id IS NOT NULL"),
        ),
        Index("ix_prompt_logs_expires", "expires_at"),
        Index("ix_prompt_logs_status", "status"),
        Index("ix_prompt_logs_created", "created_at"),
        Index("ix_prompt_logs_trace", "trace_id"),
        Index("ix_prompt_logs_session_key", "session_key"),
        Index("ix_prompt_logs_generation", "generation_id"),
    )

    workspace_type: Mapped[str] = mapped_column(String(16), default="personal", nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    key_provenance: Mapped[str] = mapped_column(String(16), default="personal", nullable=False)
    # Which allow-list leg matched: global|key. NULL only for rows
    # written before key targets existed (legacy rows); rows written before
    # team targets were dropped may carry the legacy value "team".
    # Explicit key overrides surface as key (force-on).
    match_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )
    endpoint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(16), default="internal", nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Logical link only (no FK): internal rows carry messages.id, public rows
    # carry a deterministic per-request UUID that references no message row.
    generation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="completed", nullable=False)
    # Encrypted bodies (Fernet via core/crypto). Never raw secrets/headers.
    input_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_truncated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    output_truncated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    input_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Full usage accounting (Langfuse parity). NULL = unknown/pre-migration —
    # never backfilled with 0 (an unpriced row must not read as free).
    usage_estimated: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Ledger costs (Decimal, models.dev USD convention). NULL = unpriced.
    input_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    output_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Price valid-as-of pin (repo sync identity); NULL = unknown.
    pricing_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Cross-plane correlation. Internal: str(conversation_id or generation_id);
    # public: request_id (uuid4 hex per request). No FK (string, cross-plane).
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # User-settable cross-plane session grouping (public: client-supplied).
    session_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Generation detail persisted from the in-memory result.
    finish_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Error diagnostics. level derived from status; status_message scrubbed.
    level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    policy_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    content_expired: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User | None"] = relationship(back_populates="prompt_logs")
    organization: Mapped["Organization | None"] = relationship(back_populates="prompt_logs")
    api_key: Mapped["ApiKey | None"] = relationship(back_populates="prompt_logs")
    conversation: Mapped["Conversation | None"] = relationship(back_populates="prompt_logs")
    provider: Mapped["Provider | None"] = relationship(back_populates="prompt_logs")
    model: Mapped["AIModel | None"] = relationship(back_populates="prompt_logs")
    scores: Mapped[list["Score"]] = relationship(back_populates="prompt_log")
