"""Guardrail DTOs. No ORM imports — enums mirror models/guardrail.py values."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


_BUFFER_DESC = (
    "buffer_then_inspect: the ONLY mode that withholds model output "
    "(non-streaming calls only; requires stage post or both). Streaming "
    "paths always deliver and record audit rows instead."
)
_INSPECT_DESC = (
    "inspect_before_buffer: bounded-window pre-delivery scan recorded as "
    "audit rows; never withholds output on streams."
)
_AUDIT_DESC = (
    "audit_after_delivery / audit_then_delivery: audit-only; output is "
    "always delivered, triggers recorded when log_triggers."
)


class RuleIn(BaseModel):
    category: str
    severity: str = "medium"
    config: dict = Field(default_factory=dict)


class AssignmentIn(BaseModel):
    scope_type: str = "global"
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    api_key_id: uuid.UUID | None = None
    applies_internal: bool = True
    applies_external: bool = True


class PolicyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    severity: str = "medium"
    enforcement: str = "warn"
    stage: str = "both"
    delivery_mode: str = Field(
        default="audit_after_delivery",
        description=f"Delivery semantics. {_BUFFER_DESC} {_INSPECT_DESC} {_AUDIT_DESC}",
    )
    log_triggers: bool = True
    notify_on_trigger: bool = False
    notify_repeat_minutes: int = Field(default=60, ge=1, le=1440)
    failure_action: str = "allow"
    confidence_threshold: float | None = None
    evaluator_timeout_ms: int = 5000
    is_enabled: bool = False
    is_mandatory: bool = False
    org_id: uuid.UUID | None = None
    rules: list[RuleIn] = Field(default_factory=list)
    assignments: list[AssignmentIn] = Field(default_factory=list)


class PolicyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    severity: str | None = None
    enforcement: str | None = None
    stage: str | None = None
    delivery_mode: str | None = Field(
        default=None,
        description=f"Delivery semantics. {_BUFFER_DESC} {_INSPECT_DESC} {_AUDIT_DESC}",
    )
    log_triggers: bool | None = None
    notify_on_trigger: bool | None = None
    notify_repeat_minutes: int | None = Field(default=None, ge=1, le=1440)
    failure_action: str | None = None
    confidence_threshold: float | None = None
    evaluator_timeout_ms: int | None = None
    is_enabled: bool | None = None
    is_mandatory: bool | None = None
    rules: list[RuleIn] | None = None
    assignments: list[AssignmentIn] | None = None


class RuleRead(BaseModel):
    id: uuid.UUID
    category: str
    severity: str
    config: dict


class EvaluatorRead(BaseModel):
    id: uuid.UUID
    evaluator_type: str
    provider_id: uuid.UUID | None
    model_ref: str | None
    credentials_masked: dict[str, str]
    operation: str | None
    timeout_ms: int | None
    threshold: float | None


class AssignmentRead(BaseModel):
    id: uuid.UUID
    scope_type: str
    provider_id: uuid.UUID | None
    model_id: uuid.UUID | None
    api_key_id: uuid.UUID | None
    applies_internal: bool
    applies_external: bool


class PolicyRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    severity: str
    enforcement: str
    stage: str
    delivery_mode: str
    log_triggers: bool
    notify_on_trigger: bool
    notify_repeat_minutes: int
    failure_action: str
    confidence_threshold: float | None
    evaluator_timeout_ms: int
    is_enabled: bool
    is_template: bool
    is_mandatory: bool
    version: int
    org_id: uuid.UUID | None
    rules: list[RuleRead] = Field(default_factory=list)
    evaluators: list[EvaluatorRead] = Field(default_factory=list)
    assignments: list[AssignmentRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TemplateRead(BaseModel):
    key: str
    name: str
    description: str
    severity: str
    enforcement: str
    stage: str
    rules: list[RuleIn] = Field(default_factory=list)
    evaluator_types: list[str] = Field(default_factory=list)


class EvaluatorCreate(BaseModel):
    evaluator_type: str
    provider_id: uuid.UUID | None = None
    model_ref: str | None = None
    credentials: dict | None = None
    operation: str | None = None
    timeout_ms: int | None = None
    threshold: float | None = None


class EvaluatorPatch(BaseModel):
    provider_id: uuid.UUID | None = None
    model_ref: str | None = None
    credentials: dict | None = None
    operation: str | None = None
    timeout_ms: int | None = None
    threshold: float | None = None


class CredentialsValidate(BaseModel):
    evaluator_type: str
    credentials: dict | None = None
    base_url: str | None = None


class CredentialsValidateResult(BaseModel):
    valid: bool
    message: str
    latency_ms: float


class TestRequest(BaseModel):
    content: str = Field(min_length=1, max_length=65536)
    stage: str = Field(
        default="pre",
        description="pre or post; both is accepted and coerced to pre (never 422 for both).",
    )
    credentials: dict | None = None
    run_llm: bool = Field(
        default=False,
        description="Opt into billable LLM escalation in the dry run. "
        "When false, llm evaluators are skipped and llm_skipped is true.",
    )


class TestResult(BaseModel):
    verdict: str
    action: str
    confidence: float
    categories: list[str] = Field(default_factory=list)
    reason: str | None = None
    evaluator_type: str | None = None
    failure_kind: str | None = None
    llm_skipped: bool = False


class EffectiveRead(BaseModel):
    policies: list[PolicyRead]
    deciding_policy_id: uuid.UUID | None


class TriggerRead(BaseModel):
    id: uuid.UUID
    policy_id: uuid.UUID | None
    policy_version: int
    workspace_type: str
    endpoint: str | None
    source: str
    stage: str | None
    category: str | None
    severity: str | None
    confidence: float | None
    enforcement: str | None
    action: str
    reason: str | None
    latency_ms: float | None
    notified: bool
    failure_kind: str | None
    created_at: datetime
