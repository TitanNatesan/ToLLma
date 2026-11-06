# Threat Model (Agent C, Wave 2 — 2026-11-06)

Scope: backend session/JWT auth, credential storage, virtual-key auth,
gateway egress (CUSTOM `base_url`), rate/budget enforcement, response
hardening, frontend credential handling, org tenant isolation.

## T1 — SSRF via CUSTOM `base_url` (HIGH, P0)

Any session user can register a CUSTOM provider whose `base_url` points at
link-local (169.254.169.254), loopback, or intranet hosts. `validate`,
`discover`, chat, and `transcribe_audio` dial it with no scheme/host check
(`adapters/openai.py::_base_url`, `attachments.py::transcribe_audio`).
No redirect re-validation, no DNS-rebinding guard.
Fix: orchestrator applies `proposed-diffs/a-egress.md`.

## T2 — Single-version credential KEK (HIGH, P0)

Fernet key = raw `sha256(SECRET_KEY)` (`core/crypto.py`). Rotating
SECRET_KEY bricks every stored credential; compromise = total loss; no
version column, no rotation API. Fix: `proposed-diffs/b-kek-versioning.md`.

## T3 — Gateway fail-open on Valkey outage (HIGH, P0)

`services/gateway/limits.py` documents fail-open rate windows + unreadable
spend counters. Valkey outage = unlimited public traffic; cold counters
understate spend (in-app postgres fallback is pre-check only). Fix: deny on
unreadable budget counters + `gateway.degraded` audit event (P1 part in
`proposed-diffs/c-main-headers.md` covers the pre-auth limiter).

## T4 — No centralized security audit log (HIGH, P0) — DONE Wave 2

Was: org-scoped `AuditLog` + JSON-line `emit()` only. Now: `security_audit`
table (F6 envelope) + `api/security` read/write path. See AUDIT_LOG.md.

## T5 — No pre-auth flood guard on `/v1/*` (MEDIUM-HIGH, P0)

Per-key limits engage only after `authenticate`; unknown-key floods hit PG.
Fix: pre-auth IP fixed-window limiter, fail-closed (proposal in
`proposed-diffs/c-main-headers.md`).

## T6 — Missing response hardening (MEDIUM, P1)

`main.py` sets CORS only: no CSP/HSTS/X-Frame-Options/Referrer-Policy/
Permissions-Policy; local-origin carve-outs unconditional by env check.
Fix: `proposed-diffs/c-main-headers.md`.

## T7 — JWT single HS256 key, silent fallback (MEDIUM, P1)

`jwt_secret or secret_key` (`core/config.py:89`): one compromise kills
sessions AND credential KEK; no `kid`, 30d refresh. Fix:
`proposed-diffs/d-config-jwt.md` (required `JWT_SECRET`, rotation map).

## T8 — No MFA (MEDIUM, P1)

Password + Google OAuth only; no step-up for credential writes/key rotation.
Deferred: needs `models` + UX; tracked in REMEDIATION.md.

## T9 — Frontend off-origin `apiBase()` (LOW-MEDIUM, P1)

`frontend/src/services/api.ts` derives `hostname:8000` off-origin (breaks
Secure/Lax assumptions, widens in-memory Bearer exfil window on XSS).
httpOnly cookies themselves not JS-readable — good. Deferred to Agent E /
orchestrator (frontend files out of Agent C ownership).

## T10 — Org privilege surface strings (MEDIUM, P1)

Union `effective_permissions`, per-endpoint `_require_perm` codes (typo =
open gate). Mitigations exist (404-oracle, ACTIVE-membership backstops in
`authenticate`/`_require_chat_key`); need negative tests per route —
proposed as Agent H audit item in REMEDIATION.md.

## Ruled out (verified present)

Per-key rpm/rph/rpd + tpm/tpd + budget/daily/monthly caps exist on both
planes (`limits.py` + `key_policy.enforce_chat_policy`); validation-message
secret scrub exists (`sanitize_validation_message`); IP deny-wins + fail-closed
exists; tombstone race protection exists; 404-oracle convention holds.
