"""Evaluation orchestration: deterministic first, primary decision, llm escalation.

Order: deterministic scan always runs (cheap, sync). Then each configured
non-llm evaluator (laya / openai_moderation / jev) runs with the policy
timeout. Then optional llm escalation when a policy requires it
(evaluator operation == "escalate") or the combined confidence falls below
the policy threshold. Worst verdict wins; deterministic positives make the
call positive and the policy enforcement decides the floor.
"""

import logging
import time
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from tollms.models.guardrail import GuardrailPolicy
from tollms.services.guardrails import deterministic as det

logger = logging.getLogger(__name__)

_LEVEL_RANK = {"allow": 0, "warn": 1, "block": 2}


async def evaluate_policy(
    db: Session,
    policy: GuardrailPolicy,
    text: str,
    *,
    stage: str,
    ctx: dict[str, Any] | None = None,
    llm_user_id=None,
    action_text: str | None = None,
) -> dict[str, Any]:
    """One policy over one text blob. Never raises — failures degrade per
    failure_action (allow|block) with failure_kind recorded."""
    ctx = ctx or {}
    if ctx.get("skip_guardrails"):
        return _verdict("allow", 1.0, [], "recursion guard", "deterministic", None, 0.0)
    started = time.monotonic()
    selected = _selected_categories(policy)
    if action_text is None:
        findings = [f for f in det.scan_text(text or "")
                    if selected is None or f.get("category") in selected]
    else:
        # Tool Action governs attempted ACTIONS, never static capability
        # declarations: the tool_action finding comes from the action corpus
        # only (user content + invocation names/inputs). Every other category
        # keeps the full-text findings (definitions still count for
        # injection/secret/PII). action_text=None preserves legacy behavior.
        findings = [f for f in det.scan_text(text or "")
                    if f.get("category") != "tool_action"
                    and (selected is None or f.get("category") in selected)]
        if selected is None or "tool_action" in selected:
            findings += det.scan_tool_action(action_text or "")
    findings += _structure_findings(policy, text or "")
    timeout_ms = policy.evaluator_timeout_ms or 5000
    worst = "allow"
    confidence = 1.0
    categories: list[str] = []
    reasons: list[str] = []
    evaluator_type = "deterministic"
    failure_kind: str | None = None
    positive = bool(findings)
    for found in findings:
        categories.append(found["category"])
        reasons.append(found["reason"])
    configs = [c for c in (policy.evaluators or []) if not c.is_deleted]
    for config in configs:
        etype = (config.evaluator_type or "deterministic").lower()
        if etype == "deterministic":
            continue
        if etype == "llm":
            continue  # escalation round only
        try:
            result = await _run_evaluator(etype, config, text or "", timeout_ms)
            # Category isolation: out-of-scope engine signals never fire.
            # Rule-less policies (selected None) keep match-all behavior.
            matched = _in_scope_categories(result.get("matched_categories"), selected)
            in_scope = selected is None or bool(matched)
            if result["verdict"] in ("warn", "block") and in_scope:
                positive = True
            if in_scope and _LEVEL_RANK[result["verdict"]] > _LEVEL_RANK[worst]:
                worst = result["verdict"]
                evaluator_type = etype
            confidence = min(confidence, float(result.get("confidence", 0.5)))
            categories.extend(matched)
            if result.get("reason"):
                reasons.append(det.redact_text(str(result["reason"]))[:200])
        except Exception as exc:
            failure_kind = type(exc).__name__
            logger.warning("guardrail evaluator %s failed", etype, exc_info=True)
            if (policy.failure_action or "allow") == "block":
                positive = True
                worst = "block"
                evaluator_type = etype
    llm_config = next((c for c in configs if (c.evaluator_type or "").lower() == "llm"), None)
    if (llm_config is not None and not ctx.get("skip_llm")
            and _needs_escalation(policy, llm_config, worst, confidence, positive)):
        try:
            from tollms.services.guardrails import llm as llm_engine

            result = await llm_engine.evaluate(
                text or "",
                provider_id=llm_config.provider_id,
                model_ref=llm_config.model_ref,
                ctx=ctx,
                timeout_ms=llm_config.timeout_ms or timeout_ms,
                user_id=llm_user_id,
                scope_org_id=policy.org_id,
            )
            matched = _in_scope_categories(result.get("matched_categories"), selected)
            in_scope = selected is None or bool(matched)
            if result["verdict"] in ("warn", "block") and in_scope:
                positive = True
            if in_scope and _LEVEL_RANK[result["verdict"]] > _LEVEL_RANK[worst]:
                worst = result["verdict"]
                evaluator_type = "llm"
            confidence = min(confidence, float(result.get("confidence", 0.5)))
            categories.extend(matched)
            if result.get("reason"):
                reasons.append(det.redact_text(str(result["reason"]))[:200])
        except Exception as exc:
            failure_kind = type(exc).__name__
            logger.warning("guardrail llm escalation failed", exc_info=True)
            if (policy.failure_action or "allow") == "block":
                positive = True
                worst = "block"
                evaluator_type = "llm"
    latency_ms = (time.monotonic() - started) * 1000
    return _verdict(worst, confidence, categories,
                    "; ".join(dict.fromkeys(reasons))[:500] if reasons else "",
                    evaluator_type, failure_kind, latency_ms, positive=positive)


def _needs_escalation(policy: GuardrailPolicy, llm_config, worst: str,
                      confidence: float, positive: bool) -> bool:
    if (llm_config.operation or "").lower() == "escalate" and positive:
        return True
    threshold = llm_config.threshold if llm_config.threshold is not None else policy.confidence_threshold
    if threshold is not None and positive and confidence < float(threshold):
        return True
    return False


async def _run_evaluator(etype: str, config, text: str, timeout_ms: int) -> dict[str, Any]:
    if etype == "laya":
        from tollms.services.guardrails import laya as laya_engine

        cats = _wanted_categories(config)
        result = await laya_engine.evaluate(text, cats, timeout_ms=timeout_ms)
    elif etype == "openai_moderation":
        from tollms.services.guardrails import openai_moderation as mod_engine
        from tollms.core.crypto import decrypt

        creds = _decrypt_config(config)
        result = await mod_engine.evaluate(text, creds, timeout_ms=timeout_ms)
    elif etype == "jev":
        from tollms.services.guardrails import jev as jev_engine

        creds = _decrypt_config(config)
        result = await jev_engine.evaluate(text, creds, _wanted_categories(config),
                                           timeout_ms=timeout_ms)
    else:
        raise ValueError(f"unknown evaluator type: {etype}")
    # Defense in depth: the engines coerce unknown verdicts to allow at the
    # source, but a misbehaving/future evaluator must never crash the shared
    # path with a KeyError (which failure_action=block would turn into a
    # block on garbage). Coerce here so every evaluator behaves alike.
    if result.get("verdict") not in ("allow", "warn", "block"):
        logger.warning("guardrail evaluator %s returned unknown verdict; coerced to allow",
                       etype)
        result = dict(result)
        result["verdict"] = "allow"
    return result


def _selected_categories(policy: GuardrailPolicy) -> set[str] | None:
    """Live rule categories as an allow-list for deterministic findings.

    None when the policy configures no live rules (legacy rule-less
    policies keep unfiltered match-all behavior). Otherwise only findings
    in the set contribute to positive/blocked — unselected categories
    (e.g. tool_action on a secret-leakage-only policy) never fire.
    _structure_findings needs no filtering here: it only emits for
    invalid_structure rules the policy selected.
    """
    try:
        cats = {str(r.category) for r in (policy.rules or [])
                if not getattr(r, "is_deleted", False) and getattr(r, "category", None)}
    except Exception:
        return None
    return cats or None


def _in_scope_categories(matched: Any, selected: set[str] | None) -> list[str]:
    """Intersect engine result categories with the policy allow-list.

    selected None (rule-less legacy policy) keeps match-all behavior.
    """
    if selected is None:
        return list(matched or [])
    return [c for c in (matched or []) if c in selected]


def _wanted_categories(config) -> list[str]:
    # Categories come from the policy rules; config.operation may pin a stage,
    # never a category allow-list, so derive from the parent policy instead.
    try:
        return list({r.category for r in (config.policy.rules or []) if not r.is_deleted})
    except Exception:
        return []


def _decrypt_config(config) -> dict[str, Any]:
    import json

    from tollms.core.crypto import decrypt

    if not config.credentials_encrypted:
        raise ValueError("evaluator has no stored credentials")
    try:
        return json.loads(decrypt(config.credentials_encrypted))
    except Exception as exc:
        raise ValueError("cannot decrypt evaluator credentials") from exc


def _structure_findings(policy: GuardrailPolicy, text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rule in (policy.rules or []):
        try:
            if rule.is_deleted or (rule.category or "") != "invalid_structure":
                continue
            schema = (rule.config or {}).get("schema")
            if not schema:
                continue
            payload, ok = det.parse_json_payload(text)
            if not ok:
                out.append({"category": "invalid_structure", "severity": rule.severity or "medium",
                            "confidence": 0.9, "reason": "output is not valid JSON"})
            else:
                out.extend(det.validate_structure(payload, schema))
        except Exception:
            logger.warning("structure rule failed", exc_info=True)
    return out


def _verdict(level: str, confidence: float, categories: list[str], reason: str,
             evaluator_type: str | None, failure_kind: str | None,
             latency_ms: float, positive: bool = False) -> dict[str, Any]:
    return {
        "verdict": level,
        "confidence": confidence,
        "categories": list(dict.fromkeys(categories)),
        "reason": reason,
        "evaluator_type": evaluator_type,
        "failure_kind": failure_kind,
        "latency_ms": latency_ms,
        "positive": positive,
    }


def policy_allows_pre(policy: GuardrailPolicy) -> bool:
    return (policy.stage or "both") in ("pre", "both")


def policy_allows_post(policy: GuardrailPolicy) -> bool:
    return (policy.stage or "both") in ("post", "both")


def effective_action(policy: GuardrailPolicy, result: dict[str, Any]) -> str:
    """Policy enforcement floor + worst evaluator verdict. Evaluator blocks
    always win (fail-safe); a configured block always wins on any signal.

    monitor is log-only: clean evaluations resolve to allowed, while an
    evaluator failure resolves to fallback_continued (the trigger row is
    still written when log_triggers, and notify still fires when configured)
    — a monitor policy can observe but never block or warn.
    """
    enforcement = (policy.enforcement or "warn").lower()
    if enforcement == "monitor":
        return "fallback_continued" if result.get("failure_kind") else "allowed"
    floor = {"monitor": "allow", "warn": "warn", "block": "block"}.get(enforcement, "warn")
    if not result.get("positive") and result.get("verdict") == "allow":
        # A failed evaluator that fell back to allow is not a clean allow —
        # the trigger row carries the failure_kind for audit.
        if result.get("failure_kind"):
            return "fallback_continued"
        return "allowed"
    verdict = result.get("verdict", "allow")
    rank = {"allow": 0, "warn": 1, "block": 2}
    floor_level = {"allow": "allowed", "warn": "warned", "block": "blocked"}[floor]
    verdict_level = {"allow": "allowed", "warn": "warned", "block": "blocked"}[verdict]
    return floor_level if rank[floor] >= rank[verdict] else verdict_level
