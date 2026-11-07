# Observability Security + Privacy Gap Audit (Agent 6 — Phase 1 READ-ONLY)

- **Pre-check:** `git status --short` → only untracked `docs/observability/`. No source edits. No git writes.
- **Method:** code reading only.
- **Builds on (not duplicated):** Agent 1 inventory, Agent 2 backend audit, Agent 3 workspace design (R1–R8), Agent 4 frontend audit (F1–F11), Agent 5 data architecture (E1–E15, I1–I5, M-a…M-d).
- **Gap scale:** P0 = actively exploitable / data-loss / erasure failure · P1 = missing control, no workaround · P2 = partial/degraded · P3 = nice-to-have.
- **Scope:** `prompt_logs` + `request_logs` + `api_request_logs` + `guardrail_triggers` + `export_events` + `security_audit` + provider/guardrail credential stores. Chat `messages`/`conversations` only where they join the ledger.

## 1. Encryption — single KEK, no rotation, one key for all workspaces

- One Fernet key for everything: `_fernet()` derives `base64(sha256(SECRET_KEY))` — `backend/src/tollms/core/crypto.py:12-14`; `encrypt`/`decrypt` `:17-25`, `mask` `:28-32`.
- Same key encrypts prompt bodies (`models/prompt_logging.py:196-198`, written `services/prompt_logging/capture.py:99-100`), provider credentials (`models/provider.py:79`), guardrail evaluator credentials (`models/guardrail.py:177`).
- `SECRET_KEY` and `jwt_secret` are independent required env vars (`core/config.py:71,75`). Good separation.
- `kek_status` reports `algorithm=fernet, kek_version=1, rotation_supported=False` (`api/security/service.py:227-235`), any-active-user readable. Algorithm only, never key material — correct.
- Bodies truncated to 512K chars pre-encrypt; encrypted synchronously at enqueue so raw text never crosses threads.
- Decrypt failure is silent `None` (`api/prompt_logging/settings.py:336-343`); detail falls back to `content_restricted=True` (`api/prompt_logging/records.py:300-303`). Fail-safe display, masks KEK-rotation breakage.

Gaps:
- **P1-1 — No KEK rotation / versioning.** Single key, no version column, no re-encryption plan. Rotating `SECRET_KEY` bricks every stored body + credential.
- **P1-2 — One key for all workspaces and all secret classes.** No per-workspace DEK, no usage separation.
- **P2-1 — Metadata plaintext by design** (request_id, endpoint, status, tokens, latency, joined emails/names).
- **P2-2 — No AAD / workspace binding inside ciphertext**; scope enforced by columns only.

## 2. Redaction

Scrubbed (keep): `services/observability/events.py:23-49` `_SECRET_MARKERS` backstop; `api/security/service.py:30-55` scrub; provider validation-message regexes (`api/providers/service.py:33-53`); guardrail excerpt redaction (`services/guardrails/deterministic.py:190-205`, `enforcement.py:34-38`); email/session masking (`services/email/service.py:33-34`, `core/sessions.py:108-119`); queue `last_error` class-only.

Not scrubbed:
- **P1-3 — Prompt bodies persist verbatim (no PII/secret scrubbing).** Pasted keys/passwords stored encrypted but unredacted, readable by every `ViewContent` holder until `expires_at`.
- **P2-3 — Overbroad marker list** (`name`/`text`/`message`) will swallow future diagnostic fields; use allow-listed keys for new observability fields.
- Strength: headers/API keys never persist (only `api_key_id` FK).

## 3. Content access

- Listing metadata-only; bodies require `GET detail` + `PromptLogs.ViewContent` (`records.py:258-266`, enforced `:268-304`). 404 oracles cross-workspace. Org analytics separates `ViewUsage` from `ViewCost`. Search never returns bodies.

Gaps:
- **P1-4 — Body reads are unaudited.** No org `AuditLog` row, no `security_audit` type for content views.
- **P2-4 — Metadata listing leaks PII to `Read` holders** (`user_email` + `key_name` joined on every page).
- **P2-5 — Aggregates bypass the body gate by design** (document, don't silently widen).

## 4. Workspace isolation

Strengths: workspace-pinned scopes + 404 oracles hold on settings/records/providers/search; key-row-wins provenance; team isolation holds; key-auth backstop (tombstones + 30s context TTL + 90s tombstone TTL).

Gaps:
- **P0-1 — Retention-policy writes under-gated (Agent 3 R1, confirmed).** Org `RetentionPolicy` upsert needs only any ACTIVE membership (`api/privacy/service.py:139-150`), while the prompt-logging setting needs `PromptLogs.Manage`. Any member can set `zero_retention` and silently suppress capture.
- **P1-5 — Zero-retention check fail-open vs resolution fail-closed.** DB blip during active `zero_retention` captures forbidden rows.
- **P2-6 — Org traffic without `user_id` silently uncaptured.**
- **P2-7 — `org_id` hint accepted but ignored** (safe today; guard the future fix).
- **P2-8 — Stale key-target rows** re-activate if a key is re-enabled.

## 5. Exports

- Personal conversation exports only (md/json/pdf, cap 200); no ledger bulk export; `Analytics.Export`/`Audit.Export` codes exist with no enforcing endpoint (dead perms).

Gaps:
- **P1-6 — No ledger/warehouse export path.** When built, gate org use on `Analytics.Export`.
- **P2-9 — Exports are bearer responses: no expiry, no rate limit, no DLP.**
- **P3-1 — Personal export login-only** (by design; org export must not copy this).

## 6. Deletion

- Retention: per-row `expires_at` from setting at capture; daily cleanup NULLs ciphers, keeps metadata; zero-retention short-circuits both scopes; account purge H1 coverage complete; `UsageDailyAggregate` anonymized; legal hold fail-closed global.

Gaps:
- **P1-7 — `security_audit` rows survive account purge** (erasure incompleteness — retain-with-basis or anonymize).
- **P1-8 — No backup lifecycle** (restores resurrect purged bodies/creds).
- **P2-10 — Metadata-forever needs explicit GDPR-minimization sign-off** + future `hard_delete_after_days` hook.
- **P2-11 — No restamp on policy change** (rows keep old `expires_at`).
- **P2-12 — Daily job writes no per-org proof.**
- **P2-13 — Global legal hold is coarse** (one hold freezes all purges).

## 7. Audit trails

- `security_audit` append-only, fail-open + scrubbed; org `AuditLog` covers config/erase but not reads.

Gaps:
- **P1-9 — Sensitive observability actions emit no audit** (content views, exports, retention changes). Add `observability.content_viewed` + `observability.exported` at minimum.
- **P2-14 — Telemetry/queue drops counted, never alerted.**
- **P3-2 — Dead audit perms** (`Audit.Export` unwired).

## Severity-ordered findings

| Sev | ID | Finding |
|---|---|---|
| P0 | F-R1 | Any ACTIVE member can veto workspace capture via `RetentionPolicy.zero_retention` |
| P1 | F-KEK1 | No KEK rotation/versioning |
| P1 | F-KEK2 | Single Fernet key for all workspaces + secret classes |
| P1 | F-BODY | Bodies persist verbatim, no PII/secret scrubbing |
| P1 | F-AUD1 | Body reads unaudited |
| P1 | F-ISO1 | Zero-retention check fail-open |
| P1 | F-EXP1 | No ledger bulk export |
| P1 | F-DEL1 | `security_audit` survives account purge |
| P1 | F-DEL2 | No backup lifecycle |
| P1 | F-AUD2 | No observability audit event types |
| P2 | F-META1/2 | Metadata plaintext + email joins; aggregates not content-gated (document) |
| P2 | F-ISO2 | user_id-None hole; org_id hint; stale targets |
| P2 | F-EXP2 | Exports: no expiry/rate-limit/DLP |
| P2 | F-DEL3 | Metadata-forever; no restamp; no job proof; coarse hold |
| P2 | F-AUD3 | Drops counted, never alerted |
| P2 | F-RED1 | Overbroad `_SECRET_MARKERS` |
| P3 | F-EXP3/AUD | Dead perms; personal export login-only (keep) |

## Phase 6 negative authorization tests (must-run)

T-READ-01 personal cross-read → 404. T-READ-02 org cross-read + list → 404. T-READ-03 body gate (`Read` w/o `ViewContent` → `content_restricted:true`). T-READ-04 filter oracle (suspended user / foreign key / provider → 404). T-READ-05 search isolation (empty groups; personal never returns prompt_logs). T-KEY-01 revoked key → 401, zero rows. T-KEY-02 removed assignee → deny. T-KEY-03 key-target forgery → 404; force-off under global+enabled → 422. T-RET-01 veto without Manage → must become 404/403 after fix. T-EXP-01 personal export isolation → 404. T-EXP-02 org export scoping + `Analytics.Export`. T-TRIG-01 guardrail cross-read → 404, excerpts redacted. T-CRED-01 credential masking. T-DEL-01 erase gates (Read-only denied; Delete-only succeeds — custodial erase). T-DEL-02 expired readability (metadata-only). T-DEL-03 legal hold defers purge. T-AUD-01 audit gates (non-admin 403). T-KEK-01 rotation drill (expected fail today). T-BACKUP-01 restore-then-repurge.

(Saved by orchestrator verbatim from Agent 6 review output; Agent 6 sandbox exposed no file-write tool. No source files touched.)
