# Final Acceptance Record (orchestrator, evidence-based)

Scope: agreed P0/P1 per implementation-plan.md + gap-analysis.md (right column).
Method: code-path trace DB→service→API→auth→frontend→tests for each capability;
test re-runs on isolated DBs; live probes against :8000/:3000; independent
reviewer pass (no Critical). No shared services restarted for verification
except :3000 (clean restart after builds — mine to manage); no shared DB writes.

## Acceptance matrix

| Requirement | Actual implementation | Evidence | Final status |
|---|---|---|---|
| Trace correlation | trace_id on every ledger row: internal = conversation id (all generations of a turn share it), public = request id; deterministic generation_id per request; list filter + copy-trace UI | generation.py:565, public_gateway:798, gateway/service:727; tests: public session/header, internal trace, colliding-session A4 (all green) | PASS (within-plane; cross-plane single-trace does not exist — ID spaces differ by design) |
| Hierarchical tracing | None: no span/event rows, no parent links, no tree API (verified: zero parent_observation hits) | data-architecture-design §2.7 reserved shape | FAIL (deferred with gate: tool-call persistence writer + tree read API) |
| Generation accounting | All 3 planes wired (streaming driver, keyed chat, public incl. streaming/cancel/fail/media-fail); finish_reason, model_params (public), level, scrubbed status_message | tests: 19 ledger (incl. internal trace, failure taxonomy, cancel); code read of all 8 public + 2 gateway call sites | PASS |
| Token and cost tracking | Full usage set + estimated flag + costs + currency + pricing pin on all planes; unpriced → NULL (H1, plane-tested); message rows keep legacy $0 convention (unchanged surface) | test_unpriced_model_plane_rows_null_costs + full-column round trip; is_priced() in costing | PASS |
| Scores | CRUD + same-day rewrite + rewrite UQ (live in pg) + Read-create/Manage-delete + 404-oracle subjects + list filters + drawer UI | 10 scores tests; uq_scores_rewrite in pg_indexes; e2e empty-state | PASS (concurrent-race loser path code-reviewed only) |
| Workspace configuration | XOR settings reuse, precedence unchanged + hardened, Manage-gated obs retention, single-pane copy in RetentionSection, no new tables, team ban upheld | retention tests, B2/B10, trust-privacy e2e (retention save) | PASS |
| Workspace isolation | Scope-pinned queries + 404 oracles on logs/scores/export/retention; A4 session-collision; cross-org score IDOR | audit wave-5 batteries + obs A-tests, all green | PASS |
| Privacy | Fernet at rest, headers/keys never persist, scrubbed status_message, bodies withheld on failure/expired, ViewContent gate + content-view audit, purge anonymizes audit actor | ledger/export tests incl. secret-scrub + purge-anonymization assertions | PASS |
| Retention | Per-row body expiry, zero veto + fail-closed counter, purge + legal-hold gate, drop counters on retention endpoint | B3/B10, export purge test, live counters | PASS (no restamp: documented P2; metadata-forever: needs counsel sign-off) |
| Search and filtering | trace/session/status/level/cost/token + existing scope filters, shared helper for list+export, 422 on bad level | filter tests incl. invalid-level 422; e2e filter round trip | PASS |
| Export filtering | Documented subset (trace/session/status/level/cost/token) + UI copy stating list-only filters; bodies never exported; formula-guarded; ExportEvent per call | export tests (csv/jsonl/paging/gates/no-leak); e2e header-only CSV | PARTIAL (full parity = next milestone; no query-logic duplication today) |
| Tags | Not implemented | — | DEFERRED (next milestone; gate = named query + index) |
| Datasets | Not implemented; experiment_id reserved | — | DEFERRED (future capability) |
| Operational alerts | Queue counters + zero-check counter exposed (retention endpoint + Valkey key documented); no pager | live probe (all 0 on dev); queue.stats() | PARTIAL (signals exist; no alerting configured) |
| Backup evidence | Procedure only | — | FAIL (no drill) |
| KEK rotation | Not started (Trust Wave-4 owns it) | zero SECRET_KEY_PREVIOUS hits | FAIL (deferred, correctly owned elsewhere) |

## Decision A — is the agreed P0/P1 scope complete?
YES — with the plan's own deferrals standing (tags→next milestone, spans/datasets→gated future, KEK→Trust) and three documented PARTIALs (export-filter parity, alert wiring, single-pane copy now built). Every P0 is implemented, tested, and live-verified. The acceptance round found and fixed one genuine P0 miss (internal keyed-plane accounting), which is now covered by tests.

## Decision B — is ToLLma at full Langfuse parity?
NO. Deliberately not: no span/event hierarchy or tree views, no tags/metadata dimensions, no datasets/experiments/judges, no prompt management, no per-project KEKs, single-plane traces (no cross-plane trace stitching), no sampling controls, no scheduled/wide exports. What ToLLma has is a complete, tested, isolated single-generation ledger with costs, scores, and governance — a serious gateway observability surface, not a Langfuse clone.

## Acceptance-round changes (all in-scope, all verified)
1. Internal keyed-plane ledger wiring (trace/costs/params/level/message) — same pattern as the other planes.
2. H1 plane-level test (unpriced model → NULL costs through public gateway).
3. Drop counters on GET retention (dropped_full/dropped_error/duplicates/enqueued).
4. Retention single-pane copy (last open plan item).
5. Gap-matrix corrections (dual-read never shipped; single-pane was missing).
