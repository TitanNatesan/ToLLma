"""Provider registry table."""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.organization import Organization
    from tollms.models.guardrail import GuardrailAssignment, GuardrailEvaluatorConfig, GuardrailTrigger
    from tollms.models.registered_model import AIModel
    from tollms.models.user import User


class ProviderType(str, enum.Enum):
    """Provider families. OpenAI is a single provider whose models carry the
    endpoint they support (responses, chat_completions, embeddings, images,
    audio) — the endpoint lives on the model, never on the provider."""

    OPENAI = "OPENAI"
    ANTHROPIC_MESSAGES = "ANTHROPIC_MESSAGES"
    GEMINI = "GEMINI"
    VERTEX_AI = "VERTEX_AI"
    BEDROCK_CONVERSE = "BEDROCK_CONVERSE"
    CUSTOM = "CUSTOM"


class Provider(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "providers"
    __table_args__ = (
        # Ownership is decided SOLELY by org_id: NULL = personal (user_id is
        # the owner, NOT NULL); NOT NULL = org-owned (user_id is creator
        # audit, never scope). Both-set rows are valid org rows.
        CheckConstraint(
            "(org_id IS NULL AND user_id IS NOT NULL) OR (org_id IS NOT NULL)",
            name="ck_providers_owner_scope",
        ),
        Index("ix_providers_type", "provider_type"),
        Index("ix_providers_active", "is_active"),
        Index("ix_providers_created", "created_at"),
        Index("ix_providers_user", "user_id"),
        Index("ix_providers_org", "org_id"),
        # Names unique per scope among live rows: personal keys live under
        # (user_id, name) with org_id IS NULL; org providers under
        # (org_id, name) with org_id IS NOT NULL. NULL user_id legacy rows
        # never conflict (PostgreSQL treats NULLs as distinct).
        Index(
            "uq_providers_personal_name_live",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NULL"),
        ),
        Index(
            "uq_providers_org_name_live",
            "org_id",
            "name",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # NULL = personal provider (owned by user_id). Non-NULL = org-scoped.
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[ProviderType] = mapped_column(Enum(ProviderType, name="provider_type"), nullable=False)
    credentials_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    validation_status: Mapped[str] = mapped_column(String(16), default="unknown", nullable=False)
    validation_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    models: Mapped[list["AIModel"]] = relationship(back_populates="provider")
    owner: Mapped["User | None"] = relationship(back_populates="providers")
    organization: Mapped["Organization | None"] = relationship(back_populates="providers")
    guardrail_evaluator_configs: Mapped[list["GuardrailEvaluatorConfig"]] = relationship(back_populates="provider")
    guardrail_assignments: Mapped[list["GuardrailAssignment"]] = relationship(back_populates="provider")
    guardrail_triggers: Mapped[list["GuardrailTrigger"]] = relationship(back_populates="provider")
