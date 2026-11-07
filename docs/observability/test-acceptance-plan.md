# Observability — Test & Acceptance Plan (Agent 7, Phase 1 READ-ONLY)

- **Pre-check:** `git status --short` → only untracked `docs/observability/` drafts. No source edits, no git writes.
- **Builds on (not duplicated):** Agent 1 `langfuse-capability-inventory.md` (Langfuse surface + §15 scenario source), Agent 2 `backend-gap-audit.md` (ToLLma capture→storage→API evidence, §§1–15, gap scale P0–P3), Agent 3 `workspace-configuration-design.md` (ownership model, resolution precedence §2, risks R1–R8, hierarchy §4), Agent 4 `frontend-gap-audit.md` (F1–F11, IA §9), Agent 5 `data-architecture-design.md` (E1–E15 entity decisions, M-a…M-d migrations, I1–I5 indexes, §4 queue/§5 retention/§6 search performance rules).
- **Scope of this doc:** audit what the test suites cover today, then define the §15 acceptance plan (scenarios A–G) as concrete test names + fixtures + commands + pass criteria. No implementation — plan only.

## 1. Existing test audit (what already exists — do not re-plan)

### 1.1 Backend: prompt logging (9 files, ~3100 lines)

| File | What it covers | §15 relevance |
|---|---|---|
| `test_prompt_logging.py` (651 lines) | Resolution matrix (personal/org/disabled/keys-mode), capture flags, truncation, list pagination+filters, forged-filter 404 oracle, cross-workspace detail oracle, detail bodies (owner), retention job + `retention_info`, personal purge, org Read vs ViewContent, Manage/Delete gates | Partial B, partial A (filter/detail oracles only), partial E (purge) |
| `test_prompt_logging_acceptance.py` (517) | Disabled-writes-nothing, org-global-disabled, key-targeting matrix, multi-org key isolation, member-without-perms denied, forged workspace/filter IDs, cross-workspace detail oracles, purge-before-cutoff, pagination walk, Anthropic non-stream/stream shapes, OpenAI request_id correlation, internal cancel→partial | Partial A, B, C (cancel/partial only) |
| `test_prompt_logging_gaps.py` (386) | Cross-org key filter 404, nonmember filter 404, org purge + audit, Responses API shapes, external fail-open on persistence failure, input-only/output-only capture, internal cancel partial via real driver | Partial A, C (fail-open), E |
| `test_prompt_logging_hierarchy.py` (399) | 8-case keys-mode matrix (disabled/global/listed/veto/force-on/unlisted/empty-targets/team-irrelevant), multi-key OR, key-states roundtrip, forged-disable 422, state endpoints, Manage gating, personal-key isolation, disabled-key drops capture | B (keys leg — strongest file) |
| `test_prompt_logging_key_targets.py` (372) | Org precedence matrix, personal-key matrix, key-workspace 404 oracle, mode-switch clears targets, dead-key inert, unknown-provenance no-capture | B |
| `test_prompt_logging_hooks.py` (428) | Internal run_chat captures/failed/input, hook fail-open, sync-bridge failure skipped, status mapping, partial row, public shapes + usage intact, personal-key-never-org, provider-org mismatch attributes key org, guardrail-block withholds ledger | C (guardrail-block, failure), partial D |
| `test_prompt_logging_queue.py` (245) | Enqueue/flush roundtrip, disabled enqueues nothing, oversized truncated pre-enqueue, duplicate-delivery suppressed, queue-full drops + metric, worker-DB-down drops + generation survives, worker restart drains | C/F (backpressure behavior, no numeric targets) |
| `test_prompt_logging_names.py` (139) | Name present/duration-int, soft-delete safety, personal defaults+upsert, settings validation, org perm gates, key-target validation, personal upsert skips audit | B (validation) |
| `test_prompt_logging_retention_none.py` (96) | Zero-retention suppresses capture (F9) | E (kill-switch) |

**Covered well:** resolution keys-leg (B), 404-oracle isolation on listing/detail/filters (partial A), guardrail-block withholds ledger, fail-open queue behavior, cancel→partial, retention/purge basics.
**Not covered (drives §2):** trace/observation/generation/session IDOR beyond listing rows (A — no trace_id/session_key/scores/export IDOR tests exist because the columns/tables don't); global-mandatory + zero-retention + personal-leg interactions as a full precedence chain (B — covered pairwise, not end-to-end); streaming/tool-call/multi-generation/retry/timeout/missing-usage lifecycle (C — only cancel/partial + fail-open); token breakdown/cost/latency/hierarchy assertions on ledger rows (D — PromptLog has no cost/breakdown columns per Agent 2 §§8–9 P0); redaction/encryption-at-rest/export-surface audit (E — purge tested, redaction/export not); numeric performance targets (F — none).

### 1.2 Backend: request logs / analytics / exports / guardrails

| File | Covers | Gap for §15 |
|---|---|---|
| `test_request_logs.py` (143) | Non-stream chat writes row, summary aggregates, filters, export events recorded | D-partial (aggregates); no cross-workspace IDOR on request-log detail |
| `test_analytics.py` (404) + `test_analytics_consistency.py` (470) + `test_analytics_models.py` (51) + `analytics_api/test_analytics_api.py` | Range presets/timezone, totals/comparison/insights, per-user scoping, timeseries buckets, breakdown shares, heatmap, performance metrics, conversation rankings, CSV/JSON/XLSX export | D-partial (aggregates correct); no cost-per-quality (scores absent), no env/version segmentation |
| `test_exports.py` (125) | md/JSON/PDF conversation export, owner scoping, bulk scope gate, XLSX analytics export | E-partial (conversations only); **no ledger export tests** (no API — Agent 2 §12 P1) |
| Guardrail suite (12 files; trigger-relevant: `category_isolation`, `engines`, `notify_repeat`, `openai_moderation`, `policies`, `trigger_excerpts`) | Policy eval, excerpts, isolation, engines, notify | C-partial (block path); no trigger→ledger `request_id` join test (Agent 4 F7), no level/status_message taxonomy |

### 1.3 Frontend: unit + e2e

| Suite | Covers | Gap for §15 |
|---|---|---|
| `promptLogs.test.ts` | URL filter sync round-trip, `formatEffectiveSummary`, never-`[object Object]` | G-partial (filter state) |
| `promptLogKeyTargets.test.ts` | Key-target validation, payload (no team legs, global clears), normalization fallback, precedence copy | G-partial (settings UX) |
| `promptLogsGaps.test.ts` | Datetime-local conversion, filter composition, manage/delete gating, zero-pages merge, restricted bodies denied, blank retention → null, endpoint labels | G-partial (perms, empty states) |
| `promptLogsAcceptance.test.ts` | Global lock, workspace defaults, `resolveKeyLogging`, validation/422 payloads, effective-state copy | G-partial (settings logic) |
| `loggingHierarchy.test.ts` | (present; keys-leg hierarchy copy per Agent 4 §0) | G-partial |
| `guardrails.test.ts` + `wizardScope.test.ts`, `memberAnalytics.test.ts` | Guardrail UI, scope wizard, member analytics | No trigger→log link test (F7) |
| Playwright `e2e/*.spec.ts` (44 files) | Chat, analytics-settings, trust-privacy/security, api-keys-analytics, generation, organizations, etc. | **Zero files reference prompt-log/promptlog** (`grep -ril` → no hits). No `/prompt-logs` e2e exists. G-e2e is greenfield. |

## 2. Shared fixtures (all §15 scenarios use these — define once)

```python
# backend/tests/conftest.py additions (plan-only, not implemented):
# - owner_a, owner_b: verified users via user_factory (distinct emails)
# - org_a (root=owner_a), org_b (root=owner_b): Organization + root Membership rows
# - shared_member: user with ACTIVE Membership in BOTH org_a and org_b, NO PromptLogs.* grants
# - granted_member: ACTIVE member of org_a holding PromptLogs.{Read,ViewContent}
# - manager: ACTIVE member of org_a holding PromptLogs.{Manage,Delete}
# - key_a (org_a key, assignee owner_a), key_b (org_b key), key_personal_a (owner_a personal key)
# Helpers: _enable_logging(org|personal, mode, flags...), _capture_row(key, ...), auth headers per user.
```

**Rules:** every A-scenario test runs the same action in both workspaces and asserts cross reads are 404 (never 403/200). Shared-member tests assert denial without grants, success after grant. Frontend e2e seeds via API (not UI click-through for setup).

## 3. Commands (normative)

```bash
# Backend (serial — queue + sqlite; never parallel per backend.md)
cd backend && python -m pytest tests/test_prompt_logging*.py tests/test_request_logs.py -q
cd backend && python -m pytest tests/test_observability_acceptance.py -q   # new §15 file(s)
# Frontend unit
cd frontend && npx vitest run src/app/prompt-logs
# E2E (needs seeded dev server + two workspaces)
cd frontend && npx playwright test e2e/prompt-logs.spec.ts e2e/observability-permissions.spec.ts
```

**Pass criteria (global):** pytest exit 0, vitest exit 0, playwright exit 0; no skipped §15 test without a named blocking-migration reason; `alembic check` green if migrations ship alongside.

## 4. Scenario A — Workspace isolation (IDOR)

Goal: prove every observability read is workspace-pinned with 404 oracle. Builds on Agent 3 §1 (XOR ownership) + Agent 2 §14 (strength + Delete-code note).

| # | Test name (file) | Setup | Pass criteria |
|---|---|---|---|
| A1 | `test_xws_trace_id_cross_org_404` (`test_observability_acceptance.py`) | owner_a captures row in org_a (trace_id=T_a). shared_member + owner_b GET detail via org_b scope with T_a | Both get 404; response body contains no org_a identifiers |
| A2 | `test_xws_observation_id_cross_org_404` | Same as A1 but addressing the ledger row id directly | 404 for non-member workspace; owner_a 200 |
| A3 | `test_xws_generation_link_cross_org_404` | Internal generation in org_a (`generation_id` = message id). owner_b requests generation-linked ledger view with org_b scope | 404; no message content leaked |
| A4 | `test_xws_session_key_cross_org_404` | Rows in org_a + org_b share a colliding `session_key` string. List sessions as owner_a | Only org_a rows returned; count excludes org_b rows |
| A5 | `test_xws_scores_subject_cross_org_404` | Score attached to org_a trace. owner_b GET score / list by trace | 404 / empty list; no score value leaked |
| A6 | `test_xws_export_cross_org_404` | owner_b requests ledger export with org_a filter params | 404 (or 422 if filters validated first — either, but never org_a bytes); ExportEvent row (if any) stamped org_b |
| A7 | `test_xws_listing_filter_forgery_404` | shared_member passes `key_id/user_id/provider_id/model_id` belonging to org_a while scoped to org_b (extends existing forged-filter tests to all four ID filters + `q=request_id` of org_a row) | Every forged combination → 404 or empty-list-without-leak (assert one behavior per filter, documented in test) |
| A8 | `test_xws_personal_never_org_visible` | owner_a personal-key row. owner_b + shared_member list org_a/org_b logs | Personal row appears only in owner_a personal scope; both org listings exclude it |
| A9 | `test_xws_suspended_member_denied` | Suspend org_a membership of granted_member; retry list + detail | 404/403 (auth fails before resolution per Agent 3 §4.1-iv); no rows returned |
| A10 | `test_xws_trigger_request_join_scoped` | Guardrail trigger with `request_id` of org_a row. granted_member of org_b follows trigger→log link | 404 on the log side; trigger itself invisible to org_b |

## 5. Scenario B — Configuration precedence

Goal: lock Agent 3 §2 resolution order as executable contract (platform defaults → workspace → zero-retention veto → key legs → effective row). Extends `hierarchy`/`key_targets` pairwise coverage to full-chain.

| # | Test name | Setup | Pass criteria |
|---|---|---|---|
| B1 | `test_prec_platform_default_off` | Fresh workspace, no setting row | Capture attempt → no row; `GET settings` returns disabled default |
| B2 | `test_prec_org_ignores_personal_and_vice_versa` | Personal setting enabled for owner_a; org_a setting disabled. Capture via org_a key, then via personal key (Agent 3 §4.1-v i+ii) | Org-key traffic → no row; personal-key traffic → row (and inverse when toggled) |
| B3 | `test_prec_zero_retention_vetoes_enabled` | org_a setting enabled+global; `zero_retention=True` privacy policy | No row captured; veto wins over enabled |
| B4 | `test_prec_key_hint_cannot_divert` | Capture with `org_id` hint = org_b but key row = org_a (Agent 3 R4) | Row stamped `org_id=org_a`, `workspace_type=organization`, `match_source` from resolver |
| B5 | `test_prec_unknown_key_no_capture_no_fallback` | Lookup-exception provenance | No row; no personal fallback |
| B6 | `test_prec_global_mandatory_no_force_off` | Enabled+global; per-key `False` override attempt | API 422; existing matrix cases keep passing |
| B7 | `test_prec_keys_empty_targets_capture_nothing` | Mode keys, targets cleared | No row; never falls back to global |
| B8 | `test_prec_override_true_needs_enabled` | Override `True` on key under disabled setting | No row (`True` cannot enable a disabled workspace) |
| B9 | `test_prec_missing_user_id_no_capture` | Org provenance with `user_id=None` (Agent 3 R2) | No row (documents coverage hole, not leak) |
| B10 | `test_prec_retention_days_stamps_expires` | Setting `retention_days=30` then capture | Row `expires_at ≈ now+30d`; changing setting later does not restamp old row (Agent 5 §5.4) |

## 6. Scenario C — Observability lifecycle

Goal: every terminal path leaves exactly one honest ledger row (Agent 2 §§3,10,15; Agent 5 §4).

| # | Test name | Setup | Pass criteria |
|---|---|---|---|
| C1 | `test_life_streaming_terminal_captures_once` | Streamed generation, terminal chunk carries usage | Exactly one row; tokens = terminal usage; no per-chunk rows |
| C2 | `test_life_tool_call_flat_today_hierarchy_tomorrow` | Agent run with tool calls (mock adapter emitting `tool_calls`) | Today: one generation row, tool calls absent from ledger (documents flatness, Agent 2 §2); gated `test_life_tool_call_spans` skipped until E4 writer ships, then asserts parent→child linkage |
| C3 | `test_life_multi_generation_one_row_each` | Conversation with N assistant messages | N rows, each `generation_id` = message id; no cross-linking |
| C4 | `test_life_guardrail_block_withholds_ledger` | Blocked generation (extends hooks coverage to public plane + all stages) | No prompt-log row; GuardrailTrigger row exists with `request_id`; error_code set on request log |
| C5 | `test_life_provider_failure_records_error` | Mock adapter raises classified failure | Row `status=failed`, `error_code` set, input captured per flags, no output cipher |
| C6 | `test_life_timeout_maps_to_failed` | Adapter times out | Same assertions as C5 with timeout error_code |
| C7 | `test_life_retry_single_row` | First attempt fails, retry succeeds (same `request_id`+`generation_id`) | Exactly one row (idempotency UQ collapses redelivery; Agent 5 §7); success values win |
| C8 | `test_life_cancel_with_text_partial` | Cancel after partial tokens (both planes) | `status=partial`, partial output stored, usage = partial counts |
| C9 | `test_life_estimated_usage_flagged` | Provider silent on usage (both planes) | `usage_estimated=true` (or new-column equivalent), tokens = `len//4` fallback |
| C10 | `test_life_worker_down_inline_fallback` | Kill worker, capture (extends queue tests) | Generation succeeds; row persisted via inline path; counter incremented |
| C11 | `test_life_queue_full_drops_counted` | Fill queue (MAXSIZE=1000, unit-scale with monkeypatched small size) | Drop + `dropped_full` counter; generation unaffected (fail-open) |

## 7. Scenario D — Data correctness

Goal: tokens/cost/latency/hierarchy/metadata on rows are right, honest about unknowns (Agent 2 §§8–9 P0, Agent 5 M-a/M-b, §2.6 NULL rule).

| # | Test name | Setup | Pass criteria |
|---|---|---|---|
| D1 | `test_data_token_breakdown_forwarded` | Capture with cache+reasoning tokens (both planes) | Row carries prompt/completion/total/cache_read/cache_write/reasoning; no silent drop |
| D2 | `test_data_cost_on_ledger` | Priced model generation | `input_cost/output_cost/total_cost` = price × exclusive buckets (Agent 1 §5 bucket contract); unpriced model → NULL cost, never `$0` |
| D3 | `test_data_latency_ttfb` | Timed generation | `latency_ms ≈ end-start`; `ttfb_ms` present where measurable, NULL (not 0) otherwise |
| D4 | `test_data_hierarchy_columns` | Internal generation with conversation | `trace_id`/`generation_id`/`conversation_id` all set and mutually consistent; public row `trace_id=request_id`, `generation_id=NULL` |
| D5 | `test_data_prompt_link_columns` | Generation with prompt name/version | `prompt_name`/`prompt_version` stamped on message + ledger row |
| D6 | `test_data_error_taxonomy` | Failed generation | `level` + `status_message` (+ `error_code`) all persisted; level filter `level:ERROR` returns the row |
| D7 | `test_data_backfill_honest_nulls` | Pre-migration rows (M-a/M-b backfill) | Unjoinable rows stay NULL (never 0/false); joinable rows match `messages`/`api_request_logs` values |
| D8 | `test_data_analytics_matches_ledger` | N captures then analytics summary | Totals/buckets equal ledger sums within rounding; per-user scoping excludes other users |

## 8. Scenario E — Privacy

Goal: bodies protected, access least-privilege, erasure complete (Agent 2 §11, Agent 3 R1/R8, Agent 5 §5).

| # | Test name | Setup | Pass criteria |
|---|---|---|---|
| E1 | `test_priv_bodies_encrypted_at_rest` | Captured row with input+output | DB cipher columns are Fernet tokens (not plaintext); decrypt via app service succeeds |
| E2 | `test_priv_bodies_gated_view_content` | granted_member (Read only) vs +ViewContent | Read-only: metadata 200, bodies redacted/empty; with grant: bodies 200 |
| E3 | `test_priv_personal_owner_always_bodies` | owner_a personal row | Owner sees bodies without any grant |
| E4 | `test_priv_retention_sweep_nulls_ciphers` | Expired row + retention job | Ciphers NULLed, metadata intact, `content_expired=true`; batched (LIMIT loop) at scale |
| E5 | `test_priv_purge_personal_and_org_audit` | Purge before cutoff (extends existing) | Old rows expired, new rows kept; org purge writes audit row; per-org job ledger not required (accepted M3) |
| E6 | `test_priv_single_delete_hard_deletes` | DELETE row | Row gone (not NULLed); audit-committed or rolled-back atomically |
| E7 | `test_priv_retention_write_gated_manage` | shared_member (no grants) upserts `RetentionPolicy(zero_retention)` for org_a (Agent 3 R1 fix) | 403/404; only Manage-holders (or owner) can write; read of retention info needs Read (R8) |
| E8 | `test_priv_export_audit_and_scope` | Ledger export (when built) | ExportEvent row with dataset + scope; export contains only requesting workspace rows |
| E9 | `test_priv_account_purge_cascades` | Account purge job | All observability rows for user gone; PurgeAuditLog written last with counts |

## 9. Scenario F — Performance (targets are acceptance thresholds, not benchmarks)

Environment note: targets below assume seeded scale (see F-setup) on CI-class hardware (2 vCPU, 4 GB), Postgres 15+, empty Valkey. Measure with `pytest --benchmark` or the stated query; record wall time in the test log.

**F-setup (shared):** seed script creates 1M `prompt_logs` (org_a, 90-day spread, mixed status/error_code), 100K `request_logs`, 10K `guardrail_triggers`; `VACUUM ANALYZE`; captures `EXPLAIN (ANALYZE, BUFFERS)` for F3.

| # | Test name | Method | Target (pass criteria) |
|---|---|---|---|
| F1 | `test_perf_capture_overhead_p50` | Time internal generation with logging on vs off (mock adapter, n=200) | Median overhead ≤ 5% or ≤ 15 ms per generation, whichever is larger; p99 ≤ 50 ms |
| F2 | `test_perf_capture_throughput` | 1000 sequential captures via queue, worker running | ≥ 200 rows/s sustained; zero drops (`dropped_full == 0`, `dropped_error == 0`) |
| F3 | `test_perf_listing_p95` | Org-scoped keyset page (limit 25) + all filters on 1M rows | p95 ≤ 300 ms; plan uses `ix_prompt_logs_org_created` (Index Scan Backward, no seq scan) |
| F4 | `test_perf_search_wildcard_bounded` | `q=<8-char substring>` ILIKE on 1M rows, org-scoped | p95 ≤ 1500 ms (documents leading-wildcard scan; fail if pg_trgm needed → file follow-up, don't silently add index) |
| F5 | `test_perf_retention_batch` | Expire 100K due rows via batched sweep (LIMIT 5000) | Completes ≤ 120 s; per-batch commit (no single 100K-row txn); no lock timeout on concurrent listing |
| F6 | `test_perf_backpressure_counts` | Monkeypatched MAXSIZE=10, burst 50 captures | All generations succeed; `dropped_full == 50 - 10 - drained`; counter visible via `retention_info` |
| F7 | `test_perf_analytics_summary` | Org summary over 1M rows (default 30d range) | p95 ≤ 2000 ms; no per-row Python loop (server-side aggregates) |

## 10. Scenario G — Frontend

Unit (`vitest`, `src/app/prompt-logs/components/__tests__/`) + e2e (`playwright`, new `e2e/prompt-logs.spec.ts` + `e2e/observability-permissions.spec.ts`; no prompt-log e2e exists today — §1.3).

| # | Test name | Type | Pass criteria |
|---|---|---|---|
| G1 | `renders cost column and unpriced badge` (F1) | vitest | Cost column renders formatter output; NULL cost → "unpriced", never "$0.00"; estimated rows show estimated badge |
| G2 | `filter pickers autocomplete from list endpoints` (F2) | vitest + e2e | Typing in user/key/provider/model filter offers options from existing endpoints; selecting sets UUID param; free-text UUID still accepted |
| G3 | `promptLogLogic lives in shared module` (F3) | repo lint (import rule) | No imports of `app/prompt-logs/components/*` from outside `app/prompt-logs`; shared helpers resolvable from `lib/` or `components/logging/` |
| G4 | `analytics bucket drills to filtered logs` (F4) | e2e | Clicking a model/conversation bucket navigates to `/prompt-logs` with preset filters; table shows only that bucket's rows |
| G5 | `log row with conversation opens chat` (F5) | e2e | Row with `conversation_id` offers "Open conversation" → `/c/[id]` loads the turn |
| G6 | `detail renders usage and provenance or drops them` (F6) | vitest | `usage`/`provenance` either rendered or removed from `PromptLogDetail` type (no dead typed-but-unrendered fields) |
| G7 | `guardrail trigger links to prompt log` (F7) | e2e | Trigger inspector "View request" deep-links to `/prompt-logs?requestId=`; cross-workspace link shows denied empty state, not foreign data |
| G8 | `list filters pagination hierarchy details` (core explorer) | e2e | Apply each filter → URL updates (shareable, reload-safe); Load-more appends without duplicates; `?requestId=` opens drawer directly; hierarchy (when backend ships children) renders tree/waterfall |
| G9 | `settings precedence copy and guards` (S1–S7) | e2e | Disabled/global/keys flows + 422 forged-disable + global-clears-targets confirm + restamp-warning copy (F10) all match Agent 3 §4.2 |
| G10 | `permissions matrixDeniedStates` | e2e (as shared_member / granted_member / manager) | No-grant member sees denied copy; Read sees metadata only; +ViewContent sees bodies; Manage edits settings; Delete purges; Delete vs purge blast-radius copy distinguished (F11) |
| G11 | `export downloads scoped file` (F9, backend-gated) | e2e | Export button downloads CSV/JSONL containing only workspace rows; skipped with reason until ledger-export API ships |

## 11. Acceptance gate (Phase 2 exit criteria)

1. All A-tests pass (zero cross-workspace leaks, 404 oracle uniform) — **blocking**.
2. All B-tests pass (resolution order locked) — **blocking**.
3. C-tests pass except C2-hierarchy half (skipped with E4 gate reference) — blocking otherwise.
4. D-tests pass after M-a/M-b (D2/D4/D5 are the migration acceptance) — blocking.
5. E-tests pass after R1/R8 authz fix (E7 is the fix acceptance) — blocking.
6. F-targets met on seeded scale; any miss files a follow-up with `EXPLAIN` evidence instead of silently adding indexes (Agent 5 §3.2 rule).
7. G-tests pass; G11 skipped until export API ships; G3 layering move lands with tests moved alongside.

## Completion contract

- [x] `git status --short` pre-check (read-only; only `docs/observability/` untracked).
- [x] Read `AGENTS.md`, `.opencode/rules/test.md`, `FILE_OWNERSHIP.md`, Agents 1–5 docs — built on, not duplicated (all cross-refs point to their sections).
- [x] Audited: `backend/tests/test_prompt_logging*.py` (9 files), `test_request_logs.py`, analytics (4 files), `test_exports.py`, guardrail trigger tests, frontend `__tests__` (5 files) + e2e dir (44 specs, zero prompt-log coverage).
- [x] Designed §15 A–G: 10 + 10 + 11 + 8 + 9 + 7 + 11 concrete tests with fixtures, commands, pass criteria; shared two-workspace/two-owner/shared-member fixture; performance targets (F1–F7); acceptance gate.
- [x] Wrote ONLY `docs/observability/test-acceptance-plan.md`. No other files, no git writes.
- **Handoff:** Orchestrator Phase 2 schedules A/B/C/E-privacy-authz first (no new tables needed), D/F-sweep after Agent 5 M-a/M-b + I1/I2, C2-hierarchy + scores/E6 + export/G11 after their writers/APIs land; Agent 6 confirms E7 direction + A-oracle uniformity.
