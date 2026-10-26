"""Workspace prompt logging: per-workspace capture settings, team targets, immutable log ledger."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.api_key import ApiKey
    from tollms.models.conversation import Conversation
    from tollms.models.organization import Organization, Team
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.user import User

MODES = ("global", "teams")
STATUSES = ("completed", "cancelled", "failed", "partial")
SOURCES = ("internal", "external")
PROVENANCES = ("personal", "organization")
MATCH_SOURCES = ("global", "team", "key")

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
    retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    owner: Mapped["User | None"] = relationship(back_populates="prompt_logging_settings")
    organization: Mapped["Organization | None"] = relationship(back_populates="prompt_logging_settings")
    targets: Mapped[list["PromptLoggingTeamTarget"]] = relationship(
        back_populates="setting", cascade="all, delete-orphan"
    )
    key_targets: Mapped[list["PromptLoggingKeyTarget"]] = relationship(
        back_populates="setting", cascade="all, delete-orphan"
    )


class PromptLoggingTeamTarget(TimestampedModel):
    """Teams mode allow-list: only members of these teams are captured.

    No soft-delete (link table, like team_memberships): an empty target list
    in teams mode logs nothing, never falls back to global.
    """

    __tablename__ = "prompt_logging_team_targets"
    __table_args__ = (
        Index("uq_prompt_logging_team_targets", "setting_id", "team_id", unique=True),
        Index("ix_prompt_logging_team_targets_setting", "setting_id"),
        Index("ix_prompt_logging_team_targets_team", "team_id"),
    )

    setting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_logging_settings.id", ondelete="CASCADE"), nullable=False
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )

    setting: Mapped["PromptLoggingSetting"] = relationship(back_populates="targets")
    team: Mapped["Team"] = relationship(back_populates="prompt_logging_targets")


class PromptLoggingKeyTarget(TimestampedModel):
    """Teams mode allow-list, key leg: only these API keys are captured.

    No soft-delete (link table, like team targets): an empty target list
    in teams mode logs nothing, never falls back to global.
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
        Index("ix_prompt_logs_expires", "expires_at"),
        Index("ix_prompt_logs_status", "status"),
        Index("ix_prompt_logs_created", "created_at"),
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
    team_ids: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # Which allow-list leg matched: global|team|key. NULL only for rows
    # written before key targets existed (legacy rows).
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
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    policy_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    content_expired: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    owner: Mapped["User | None"] = relationship(back_populates="prompt_logs")
    organization: Mapped["Organization | None"] = relationship(back_populates="prompt_logs")
    api_key: Mapped["ApiKey | None"] = relationship(back_populates="prompt_logs")
    conversation: Mapped["Conversation | None"] = relationship(back_populates="prompt_logs")
    provider: Mapped["Provider | None"] = relationship(back_populates="prompt_logs")
    model: Mapped["AIModel | None"] = relationship(back_populates="prompt_logs")
