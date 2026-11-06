# Agent H — Independent Trust Security Audit (2026-11-06)

Scope: tenant isolation, credentials, deletion, legal, authZ, SSRF, rate limits,
headers, logging, zero-retention, sessions, consent, exports, JWT, OpenAPI.
Method: black-box HTTP + service-level probes; no source edits, no dev-data harm
(isolated DB `tollms_test_audit_h`, live-dev reads + creates only).

Suites:
- `backend/tests/test_audit_isolation.py` — 11 passed
- `backend/tests/test_audit_trustabuse.py` — 36 passed, 2 failed (H1, M1 below)
- `frontend/e2e/trust-security/` — 9 passed (authz, public intake, headers/SSRF)

Run: `TOLLMS_TEST_DB=tollms_test_audit_h docker compose run --rm backend pytest tests/test_audit_isolation.py tests/test_audit_trustabuse.py -q -p no:cacheprovider`
(serially; do NOT run alongside other pytest runners)
E2E: `npx playwright test e2e/trust-security` (frontend/, live dev :8000/:3000)

## Critical

None. No tenant-isolation bypass, plaintext-secret leak, JWT fallback, or
authZ bypass found.

## High

### H1 — Purge omits ledger tables: prompt logs, guardrail excerpts, request logs survive erasure
- Failing: `test_purge_leaves_no_orphan_ledger_rows` —
  `orphan rows after purge: {'prompt_logs': 1, 'guardrail_triggers': 1, 'request_logs': 1, 'api_request_logs': 1, 'export_events': 1}`
- Cause: `_purge_user_data` deletes conversations/attachments/models/providers/
  api_keys and anonymizes aggregates, but never touches the per-user ledger
  tables — `backend/src/tollms/services/jobs/scheduler.py:150-213`.
- Those tables' `user_id` FKs are `ondelete="SET NULL"` (`models/prompt_logging.py:167-169`,
  `models/guardrail.py:238-240`, `models/request_log.py:27-28`,
  `models/api_key.py:241-242`, `models/request_log.py:92-94`), so the final
  `db.delete(user)` de-links rather than removes them: prompt bodies, guardrail
  input/output excerpts, and request metadata persist after "purge".
- Covered and verified deleted: user rows, messages (conversation CASCADE),
  attachments (+disk bytes), stray attachments, search index (conversation
  CASCADE), models, providers, api keys (+tombstones), sessions (revoked).
- Fix steer: extend `_purge_user_data` with user-scoped hard deletes for the
  five tables above (dependency order: ledgers before user row).

## Medium

### M1 — `GET /providers/{id}/security` always reports `encrypted=false` (lies about posture)
- Failing: `test_provider_secrets_masked_fernet_and_rotatable` —
  `assert sec["encrypted"] is True` got `False` on a freshly created,
  decryptable provider.
- Cause: `credential_security()` does `payload = decrypt(raw)` then
  `payload.keys()` — but `decrypt()` returns a `str`, so every call raises
  `AttributeError` into the `except` branch — `backend/src/tollms/api/providers/service.py:757-766`
  (missing `json.loads`, cf. `masked_credentials` at `:56-62` which does it right).
- Impact: security-posture signal, not a leak (masked reads, Fernet-at-rest,
  and rotation all verified PASS). Fix: `payload = json.loads(decrypt(raw))`.

### M2 — Any active legal hold defers EVERY due purge (global gate, no per-user scoping)
- Code: `_purge_due_accounts` skips all users when `_legal_hold_active(db)` —
  `backend/src/tollms/services/jobs/scheduler.py:237-239,276-296`. The check is
  existence of any `hold_active` row, unrelated to the purged user
  (`models/incidents.py:178` default `hold_active=True`).
- Fail-closed is correct, but one unrelated hold can push unrelated erasures
  past SLA. Consider scoping holds to the affected user(s) or documenting the
  global-freeze policy. Observation only (unit-tested gate itself works).

## Low / observations

- **L1** — Per-IP flood guard keys on raw XFF (`core/rate_limit.py:26-34`,
  spoofable per-attempt). The control that matters — login lockout — is keyed
  via proxy-aware `gateway_client_ip` (`core/sessions.py:65-88`,
  `api/auth/service.py:339-361`). No bypass; harden `client_ip` to match.
- **L2** — Legal acceptance `ip_trunc` reads raw XFF (`api/legal/router.py:41`).
  Value is sha256-hashed at rest (verified), so spoofing affects forensics
  only. Consider `gateway_client_ip` for consistency.
- **L3** — Purge revokes sessions (`scheduler.py:244`) but does not invalidate
  user cache keys (`tollma:*`); entries linger until TTL. Low (no secrets cached).
- **L4 (accepted)** — `PurgeAuditLog` retains `deleted_user_id` + counts for
  forensics (`models/purge_audit.py:4`). By design; noted, not flagged.

## PASS (verified by test)

| # | Target | Test(s) | Result |
|---|---|---|---|
| 1 | Tenant isolation (providers/conversations/keys/consents/DSRs/exports; org strangers; 404-oracle, never 403) | `test_audit_isolation.py` (7 tests) | PASS |
| 2 | Credentials masked, Fernet at rest, rotation replaces hash | `test_provider_secrets_masked_fernet_and_rotatable` (partial — M1), `test_apikey_rotation_replaces_hash` | PASS except M1 |
| 3 | Erasure → 15d grace, idempotent re-request; purge covers owned tables; legal hold blocks | `test_erasure_request_grace_and_idempotent`, `test_purge_covers_owned_tables`, `test_legal_hold_blocks_purge` | PASS (ledger gap = H1) |
| 4 | Legal immutable published, idempotent accept-on-hash, reaccept flow, no UPDATE/DELETE routes | `test_legal_published_idempotent_reaccept`, `test_legal_router_has_no_update_delete_paths` | PASS |
| 5 | Non-admin 403 on audit/governance-writes/admin-compliance/subprocessor-admin; public intake + subprocessor list open | `test_nonadmin_denied_admin_paths_public_paths_open`, e2e `authz.spec.ts`, `public-intake.spec.ts` (6 tests) | PASS |
| 6 | SSRF 422 on create + draft_validate (169.254, localhost, file://, gopher://, userinfo, .local, ftp); mock passes under pytest; prod DNS enforced live | `test_ssrf_*` (12 tests), e2e `headers-ssrf.spec.ts` | PASS |
| 7 | Auth lockout spot-check; intake 429 burst; route guard wiring | `test_auth_lockout_spotcheck`, `test_intake_burst_rate_limited`, `test_intake_routes_carry_rate_limit_guard` | PASS |
| 8 | nosniff/DENY/no-referrer/permissions-policy/CSP on /api (TestClient + live curl) | `test_api_security_headers_present` | PASS |
| 9 | Audit log scrubs secrets; ip hashed; legal IP hashed; no PII in responses | `test_audit_log_scrubs_secrets_and_hashes_ip`, `test_legal_acceptance_ip_is_hashed_not_raw` | PASS |
| 10 | Zero-retention → empty prompt-log resolution | `test_zero_retention_shortcircuits_prompt_logging` | PASS |
| 11 | Revoked sessions rejected; legacy NULL age → 403 → confirm-age → 200 | `test_revoked_sessions_rejected`, `test_legacy_null_age_gated_until_confirm_age` | PASS |
| 12 | Functional consent withdrawal 422; optional withdraw works | `test_consent_functional_withdraw_422_optional_withdraw_ok` | PASS |
| 13 | Cross-user export 404s; full export excludes other users | `test_export_endpoints_reject_other_users_conversations`, `test_full_account_export_excludes_other_users` | PASS |
| 14 | jwt_secret required, no default; boot fails without it | `test_jwt_secret_required_no_silent_fallback` | PASS |
| 15 | No duplicate (path, method); all trust routers present | `test_openapi_no_duplicate_routes_and_trust_routers_present` | PASS |

Manual probes (live dev, non-destructive): `curl -D - http://localhost:8000/api/v1/legal/documents`
shows nosniff/DENY/no-referrer/permissions-policy/CSP; prod DNS pinning confirmed
(`http://mock` → 422 "does not resolve", private-resolved host → 422 "refused
egress") — `backend/src/tollms/core/egress.py:32-81`, choke point
`backend/src/tollms/api/providers/service.py:174-189`.
