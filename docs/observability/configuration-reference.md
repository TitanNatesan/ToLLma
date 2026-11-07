# Observability Configuration Reference (orchestrator)

## Precedence (enforced in `services/prompt_logging/resolution.py`)
Platform defaults → workspace setting (`prompt_logging_settings`, XOR personal/org, live-UQ per scope) → privacy zero-retention veto (any applicable scope; **fail-closed** on DB error) → key legs (global mode, or keys mode: listed + no-False-override + live key; empty targets log nothing, never fall back). Team config does not exist (ban upheld). Org policy never governs personal-key traffic and vice versa.

## Settings (existing table, no new settings table)
`enabled` (default false — ledger is opt-in), `mode` (global|keys), `capture_input/output` (default false), `retention_days` (default 90; null = keep bodies; expiry NULLs ciphers, metadata forever), key targets + per-key overrides (True force-on / False veto / NULL inherit). Mandatory-global guard: while enabled+global, explicit key force-off → 422.

## Retention interplay
Two systems: prompt-logging `retention_days` (body expiry per capture-time setting; no restamp on change) and privacy `RetentionPolicy` (zero_retention veto + category TTLs). Org `RetentionPolicy` rows for `prompt_logs/request_logs/api_request_logs` require `PromptLogs.Manage` to write and `PromptLogs.Read` to list (other categories: any member — unchanged). ## Failure semantics (read-path vs enforcement-path)
`resolve_retention()` is the READ path (populates UI/API retention views). The
capture-path zero check (`resolution._zero_retention_applies`, direct query)
and the purge scheduler are the ENFORCEMENT paths — they never consult
`list_retention`, so the Manage/Read gating on retention reads cannot weaken
enforcement. `resolve_retention` fails open ("no policy") while capture fails
closed (suppress); the split is deliberate (privacy over completeness).
Zero-check DB failures emit the `promptlog.zero_check_failed` counter —
alert on `dropped_* > 0` and on this counter.

## Access control
`PromptLogs.{Read,ViewContent,Manage,Delete}` (prereq ladder exempts Delete for custodial erase), `Analytics.Export` for org ledger export, `Analytics.*` for aggregates. Cross-workspace misses are 404 (no oracle). Scores: create=Read, delete=Manage. Purge: account scheduler hard-deletes obs ledgers (+ anonymizes `security_audit.actor_user_id`); any live legal hold defers all purges (global, fail-closed).

## Security properties
Single Fernet KEK, no rotation (Trust track owns the rotation op). Bodies encrypted pre-enqueue; headers/keys never persist; `status_message` scrubbed; `security_audit` fail-open writer + scrubbed metadata. Dual-read `SECRET_KEY_PREVIOUS` is NOT implemented in this wave (deferred to Trust KEK rotation op — no partial crypto agility shipped).
