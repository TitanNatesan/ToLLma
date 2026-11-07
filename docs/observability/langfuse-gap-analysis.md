# Langfuse vs ToLLma Gap Analysis (orchestrator, Phase 2)

Source: Agent 1 inventory + Agents 2–6 audits (see `docs/observability/*-audit.md`, `*-design.md`). Verified against code; no column-exists claims.

| Capability | Langfuse (verified) | ToLLma actual | Gap | Priority | Implementation |
|---|---|---|---|---|---|
| Trace hierarchy | trace spans generations; trace_id join key | No trace entity; planes unjoinable (conversation_id vs request_id) | P0 | P0 | `prompt_logs.trace_id`: internal = conversation_id, public = request_id; `generation_id` populated on public plane |
| Spans (parent/child) | span/event tree under trace | None; tool calls in-memory only | P1 | P2 | DEFERRED (gate: tool-call persistence writer). Reserved shape in data-architecture-design §2.7 |
| Generations | per-call row: params, usage, cost, finish reason | Message IS the generation (usage/cost/ttfb OK); PromptLog mirrors subset only | P0 on ledger subset | P0 | Ledger gains usage_estimated, total/cache/reasoning tokens, input/output/total cost, finish_reason, model_params, level/status_message |
| Token usage | input/output/total + cache/reasoning/modality; reported-vs-estimated flag | Pipeline sound; PromptLog drops cache/reasoning + estimated flag | P0 | P0 | Same columns as above |
| Cost details | per-type costs, pricing version, currency | No cost on PromptLog; no price pin; silent $0 unpriced | P0/P2 | P0 ledger costs; P2 tiers/unpriced-signal stay deferred | input/output/total cost + pricing_version (repo sync identity) + currency=USD |
| Sessions | sessionId groups traces cross-plane | conversation (internal only); auth sid misnamed on Message | P1 | P1 | `session_key` column (user-settable, cross-plane); public gateway accepts client session key; no sessions table |
| Scores | numeric/categorical/boolean on trace/observation | None (zero matches) | P0 quality / P3 harness | P0 minimal scores; P3 datasets/experiments/judges deferred | NEW `scores` table + api/scores trio (name, value, datatype, subject, source, comment) |
| Metadata/tags | tags + metadata + env/release/version | Fixed columns only; 2 LIKE fields | P1 | DEFERRED (next milestone; needs a named query + index rule) | Closed schema holds; revisit only with a named query + GIN evidence (data-arch §3.4) |
| Evaluations/datasets/experiments | datasets, runs, judges | None | — | P3 | DEFERRED with gates (experiment_id subject field reserved on scores) |
| Prompt management link | promptName/version on generation | No managed prompts | P2 | P2 | DEFERRED (link columns only when authoring exists) |
| Errors/diagnostics | level + statusMessage + codes | codes only; no level/message on ledger | P2 | P1 cheap | `level` + `status_message` columns (scrubbed) |
| Search/filter | trace/obs/session/model/tag/time/env/status/cost/token | Fixed filters; no cost/token/status-range on ledger | P1 | P1 | trace_id/session_key/status/level filters + cost/token range on list endpoint |
| Retention | per-scope TTL, purge, legal hold | Bodies expire, metadata forever; dual-TTL confusion; retention writes under-gated | P0 authz | P0 fix + P2 restamp/docs | Org retention writes for observability categories require PromptLogs.Manage (F-R1); zero-retention check fail-closed |
| Export | CSV/JSON/API bulk | Conversations only; no ledger export | P1 | P1 | Ledger CSV/JSONL export (cursor-paged, Analytics.Export for org) |
| Workspace settings | project-level controls | PromptLoggingSetting XOR + resolution (solid); no scores/export settings surface; dual-TTL explained only in docs | P1 | PARTIAL — settings table reused, no new table; retention single-pane UI copy NOT built (docs only) | Reuse settings table; no new settings table |
| Access control | API keys + read/write scopes | PromptLogs.{Read,ViewContent,Manage,Delete} + 404 oracles (strength); body reads unaudited | P1 | P1 | Org AuditLog on content view + export; aggregates documented as non-content-gated |
| Encryption | at-rest, per-project keys | Single Fernet KEK, no rotation (Trust-known) | P1 | DEFERRED to Trust track (no partial crypto agility shipped; dual-read was planned, not built) | KEK rotation op stays Wave-4 Trust work |
| Deletion | trace deletion, retention | Purge complete (H1 fixed) except security_audit rows survive | P1 | P1 | Anonymize security_audit.actor_user_id on purge |
| Ingestion perf | batch ingest, sampling | Sync-encrypt + bounded queue + fail-open (sound); drops counted-not-alerted | P2 | P2 | Alert on dropped_* (docs); no MAXSIZE growth |

P0/P1 in the right column are implemented in Phase 3 unless marked DEFERRED with a gate.
Post-review fixes (reviewer ses_e4e2c379): H1 unpriced-NULL invariant now enforced on both planes (cost/currency/pin NULL when unpriced; `is_priced()` in costing); H2 CSV formula-injection guard at export serialization; H3 scores rewrite UQ (`uq_scores_rewrite` on scope+name+day+subject) + loser-updates path; M4 rewrite overwrites full mutable set.
