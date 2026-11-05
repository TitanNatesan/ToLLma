"""Guardrail tables: policies, rules, evaluator configs, assignments, triggers."""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.api_key import ApiKey
    from tollms.models.organization import Organization
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.user import User


class Severity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Enforcement(str, enum.Enum):
    MONITOR = "monitor"
    WARN = "warn"
    BLOCK = "block"


class Stage(str, enum.Enum):
    PRE = "pre"
    POST = "post"
    BOTH = "both"


class DeliveryMode(str, enum.Enum):
    BUFFER_THEN_INSPECT = "buffer_then_inspect"
    INSPECT_BEFORE_BUFFER = "inspect_before_buffer"
    AUDIT_AFTER_DELIVERY = "audit_after_delivery"
    AUDIT_THEN_DELIVERY = "audit_then_delivery"


class EvaluatorType(str, enum.Enum):
    DETERMINISTIC = "deterministic"
    LAYA = "laya"
    OPENAI_MODERATION = "openai_moderation"
    JEV = "jev"
    LLM = "llm"


class Category(str, enum.Enum):
    HARMFUL_CONTENT = "harmful_content"
    PROMPT_INJECTION = "prompt_injection"
    SECRET_LEAKAGE = "secret_leakage"
    PII = "pii"
    UNSAFE_OUTPUT = "unsafe_output"
    DATA_DISCLOSURE = "data_disclosure"
    UNTRUSTED_INSTRUCTION = "untrusted_instruction"
    INVALID_STRUCTURE = "invalid_structure"
    DOMAIN_VIOLATION = "domain_violation"
    TOOL_ACTION = "tool_action"


class Source(str, enum.Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"


class Action(str, enum.Enum):
    ALLOWED = "allowed"
    WARNED = "warned"
    BLOCKED = "blocked"
    FALLBACK_CONTINUED = "fallback_continued"


_SCOPE_TYPES = ("global", "provider", "key")


class GuardrailPolicy(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "guardrail_policies"
    __table_args__ = (
        Index("ix_guardrail_policies_org", "org_id"),
        Index("ix_guardrail_policies_user", "user_id"),
        Index("ix_guardrail_policies_created", "created_at"),
        Index("ix_guardrail_policies_enabled", "is_enabled"),
        Index("ix_guardrail_policies_template", "is_template"),
        Index(
            "uq_guardrail_policies_personal_name_live",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NULL"),
        ),
        Index(
            "uq_guardrail_policies_org_name_live",
            "org_id",
            "name",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NOT NULL"),
        ),
    )

    # Ownership mirrors providers: NULL org_id = personal (user_id owner);
    # non-NULL org_id = org-scoped. System templates carry neither.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default=Severity.MEDIUM.value, nullable=False)
    enforcement: Mapped[str] = mapped_column(String(16), default=Enforcement.WARN.value, nullable=False)
    stage: Mapped[str] = mapped_column(String(8), default=Stage.BOTH.value, nullable=False)
    delivery_mode: Mapped[str] = mapped_column(
        String(32), default=DeliveryMode.AUDIT_AFTER_DELIVERY.value, nullable=False
    )
    log_triggers: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_on_trigger: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notify_repeat_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    failure_action: Mapped[str] = mapped_column(String(8), default="allow", nullable=False)
    confidence_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    evaluator_timeout_ms: Mapped[int] = mapped_column(Integer, default=5000, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_template: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    owner: Mapped["User | None"] = relationship(back_populates="guardrail_policies")
    organization: Mapped["Organization | None"] = relationship(back_populates="guardrail_policies")
    rules: Mapped[list["GuardrailRule"]] = relationship(back_populates="policy")
    evaluators: Mapped[list["GuardrailEvaluatorConfig"]] = relationship(back_populates="policy")
    assignments: Mapped[list["GuardrailAssignment"]] = relationship(back_populates="policy")
    triggers: Mapped[list["GuardrailTrigger"]] = relationship(back_populates="policy")


class GuardrailRule(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "guardrail_rules"
    __table_args__ = (
        Index("ix_guardrail_rules_policy", "policy_id"),
        Index("ix_guardrail_rules_created", "created_at"),
    )

    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default=Severity.MEDIUM.value, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    policy: Mapped["GuardrailPolicy"] = relationship(back_populates="rules")


class GuardrailEvaluatorConfig(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "guardrail_evaluator_configs"
    __table_args__ = (
        Index("ix_guardrail_evaluator_configs_policy", "policy_id"),
        Index("ix_guardrail_evaluator_configs_provider", "provider_id"),
        Index("ix_guardrail_evaluator_configs_created", "created_at"),
    )

    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False
    )
    evaluator_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # Generation provider ref for llm evaluators (nullable for the rest).
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True
    )
    model_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    credentials_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    operation: Mapped[str | None] = mapped_column(String(64), nullable=True)
    timeout_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)

    policy: Mapped["GuardrailPolicy"] = relationship(back_populates="evaluators")
    provider: Mapped["Provider | None"] = relationship(back_populates="guardrail_evaluator_configs")


class GuardrailAssignment(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "guardrail_assignments"
    __table_args__ = (
        Index("ix_guardrail_assignments_policy", "policy_id"),
        Index("ix_guardrail_assignments_provider", "provider_id"),
        Index("ix_guardrail_assignments_model", "model_id"),
        Index("ix_guardrail_assignments_key", "api_key_id"),
        Index("ix_guardrail_assignments_created", "created_at"),
    )

    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False
    )
    scope_type: Mapped[str] = mapped_column(String(16), default="global", nullable=False)
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), nullable=True
    )
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=True
    )
    applies_internal: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    applies_external: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    policy: Mapped["GuardrailPolicy"] = relationship(back_populates="assignments")
    provider: Mapped["Provider | None"] = relationship(back_populates="guardrail_assignments")
    model: Mapped["AIModel | None"] = relationship(back_populates="guardrail_assignments")
    api_key: Mapped["ApiKey | None"] = relationship(back_populates="guardrail_assignments")


class GuardrailTrigger(TimestampedModel):
    """Append-only audit row. No soft-delete: history is immutable."""

    __tablename__ = "guardrail_triggers"
    __table_args__ = (
        Index("ix_guardrail_triggers_policy", "policy_id"),
        Index("ix_guardrail_triggers_org", "org_id"),
        Index("ix_guardrail_triggers_user", "user_id"),
        Index("ix_guardrail_triggers_created", "created_at"),
        Index("ix_guardrail_triggers_action", "action"),
        Index("ix_guardrail_triggers_severity", "severity"),
        Index("ix_guardrail_triggers_provider", "provider_id"),
        Index("ix_guardrail_triggers_key", "api_key_id"),
    )

    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardrail_policies.id", ondelete="SET NULL"), nullable=True
    )
    policy_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    workspace_type: Mapped[str] = mapped_column(String(16), default="personal", nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    generation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    endpoint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default=Source.INTERNAL.value, nullable=False)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )
    evaluator_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    stage: Mapped[str | None] = mapped_column(String(8), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    enforcement: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(24), default=Action.ALLOWED.value, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    input_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    notified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    failure_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)

    policy: Mapped["GuardrailPolicy | None"] = relationship(back_populates="triggers")
    owner: Mapped["User | None"] = relationship(back_populates="guardrail_triggers")
    organization: Mapped["Organization | None"] = relationship(back_populates="guardrail_triggers")
    api_key: Mapped["ApiKey | None"] = relationship(back_populates="guardrail_triggers")
    provider: Mapped["Provider | None"] = relationship(back_populates="guardrail_triggers")
    model: Mapped["AIModel | None"] = relationship(back_populates="guardrail_triggers")
