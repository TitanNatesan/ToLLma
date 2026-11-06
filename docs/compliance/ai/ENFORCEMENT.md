# Governance Enforcement Integration Points (Module 4)

Advisory in Wave 2: the registry and abuse flow observe; they never block.
Hook points below are marked WIRED (implemented) or DEFERRED (Wave 3).

## WIRED

1. **Abuse-report intake scan** — `api/governance/service.submit_report`
   runs the existing guardrails deterministic engine
   (`services/guardrails/deterministic.scan_text`, pure functions only) over
   the reporter-supplied `details`. Fail-open: engine errors yield
   `scan_flags=["scan_unavailable"]`, never a 422. Stored flags are category
   labels only — never excerpts, never prompt/output bodies.
2. **Spend truth reuse** — no new budget code. Key/org caps stay authoritative
   in `services/gateway/limits.py` + `key_policy.enforce_chat_policy`;
   abuse reason `billing_or_quota_abuse` references those ledgers by ID only.
3. **Evidence by reference** — abuse reports link `GuardrailTrigger` rows,
   requests, keys, providers by ID (`subject_type` + `subject_id`). No body
   copies, no new trigger writes.

## DEFERRED (Wave 3, orchestrator approval required)

4. **Org model/provider denylist gate** — new `governance.denylist_check`
   inserted in `api/public_gateway/service._prepare` (before `_guardrail_pre`,
   after capability gates) and in `api/gateway/service._enforce_chat_key`
   (after guardrail pre-check, before `key_policy.enforce_chat_policy`).
   Raises `ForbiddenError("model_not_allowed ...")` / 404-oracle per tenant
   rules. Needs a denylist store (new table or key-policy extension) — not
   specified until a concrete "block provider P for org O" requirement lands.
5. **Mandatory-coverage presence check** — `org_has_mandatory_coverage(db,
   org_id) -> bool` helper for the admin UI badge ("this org lacks a
   content-safety mandatory policy"). Read-only; never inline enforcement.
6. **Governance deny telemetry** — `gateway.governance_denied` counter emitted
   beside `gateway.guardrail` once hook 4 exists. Observability only.

## Explicitly unchanged

- `services/guardrails/*` (resolution, evaluation, enforcement, notify) —
  no modifications, per Wave 1 constraint.
- `services/gateway/key_policy.py`, `services/generation.py` post hooks —
  audit-first semantics preserved; abuse reports never write into triggers.
