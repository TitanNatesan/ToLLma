"""Guardrails feature service: CRUD + auth + evaluation wiring.

Routers stay thin; engines live in services/guardrails. Personal rows are
owner-only; org rows need ACTIVE membership + the per-endpoint Guardrails.*
permission. Misses are 404 oracles (no existence leak).
"""

import base64
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.orgs.common.guards import _member_org, _require_perm
from tollms.core.crypto import decrypt, encrypt
from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.guardrail import (
    GuardrailAssignment,
    GuardrailEvaluatorConfig,
    GuardrailPolicy,
    GuardrailRule,
    GuardrailTrigger,
)

logger = logging.getLogger(__name__)

_MANDATORY_GLOBAL_MSG = "mandatory policies require global coverage while enabled"


def _assignment_scope(item) -> str:
    if hasattr(item, "scope_type"):
        return str(getattr(item, "scope_type", None) or "global")
    if isinstance(item, dict):
        return str(item.get("scope_type", "global") or "global")
    return "global"


def _has_global(items) -> bool:
    """True when any assignment-like item is global scope (case-insensitive)."""
    return any((_assignment_scope(i) or "global").lower() == "global" for i in items)

SEVERITIES = {"low", "medium", "high", "critical"}
ENFORCEMENTS = {"monitor", "warn", "block"}
STAGES = {"pre", "post", "both"}
DELIVERIES = {"buffer_then_inspect", "inspect_before_buffer",
              "audit_after_delivery", "audit_then_delivery"}
FAILURE_ACTIONS = {"allow", "block"}
EVALUATOR_TYPES = {"deterministic", "laya", "openai_moderation", "jev", "llm"}
CATEGORIES = {"harmful_content", "prompt_injection", "secret_leakage", "pii",
              "unsafe_output", "data_disclosure", "untrusted_instruction",
              "invalid_structure", "domain_violation", "tool_action"}
SCOPES = {"global", "provider", "key"}

SEED_TEMPLATES: list[dict] = [
    {"key": "content-safety", "name": "Content Safety",
     "description": "Blocks harmful content via Laya + deterministic heuristics.",
     "severity": "high", "enforcement": "warn", "stage": "both",
     "rules": [{"category": "harmful_content", "severity": "high", "config": {}}],
     "evaluator_types": ["laya"]},
    {"key": "prompt-injection", "name": "Prompt Injection Guard",
     "description": "Blocks ignore-previous-instructions / jailbreak style attacks.",
     "severity": "high", "enforcement": "block", "stage": "pre",
     "rules": [{"category": "prompt_injection", "severity": "high", "config": {}}],
     "evaluator_types": ["laya"]},
    {"key": "secret-leakage", "name": "Secret Leakage Guard",
     "description": "Blocks API keys, tokens and private keys in transit.",
     "severity": "high", "enforcement": "block", "stage": "both",
     "rules": [{"category": "secret_leakage", "severity": "high", "config": {}}],
     "evaluator_types": []},
    {"key": "pii", "name": "PII Guard",
     "description": "Warns on emails, phones and SSN-shaped numbers.",
     "severity": "medium", "enforcement": "warn", "stage": "both",
     "rules": [{"category": "pii", "severity": "medium", "config": {}}],
     "evaluator_types": []},
    {"key": "unsafe-output", "name": "Unsafe Output Guard",
     "description": "Post-delivery audit of model outputs (audit-only on streams).",
     "severity": "high", "enforcement": "warn", "stage": "post",
     "rules": [{"category": "unsafe_output", "severity": "high", "config": {}}],
     "evaluator_types": ["laya"]},
    {"key": "structured-validation", "name": "Structured Validation",
     "description": "Validates JSON outputs against the rule schema.",
     "severity": "medium", "enforcement": "warn", "stage": "post",
     "rules": [{"category": "invalid_structure", "severity": "medium",
                "config": {"schema": {"type": "object"}}},
               {"category": "domain_violation", "severity": "low", "config": {}}],
     "evaluator_types": []},
    {"key": "tool-safety", "name": "Tool Safety Guard",
     "description": "Flags risky tool-action keywords before execution.",
     "severity": "medium", "enforcement": "warn", "stage": "pre",
     "rules": [{"category": "tool_action", "severity": "medium", "config": {}}],
     "evaluator_types": []},
    {"key": "org-boundary", "name": "Org Boundary Guard",
     "description": "Blocks data-disclosure and untrusted instructions across org scope. "
                    "Org membership auth is enforced by the resolver, not the text scan.",
     "severity": "critical", "enforcement": "block", "stage": "both",
     "rules": [{"category": "data_disclosure", "severity": "critical", "config": {}},
               {"category": "untrusted_instruction", "severity": "high", "config": {}}],
     "evaluator_types": []},
]

_STREAMING_NOTE = (
    "Streaming paths always deliver and audit (audit_after_delivery / "
    "audit_then_delivery / inspect_before_buffer are recorded as audit rows); "
    "only non-streaming calls with buffer_then_inspect can withhold output."
)


def _slug(name: str) -> str:
    return "-".join("".join(c.lower() if c.isalnum() else " " for c in name).split())


def validate_policy_fields(data, *, is_create: bool = False) -> None:
    get = (lambda k, d=None: getattr(data, k, d)) if not isinstance(data, dict) else data.get
    checks = [("severity", SEVERITIES), ("enforcement", ENFORCEMENTS), ("stage", STAGES),
              ("delivery_mode", DELIVERIES), ("failure_action", FAILURE_ACTIONS)]
    for field, allowed in checks:
        value = get(field, None)
        if value is None and not is_create:
            continue
        if value not in allowed:
            raise ValidationError(f"invalid {field}: {value!r}")
    if get("delivery_mode", None) == "buffer_then_inspect":
        stage = get("stage", "both" if not is_create else None)
        if stage is not None and stage not in ("post", "both"):
            raise ValidationError(
                "buffer_then_inspect requires stage post or both; "
                "pre-only inspection cannot withhold output. " + _STREAMING_NOTE
            )
    for rule in get("rules", None) or []:
        cat = rule.category if hasattr(rule, "category") else rule.get("category")
        sev = rule.severity if hasattr(rule, "severity") else rule.get("severity", "medium")
        if cat not in CATEGORIES:
            raise ValidationError(f"invalid category: {cat!r}")
        if sev not in SEVERITIES:
            raise ValidationError(f"invalid rule severity: {sev!r}")
    for assignment in get("assignments", None) or []:
        scope = assignment.scope_type if hasattr(assignment, "scope_type") else assignment.get("scope_type", "global")
        if (scope or "global").lower() not in SCOPES:
            raise ValidationError(f"invalid scope_type: {scope!r}")
    repeat = get("notify_repeat_minutes", None)
    if repeat is not None:
        if isinstance(repeat, bool) or not isinstance(repeat, int) or not 1 <= repeat <= 1440:
            raise ValidationError(f"invalid notify_repeat_minutes: {repeat!r}")


def _validate_assignment_refs(db: Session, caller_id: uuid.UUID,
                              org_id: uuid.UUID | None, assignments) -> bool:
    """Scope/ref consistency + workspace ownership for policy assignments.

    validate_policy_fields already rejects unknown scope_type values and the
    buffer+pre combination; this covers the rest: contradictory scope/refs
    (422), foreign provider/model/key refs — including forged global scope
    carrying another workspace's refs (404 oracle, no existence leak).

    Returns True when any key-scoped assignment is present, so callers can
    additionally require Guardrails.Update + key assign authority.
    """
    from tollms.models.api_key import ApiKey
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    items = list(assignments or [])
    if not items:
        return False
    key_scoped = False
    for item in items:
        get = (lambda k, d=None: getattr(item, k, d)) if hasattr(item, "scope_type") else item.get
        scope = (get("scope_type", "global") or "global").lower()
        provider_id = get("provider_id")
        model_id = get("model_id")
        key_id = get("api_key_id")
        if scope == "global":
            if provider_id is not None or model_id is not None or key_id is not None:
                raise ValidationError("global scope must not carry provider/model/key refs")
        elif scope == "provider":
            if provider_id is None:
                raise ValidationError("provider scope requires provider_id")
            if key_id is not None:
                raise ValidationError("provider scope must not carry api_key_id")
        elif scope == "key":
            if key_id is None:
                raise ValidationError("key scope requires api_key_id")
            key_scoped = True
        if provider_id is not None:
            provider = db.get(Provider, provider_id)
            if provider is None or provider.is_deleted:
                raise NotFoundError("guardrail policy not found")
            if org_id is None:
                if provider.org_id is not None or provider.user_id != caller_id:
                    raise NotFoundError("guardrail policy not found")
            elif provider.org_id != org_id:
                raise NotFoundError("guardrail policy not found")
        if model_id is not None:
            model = db.get(AIModel, model_id)
            if model is None or model.is_deleted or model.provider_id is None:
                raise NotFoundError("guardrail policy not found")
            provider = db.get(Provider, model.provider_id)
            if provider is None or provider.is_deleted:
                raise NotFoundError("guardrail policy not found")
            if org_id is None:
                if provider.org_id is not None or provider.user_id != caller_id:
                    raise NotFoundError("guardrail policy not found")
            elif provider.org_id != org_id:
                raise NotFoundError("guardrail policy not found")
        if key_id is not None:
            key = db.get(ApiKey, key_id)
            if key is None or key.is_deleted:
                raise NotFoundError("guardrail policy not found")
            if org_id is None:
                if key.org_id is not None or key.user_id != caller_id:
                    raise NotFoundError("guardrail policy not found")
            elif key.org_id != org_id:
                raise NotFoundError("guardrail policy not found")
            key_scoped = True
    return key_scoped


def _scope(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
           code: str) -> tuple[str, uuid.UUID | None]:
    if org_id is None:
        return "personal", None
    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, code)
    return "organization", org_id


def _visible_query(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None):
    stmt = select(GuardrailPolicy).where(
        GuardrailPolicy.is_deleted.is_(False), GuardrailPolicy.is_template.is_(False))
    if org_id is None:
        return stmt.where(GuardrailPolicy.org_id.is_(None),
                          GuardrailPolicy.user_id == caller_id)
    return stmt.where(GuardrailPolicy.org_id == org_id)


def _get_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                org_id: uuid.UUID | None) -> GuardrailPolicy:
    policy = db.get(GuardrailPolicy, policy_id)
    if policy is None or policy.is_deleted or policy.is_template:
        raise NotFoundError("guardrail policy not found")
    if org_id is None:
        if policy.org_id is not None or policy.user_id != caller_id:
            raise NotFoundError("guardrail policy not found")
    elif policy.org_id != org_id:
        raise NotFoundError("guardrail policy not found")
    return policy


def get_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                org_id: uuid.UUID | None) -> GuardrailPolicy:
    """Perm-checked policy read: personal rows require owner == caller;
    org rows require ACTIVE membership + Guardrails.Read. Every miss is a
    404 oracle (never leaks existence)."""
    policy = _get_policy(db, caller_id, policy_id, org_id)
    if org_id is not None:
        _scope(db, caller_id, org_id, "Guardrails.Read")
    return policy



def _check_name(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                name: str, ignore: uuid.UUID | None = None) -> None:
    stmt = select(GuardrailPolicy).where(
        GuardrailPolicy.is_deleted.is_(False), GuardrailPolicy.name == name)
    stmt = stmt.where(GuardrailPolicy.org_id == org_id) if org_id is not None else stmt.where(
        GuardrailPolicy.org_id.is_(None), GuardrailPolicy.user_id == caller_id)
    for row in db.scalars(stmt):
        if ignore is None or row.id != ignore:
            raise ConflictError(f"guardrail policy {name!r} already exists")


_URL_USERINFO_RE: object = None


def _redact_url(value: str) -> str:
    """Mask secrets embedded in a URL: userinfo and query string."""
    import re as _re
    from urllib.parse import urlsplit, urlunsplit

    global _URL_USERINFO_RE
    if _URL_USERINFO_RE is None:
        _URL_USERINFO_RE = _re.compile(r"(https?://)[^/\s:@]+:[^/\s@]+@")
    text = _URL_USERINFO_RE.sub(r"\1[redacted]@", value)
    try:
        parts = urlsplit(text)
        if parts.query:
            text = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, "[redacted]", parts.fragment))
    except Exception:
        logger.warning("guardrail url redaction failed", exc_info=True)
    return text


def masked_credentials(config: GuardrailEvaluatorConfig) -> dict[str, str]:
    if not config.credentials_encrypted:
        return {}
    try:
        creds = json.loads(decrypt(config.credentials_encrypted))
    except Exception:
        logger.warning("guardrail evaluator %s undecryptable", config.id, exc_info=True)
        return {}
    from tollms.core.crypto import mask

    out: dict[str, str] = {}
    for key, value in (creds.items() if isinstance(creds, dict) else []):
        # URLs never carry raw secrets: userinfo/query are redacted.
        out[key] = _redact_url(str(value)) if "url" in key.lower() else mask(str(value))
    return out


def read_policy(policy: GuardrailPolicy):
    from tollms.api.guardrails.schemas import (
        AssignmentRead,
        EvaluatorRead,
        PolicyRead,
        RuleRead,
    )

    return PolicyRead(
        id=policy.id, name=policy.name, description=policy.description,
        severity=policy.severity, enforcement=policy.enforcement, stage=policy.stage,
        delivery_mode=policy.delivery_mode, log_triggers=policy.log_triggers,
        notify_on_trigger=policy.notify_on_trigger,
        notify_repeat_minutes=getattr(policy, "notify_repeat_minutes", None) or 60,
        failure_action=policy.failure_action,
        confidence_threshold=policy.confidence_threshold,
        evaluator_timeout_ms=policy.evaluator_timeout_ms,
        is_enabled=policy.is_enabled, is_template=policy.is_template,
        is_mandatory=bool(policy.is_mandatory),
        version=policy.version, org_id=policy.org_id,
        rules=[RuleRead(id=r.id, category=r.category, severity=r.severity,
                        config=dict(r.config or {}))
               for r in (policy.rules or []) if not r.is_deleted],
        evaluators=[EvaluatorRead(
            id=e.id, evaluator_type=e.evaluator_type, provider_id=e.provider_id,
            model_ref=e.model_ref, credentials_masked=masked_credentials(e),
            operation=e.operation, timeout_ms=e.timeout_ms, threshold=e.threshold)
            for e in (policy.evaluators or []) if not e.is_deleted],
        assignments=[AssignmentRead(
            id=a.id, scope_type=a.scope_type, provider_id=a.provider_id,
            model_id=a.model_id, api_key_id=a.api_key_id,
            applies_internal=a.applies_internal, applies_external=a.applies_external)
            for a in (policy.assignments or []) if not a.is_deleted],
        created_at=policy.created_at, updated_at=policy.updated_at,
    )


def list_policies(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None):
    _scope(db, caller_id, org_id, "Guardrails.Read")
    rows = db.scalars(_visible_query(db, caller_id, org_id).order_by(
        GuardrailPolicy.created_at.desc())).all()
    return [read_policy(p) for p in rows]


def create_policy(db: Session, caller_id: uuid.UUID, data) -> GuardrailPolicy:
    _scope(db, caller_id, data.org_id, "Guardrails.Create")
    if getattr(data, "is_mandatory", False):
        if data.org_id is None:
            raise ValidationError("is_mandatory is only available on organization policies")
        _scope(db, caller_id, data.org_id, "Guardrails.Update")
    if bool(getattr(data, "is_mandatory", False)) and bool(data.is_enabled):
        items = list(data.assignments or [])
        if items and not _has_global(items):
            raise ValidationError(_MANDATORY_GLOBAL_MSG)
    validate_policy_fields(data, is_create=True)
    if _validate_assignment_refs(db, caller_id, data.org_id, data.assignments or []):
        # scope_type/key assignment requires Guardrails.Update + key assign
        # authority on top of the Create gate checked above.
        _scope(db, caller_id, data.org_id, "Guardrails.Update")
        if data.org_id is not None:
            org, mem = _member_org(db, data.org_id, caller_id)
            _require_perm(db, org, mem, caller_id, "Keys.Assign")
    _check_name(db, caller_id, data.org_id, data.name)
    policy = GuardrailPolicy(
        user_id=None if data.org_id else caller_id, org_id=data.org_id,
        name=data.name, description=data.description, severity=data.severity,
        enforcement=data.enforcement, stage=data.stage, delivery_mode=data.delivery_mode,
        log_triggers=data.log_triggers, notify_on_trigger=data.notify_on_trigger,
        notify_repeat_minutes=getattr(data, "notify_repeat_minutes", None) or 60,
        failure_action=data.failure_action, confidence_threshold=data.confidence_threshold,
        evaluator_timeout_ms=data.evaluator_timeout_ms or 5000,
        is_enabled=bool(data.is_enabled),
        is_mandatory=bool(getattr(data, "is_mandatory", False)),
    )
    db.add(policy)
    db.flush()
    _replace_rules(db, policy, data.rules or [])
    _replace_assignments(db, policy, data.assignments or [])
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(f"guardrail policy {data.name!r} already exists") from None
    db.refresh(policy)
    return policy


def update_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                  org_id: uuid.UUID | None, data):
    _scope(db, caller_id, org_id, "Guardrails.Update")
    policy = _get_policy(db, caller_id, policy_id, org_id)
    # PATCH-gap fix: validate the effective row, not just the supplied
    # fields — a create-time buffer+pre rejection must also fire when the
    # PATCH omits stage or delivery_mode.
    merged = {
        "severity": data.severity if data.severity is not None else policy.severity,
        "enforcement": data.enforcement if data.enforcement is not None else policy.enforcement,
        "stage": data.stage if data.stage is not None else policy.stage,
        "delivery_mode": (data.delivery_mode if data.delivery_mode is not None
                          else policy.delivery_mode),
        "failure_action": (data.failure_action if data.failure_action is not None
                           else policy.failure_action),
        "notify_repeat_minutes": (data.notify_repeat_minutes
                                  if data.notify_repeat_minutes is not None
                                  else getattr(policy, "notify_repeat_minutes", 60)),
    }
    validate_policy_fields(merged)
    if data.assignments is not None and _validate_assignment_refs(
            db, caller_id, org_id, data.assignments or []):
        # The Update gate above already holds; key-scoped assignments also
        # need key assign authority (personal: ownership, checked above).
        if org_id is not None:
            org, mem = _member_org(db, org_id, caller_id)
            _require_perm(db, org, mem, caller_id, "Keys.Assign")
    if data.is_enabled is False and policy.is_mandatory:
        raise ValidationError("mandatory policies cannot be disabled")
    mandatory = data.is_mandatory if data.is_mandatory is not None else policy.is_mandatory
    enabled = data.is_enabled if data.is_enabled is not None else policy.is_enabled
    # Mandatory global-coverage guard on the effective row (resolve_key_guardrail_state
    # Rule A: a mandatory policy must keep workspace-global coverage while enabled).
    if mandatory and enabled:
        if data.assignments is not None:
            effective_assignments = list(data.assignments)
        else:
            effective_assignments = [a for a in (policy.assignments or []) if not a.is_deleted]
        if effective_assignments and not _has_global(effective_assignments):
            raise ValidationError(_MANDATORY_GLOBAL_MSG)
    if data.is_mandatory is True and policy.org_id is None:
        raise ValidationError("is_mandatory is only available on organization policies")
    if data.name is not None and data.name != policy.name:
        _check_name(db, caller_id, org_id, data.name, ignore=policy.id)
    for field in ("name", "description", "severity", "enforcement", "stage",
                   "delivery_mode", "log_triggers", "notify_on_trigger",
                   "notify_repeat_minutes",
                   "failure_action", "confidence_threshold", "evaluator_timeout_ms",
                   "is_enabled", "is_mandatory"):
        value = getattr(data, field, None)
        if value is not None:
            setattr(policy, field, value)
    if data.rules is not None:
        _replace_rules(db, policy, data.rules)
    if data.assignments is not None:
        _replace_assignments(db, policy, data.assignments)
    policy.version = (policy.version or 1) + 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("guardrail policy name already exists") from None
    db.refresh(policy)
    return policy


def delete_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                  org_id: uuid.UUID | None) -> None:
    from datetime import datetime, timezone

    _scope(db, caller_id, org_id, "Guardrails.Delete")
    policy = _get_policy(db, caller_id, policy_id, org_id)
    if policy.is_mandatory:
        raise ValidationError("mandatory policies cannot be deleted")
    policy.is_deleted, policy.deleted_at, policy.deleted_by = True, datetime.now(timezone.utc), caller_id
    db.commit()


def clone_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                 org_id: uuid.UUID | None):
    from tollms.api.guardrails.schemas import RuleIn, AssignmentIn

    _scope(db, caller_id, org_id, "Guardrails.Create")
    src = _get_policy(db, caller_id, policy_id, org_id)
    base = f"{src.name} (copy)"
    name, suffix = base, 1
    while db.scalars(_visible_query(db, caller_id, org_id).where(
            GuardrailPolicy.name == name)).first() is not None:
        suffix += 1
        name = f"{base} {suffix}"
    from tollms.api.guardrails.schemas import PolicyCreate

    data = PolicyCreate(
        name=name, description=src.description, severity=src.severity,
        enforcement=src.enforcement, stage=src.stage, delivery_mode=src.delivery_mode,
        log_triggers=src.log_triggers, notify_on_trigger=src.notify_on_trigger,
        notify_repeat_minutes=getattr(src, "notify_repeat_minutes", None) or 60,
        failure_action=src.failure_action, confidence_threshold=src.confidence_threshold,
        evaluator_timeout_ms=src.evaluator_timeout_ms, is_enabled=False,
        org_id=org_id,
        rules=[RuleIn(category=r.category, severity=r.severity, config=dict(r.config or {}))
               for r in src.rules if not r.is_deleted],
        assignments=[AssignmentIn(
            scope_type=a.scope_type, provider_id=a.provider_id, model_id=a.model_id,
            api_key_id=a.api_key_id, applies_internal=a.applies_internal,
            applies_external=a.applies_external)
            for a in src.assignments if not a.is_deleted],
    )
    return create_policy(db, caller_id, data)


def set_enabled(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                org_id: uuid.UUID | None, enabled: bool):
    _scope(db, caller_id, org_id, "Guardrails.Update")
    policy = _get_policy(db, caller_id, policy_id, org_id)
    if policy.is_mandatory and not enabled:
        raise ValidationError("mandatory policies cannot be disabled")
    if enabled and policy.is_mandatory:
        live = [a for a in (policy.assignments or []) if not a.is_deleted]
        if live and not _has_global(live):
            raise ValidationError(_MANDATORY_GLOBAL_MSG)
    policy.is_enabled, policy.version = enabled, (policy.version or 1) + 1
    db.commit()
    db.refresh(policy)
    return policy


def _replace_rules(db: Session, policy: GuardrailPolicy, rules) -> None:
    for row in list(policy.rules or []):
        if not row.is_deleted:
            row.is_deleted = True
    for rule in rules:
        cat = rule.category if hasattr(rule, "category") else rule["category"]
        sev = rule.severity if hasattr(rule, "severity") else rule.get("severity", "medium")
        cfg = rule.config if hasattr(rule, "config") else rule.get("config", {})
        db.add(GuardrailRule(policy_id=policy.id, category=cat, severity=sev,
                             config=dict(cfg or {})))


def _replace_assignments(db: Session, policy: GuardrailPolicy, assignments) -> None:
    for row in list(policy.assignments or []):
        if not row.is_deleted:
            row.is_deleted = True
    for item in assignments:
        get = (lambda k, d=None: getattr(item, k, d)) if hasattr(item, "scope_type") else item.get
        db.add(GuardrailAssignment(
            policy_id=policy.id, scope_type=(get("scope_type", "global") or "global").lower(),
            provider_id=get("provider_id"), model_id=get("model_id"),
            api_key_id=get("api_key_id"),
            applies_internal=bool(get("applies_internal", True)),
            applies_external=bool(get("applies_external", True))))


def ensure_templates(db: Session) -> list[GuardrailPolicy]:
    """Idempotent seed: missing system template rows are inserted once."""
    rows: list[GuardrailPolicy] = []
    for seed in SEED_TEMPLATES:
        row = db.scalars(select(GuardrailPolicy).where(
            GuardrailPolicy.is_template.is_(True),
            GuardrailPolicy.name == seed["name"],
            GuardrailPolicy.is_deleted.is_(False))).first()
        if row is None:
            row = GuardrailPolicy(
                name=seed["name"], description=seed["description"],
                severity=seed["severity"], enforcement=seed["enforcement"],
                stage=seed["stage"], is_template=True, is_enabled=False)
            db.add(row)
            db.flush()
            for rule in seed["rules"]:
                db.add(GuardrailRule(policy_id=row.id, category=rule["category"],
                                     severity=rule.get("severity", "medium"),
                                     config=dict(rule.get("config", {}))))
            for etype in seed.get("evaluator_types", []):
                db.add(GuardrailEvaluatorConfig(policy_id=row.id, evaluator_type=etype))
        rows.append(row)
    if db.new or db.dirty:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return rows


def list_templates(db: Session):
    from tollms.api.guardrails.schemas import RuleIn, TemplateRead

    rows = ensure_templates(db)
    out: list[TemplateRead] = []
    seen: set[str] = set()
    for row in rows:
        key = next((s["key"] for s in SEED_TEMPLATES if s["name"] == row.name),
                   _slug(row.name))
        if key in seen:
            continue
        seen.add(key)
        out.append(TemplateRead(
            key=key, name=row.name, description=row.description or "",
            severity=row.severity, enforcement=row.enforcement, stage=row.stage,
            rules=[RuleIn(category=r.category, severity=r.severity,
                          config=dict(r.config or {}))
                   for r in (row.rules or []) if not r.is_deleted],
            evaluator_types=list({e.evaluator_type for e in (row.evaluators or [])
                                  if not e.is_deleted})))
    return out


def from_template(db: Session, caller_id: uuid.UUID, key: str, org_id: uuid.UUID | None):
    from tollms.api.guardrails.schemas import PolicyCreate

    _scope(db, caller_id, org_id, "Guardrails.Create")
    seed = next((s for s in SEED_TEMPLATES if s["key"] == key), None)
    if seed is None:
        raise NotFoundError("guardrail template not found")
    name = seed["name"]
    if db.scalars(_visible_query(db, caller_id, org_id).where(
            GuardrailPolicy.name == name)).first() is not None:
        raise ConflictError(f"guardrail policy {name!r} already exists")
    data = PolicyCreate(
        name=name, description=seed["description"], severity=seed["severity"],
        enforcement=seed["enforcement"], stage=seed["stage"], org_id=org_id,
        rules=seed["rules"], assignments=[])
    policy = create_policy(db, caller_id, data)
    for etype in seed.get("evaluator_types", []):
        db.add(GuardrailEvaluatorConfig(policy_id=policy.id, evaluator_type=etype))
    db.commit()
    db.refresh(policy)
    return policy


def _overlay_targets(credentials: dict | None, configs) -> list:
    """Configs a test credential overlay may touch: only matching
    evaluator_type, never cross-overlay. An explicit `evaluator_type` key in
    the payload selects the target (and is stripped before encrypting);
    otherwise the credential shape decides: base_url -> jev, lone api_key ->
    openai_moderation. Anything else overlays nowhere (laya/deterministic/llm
    need no credentials)."""
    live = [c for c in (configs or []) if not c.is_deleted and c.credentials_encrypted]
    if not credentials:
        return []
    wanted = credentials.get("evaluator_type")
    if isinstance(wanted, str) and wanted.strip():
        want = wanted.strip().lower()
        return [c for c in live if (c.evaluator_type or "").lower() == want]
    targets: set[str] = set()
    if credentials.get("base_url"):
        targets.add("jev")
    if credentials.get("api_key") and not credentials.get("base_url"):
        targets.add("openai_moderation")
    if not targets:
        return []
    return [c for c in live if (c.evaluator_type or "").lower() in targets]


def test_policy(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                org_id: uuid.UUID | None, content: str, stage: str,
                credentials: dict | None, run_llm: bool = False):
    """Dry-run: evaluate sample content without persisting anything.

    Supplied credentials live in memory only (in-memory encrypted overlay,
    rolled back) — never persisted, never logged — and overlay ONLY onto
    configs of the matching evaluator_type (never cross-overlay). `both`
    coerces to `pre` (never 422). Unless `run_llm` is set, the billable LLM
    escalation is skipped and the response reports `llm_skipped: true`.
    """
    from tollms.services.cache.manager import call_sync
    from tollms.services.guardrails import evaluation as evaluation_engine

    _scope(db, caller_id, org_id, "Guardrails.Test")
    policy = _get_policy(db, caller_id, policy_id, org_id)
    if stage == "both":
        stage = "pre"
    if stage not in ("pre", "post"):
        raise ValidationError(f"invalid stage: {stage!r}")
    overlay: list[tuple] = []
    try:
        if credentials:
            payload = {k: v for k, v in credentials.items() if k != "evaluator_type"}
            for config in _overlay_targets(credentials, policy.evaluators):
                overlay.append((config, config.credentials_encrypted))
                config.credentials_encrypted = encrypt(json.dumps(payload))
        llm_present = any((c.evaluator_type or "").lower() == "llm"
                          for c in (policy.evaluators or []) if not c.is_deleted)
        ctx: dict = {"skip_llm": not run_llm}
        result = call_sync(
            evaluation_engine.evaluate_policy(
                db, policy, content, stage=stage, ctx=ctx, llm_user_id=caller_id),
            timeout=20.0, default=None)
        if result is None:
            return {"verdict": "allow", "action": "fallback_continued",
                    "confidence": 0.0, "categories": [],
                    "reason": "evaluation timed out", "evaluator_type": None,
                    "failure_kind": "timeout",
                    "llm_skipped": llm_present and not run_llm}
        action = evaluation_engine.effective_action(policy, result)
        if result.get("failure_kind") and action == "allowed":
            action = "fallback_continued"
        return {"verdict": result["verdict"], "action": action,
                "confidence": result.get("confidence", 0.0),
                "categories": result.get("categories", []),
                "reason": result.get("reason"),
                "evaluator_type": result.get("evaluator_type"),
                "failure_kind": result.get("failure_kind"),
                "llm_skipped": llm_present and not run_llm}
    finally:
        for config, previous in overlay:
            config.credentials_encrypted = previous
        db.rollback()


def _check_validation_quota(caller_id, bucket):
    """Max 10 validations/min per user. Fail-closed: 429 on limit hit,
    503 when Valkey cannot be reached (reuse of the auth fixed-window limiter)."""
    from tollms.core import rate_limit as rate_limiter
    from tollms.services.cache.manager import call_sync_strict

    call_sync_strict(rate_limiter.check_fixed_window(
        key="tollma:guardrail:" + bucket + ":" + str(caller_id), limit=10,
        window_seconds=60, scope="guardrail:" + bucket))


def laya_health(db, caller_id, org_id):
    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    _check_validation_quota(caller_id, "laya-health")
    from tollms.services.cache.manager import call_sync
    from tollms.services.guardrails import laya as laya_engine

    try:
        result = call_sync(laya_engine.health(), timeout=8.0, default=None)
        return dict(result) if isinstance(result, dict) else {"reachable": False}
    except Exception:
        logger.warning("laya health proxy failed", exc_info=True)
        return {"reachable": False}


def _jev_denied(etype, credentials, base_url):
    """SSRF gate: jev is the only evaluator with a user-supplied host."""
    if etype != "jev":
        return None
    from tollms.services.guardrails import jev as jev_engine

    merged = dict(credentials or {})
    if base_url:
        merged["base_url"] = base_url
    return jev_engine.base_url_error(merged.get("base_url"))


async def _live_validate(etype: str, credentials: dict | None,
                         base_url: str | None) -> tuple[bool, str, float]:
    if etype == "openai_moderation":
        from tollms.services.guardrails import openai_moderation as mod_engine

        return await mod_engine.validate(credentials)
    if etype == "jev":
        from tollms.services.guardrails import jev as jev_engine

        merged = dict(credentials or {})
        if base_url:
            merged["base_url"] = base_url
        return await jev_engine.validate(merged)
    if etype == "laya":
        from tollms.services.guardrails import laya as laya_engine

        payload = await laya_engine.health(force=True)
        ok = bool(payload.get("reachable"))
        return ok, ("laya reachable" if ok else "laya unreachable"), 0.0
    if etype == "deterministic":
        return True, "deterministic needs no credentials", 0.0
    if etype == "llm":
        return True, "llm uses the provider credentials at evaluation time", 0.0
    raise ValidationError(f"invalid evaluator_type: {etype!r}")


def _live_check(etype, credentials, base_url):
    """Stateless field + live check. Never persists, never logs secrets."""
    from tollms.services.cache.manager import call_sync

    if etype not in EVALUATOR_TYPES:
        raise ValidationError("invalid evaluator_type: " + repr(etype))
    denied = _jev_denied(etype, credentials, base_url)
    if denied:
        raise ValidationError(denied)
    result = call_sync(_live_validate(etype, credentials, base_url),
                       timeout=15.0, default=None)
    if result is None:
        return {"valid": False, "message": "validation timed out", "latency_ms": 0.0}
    valid, message, latency_ms = result
    return {"valid": valid, "message": message, "latency_ms": latency_ms}


def validate_credentials(db, caller_id, org_id, etype, credentials, base_url):
    """Gated validation probe: Guardrails.ManageCredentials (personal: owner,
    org: perm), SSRF allowlist on base_url, then 10/min per-user quota."""
    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    denied = _jev_denied(etype, credentials, base_url)
    if denied:
        raise ValidationError(denied)
    _check_validation_quota(caller_id, "validate")
    return _live_check(etype, credentials, base_url)


def _validated_encrypted(etype: str, credentials: dict | None,
                         base_url: str | None) -> str | None:
    """Validate-then-persist gate: encrypt only after success. Raises 422."""
    if etype in ("deterministic", "laya", "llm"):
        if not credentials:
            return None
        return encrypt(json.dumps(credentials))
    if not credentials:
        raise ValidationError(f"{etype} requires credentials")
    checked = _live_check(etype, credentials, base_url)
    if not checked["valid"]:
        raise ValidationError(f"credential validation failed: {checked['message']}")
    merged = dict(credentials)
    if base_url and "base_url" not in merged:
        merged["base_url"] = base_url
    return encrypt(json.dumps(merged))


def _require_llm_provider(db: Session, caller_id: uuid.UUID,
                         policy: GuardrailPolicy, provider_id: uuid.UUID) -> None:
    """Cross-tenant spend guard: the LLM judge may only burn the caller's
    own provider. Personal policies need a caller-owned personal provider
    (personal_only semantics); org policies need a provider in the same org.
    Misses are 404 oracles, never 403."""
    from tollms.api.providers import service as provider_service

    if policy.org_id is None:
        provider_service.get_provider(db, provider_id, caller_id, personal_only=True)
    else:
        provider = provider_service.get_provider(db, provider_id, caller_id)
        if provider.org_id != policy.org_id:
            raise NotFoundError("guardrail policy not found")


def create_evaluator(db: Session, caller_id: uuid.UUID, policy_id: uuid.UUID,
                     org_id: uuid.UUID | None, data) -> GuardrailEvaluatorConfig:
    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    policy = _get_policy(db, caller_id, policy_id, org_id)
    etype = (data.evaluator_type or "").lower()
    if etype not in EVALUATOR_TYPES:
        raise ValidationError(f"invalid evaluator_type: {data.evaluator_type!r}")
    if etype == "llm" and not data.provider_id:
        raise ValidationError("llm evaluator requires provider_id")
    if etype == "llm" and data.provider_id is not None:
        _require_llm_provider(db, caller_id, policy, data.provider_id)
    encrypted = _validated_encrypted(etype, data.credentials,
                                     (data.credentials or {}).get("base_url"))
    config = GuardrailEvaluatorConfig(
        policy_id=policy.id, evaluator_type=etype, provider_id=data.provider_id,
        model_ref=data.model_ref, credentials_encrypted=encrypted,
        operation=data.operation, timeout_ms=data.timeout_ms, threshold=data.threshold)
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def _get_evaluator(db: Session, caller_id: uuid.UUID, evaluator_id: uuid.UUID,
                   org_id: uuid.UUID | None) -> GuardrailEvaluatorConfig:
    config = db.get(GuardrailEvaluatorConfig, evaluator_id)
    if config is None or config.is_deleted:
        raise NotFoundError("guardrail evaluator not found")
    _get_policy(db, caller_id, config.policy_id, org_id)
    return config


def patch_evaluator(db: Session, caller_id: uuid.UUID, evaluator_id: uuid.UUID,
                    org_id: uuid.UUID | None, data) -> GuardrailEvaluatorConfig:
    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    config = _get_evaluator(db, caller_id, evaluator_id, org_id)
    if data.provider_id is not None:
        policy = db.get(GuardrailPolicy, config.policy_id)
        if policy is not None and (config.evaluator_type or "").lower() == "llm":
            _require_llm_provider(db, caller_id, policy, data.provider_id)
        config.provider_id = data.provider_id
    for field in ("model_ref", "operation", "timeout_ms", "threshold"):
        value = getattr(data, field, None)
        if value is not None:
            setattr(config, field, value)
    if data.credentials is not None:
        config.credentials_encrypted = _validated_encrypted(
            config.evaluator_type, data.credentials,
            data.credentials.get("base_url"))
    db.commit()
    db.refresh(config)
    return config


def revalidate_evaluator(db: Session, caller_id: uuid.UUID, evaluator_id: uuid.UUID,
                         org_id: uuid.UUID | None) -> dict:
    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    config = _get_evaluator(db, caller_id, evaluator_id, org_id)
    creds: dict | None = None
    if config.credentials_encrypted:
        try:
            creds = json.loads(decrypt(config.credentials_encrypted))
        except Exception:
            return {"valid": False, "message": "stored credentials undecryptable",
                    "latency_ms": 0.0}
    return _live_check(config.evaluator_type, creds,
                                (creds or {}).get("base_url"))


def delete_evaluator(db: Session, caller_id: uuid.UUID, evaluator_id: uuid.UUID,
                     org_id: uuid.UUID | None) -> None:
    from datetime import datetime, timezone

    _scope(db, caller_id, org_id, "Guardrails.ManageCredentials")
    config = _get_evaluator(db, caller_id, evaluator_id, org_id)
    config.is_deleted, config.deleted_at = True, datetime.now(timezone.utc)
    config.deleted_by = caller_id
    db.commit()


def effective(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
              provider_id: uuid.UUID | None, model_id: uuid.UUID | None,
              key_id: uuid.UUID | None, source: str):
    from tollms.services.guardrails import resolution as resolution_engine

    _scope(db, caller_id, org_id, "Guardrails.Read")
    if source not in ("internal", "external"):
        raise ValidationError(f"invalid source: {source!r}")
    resolved = resolution_engine.resolve_applicable(
        db, user_id=caller_id, org_id=org_id, provider_id=provider_id,
        model_id=model_id, api_key_id=key_id, source=source)
    global_enforced = resolution_engine.workspace_global_enforced(
        db, user_id=caller_id, org_id=org_id)
    logger.debug("guardrail effective global_enforced=%s applied=%d",
                 global_enforced, len(resolved.applied))
    if key_id is not None:
        key_assigned = any(
            (a.scope_type or "global").lower() == "key" and a.api_key_id == key_id
            for policy in resolved.applied for a in (policy.assignments or [])
            if not a.is_deleted)
        effective_flag, locked = resolution_engine.resolve_key_guardrail_state(
            global_enabled=global_enforced, key_assigned=key_assigned)
        logger.debug("guardrail key state effective=%s locked=%s",
                     effective_flag, locked)
    return ([read_policy(p) for p in resolved.applied],
            resolved.deciding.id if resolved.deciding else None)


def _trigger_scope(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                   code: str = "Guardrails.ViewEvents"):
    _scope(db, caller_id, org_id, code)
    stmt = select(GuardrailTrigger)
    if org_id is None:
        return stmt.where(GuardrailTrigger.user_id == caller_id,
                          GuardrailTrigger.org_id.is_(None))
    return stmt.where(GuardrailTrigger.org_id == org_id)


def _decode_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_s, row_id = raw.split("|", 1)
        return datetime.fromisoformat(created_s), uuid.UUID(row_id)
    except (ValueError, TypeError):
        raise ValidationError("invalid cursor") from None


def list_triggers(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None, *,
                  workspace_type: str | None = None, policy_id: uuid.UUID | None = None,
                  severity: str | None = None, action: str | None = None,
                  source: str | None = None, provider_id: uuid.UUID | None = None,
                  key_id: uuid.UUID | None = None, limit: int = 50,
                  cursor: str | None = None):
    stmt = _trigger_scope(db, caller_id, org_id)
    if workspace_type is not None:
        if workspace_type not in ("personal", "organization"):
            raise ValidationError(f"invalid workspace_type: {workspace_type!r}")
        stmt = stmt.where(GuardrailTrigger.workspace_type == workspace_type)
    if policy_id is not None:
        stmt = stmt.where(GuardrailTrigger.policy_id == policy_id)
    if severity is not None:
        if severity not in SEVERITIES:
            raise ValidationError(f"invalid severity: {severity!r}")
        stmt = stmt.where(GuardrailTrigger.severity == severity)
    if action is not None:
        stmt = stmt.where(GuardrailTrigger.action == action)
    if source is not None:
        if source not in ("internal", "external"):
            raise ValidationError(f"invalid source: {source!r}")
        stmt = stmt.where(GuardrailTrigger.source == source)
    if provider_id is not None:
        stmt = stmt.where(GuardrailTrigger.provider_id == provider_id)
    if key_id is not None:
        stmt = stmt.where(GuardrailTrigger.api_key_id == key_id)
    decoded = _decode_cursor(cursor)
    if decoded is not None:
        created_at, row_id = decoded
        stmt = stmt.where((GuardrailTrigger.created_at < created_at) |
                          ((GuardrailTrigger.created_at == created_at) &
                           (GuardrailTrigger.id < row_id)))
    limit = min(max(limit, 1), 200)
    rows = list(db.scalars(stmt.order_by(
        GuardrailTrigger.created_at.desc(), GuardrailTrigger.id.desc()).limit(limit + 1)))
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        raw = f"{last.created_at.isoformat()}|{last.id}"
        next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        rows = rows[:limit]
    return rows, next_cursor


def get_trigger(db: Session, caller_id: uuid.UUID, trigger_id: uuid.UUID,
                org_id: uuid.UUID | None) -> GuardrailTrigger:
    row = db.get(GuardrailTrigger, trigger_id)
    if row is None:
        raise NotFoundError("guardrail trigger not found")
    if org_id is None:
        if row.user_id != caller_id or row.org_id is not None:
            raise NotFoundError("guardrail trigger not found")
    else:
        _scope(db, caller_id, org_id, "Guardrails.ViewEvents")
        if row.org_id != org_id:
            raise NotFoundError("guardrail trigger not found")
    return row
