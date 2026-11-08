# Model-Aware Progressive Compaction — Final Behavior

## Thresholds & estimation
- AUTO 0.80 (pre-send, single attempt, then re-validate), MANUAL 0.20 via
  `POST /conversations/{id}/compact` (backend-enforced 422; 409 when a
  generation/compaction is active; idempotent repeat → 409 "already
  compacted"). Module constants (no threshold mechanism in core config).
- Window resolution: registered model → repository lookup → unknown (manual
  422 `INVALID_CONFIGURATION`; auto skips but still substitutes summaries).
  Estimator: `len//4` + 8/msg overhead + media reserves (image 1000+1/KB,
  audio 500+1/512B, video 1500+1/512B, bytes as proxy) + tool reserve;
  output reservation respected separately at request build.

## Summary node
- `Role.SUMMARY` (migration `c41d7e2a9b03`, `ADD VALUE` in autocommit;
  downgrade requires deleting/converting SUMMARY rows — documented).
- Parent = compaction-point leaf, next version; coverage = tail ids only
  (`prev_summary_id` chains history); stores trigger, model + window,
  tokens before/after in `metadata_["compaction"]`; token/cost columns NULL
  (no double-count; sidebar counts and zero-total usage groups exclude it).
- Path-specific: latest-applicable = deepest summary on the active path;
  divergent branches never inherit. Originals never deleted/rewritten.

## Context assembly (single implementation in compaction.py)
- System/developer + latest summary (as system) + uncovered tail + current
  request + tools; native media when the adapter supports it (transcript
  fallback), fail-closed on unreadable attachments. Summarizer injectable
  (`set_summarizer`; default = selected model's adapter, fit-validated,
  ContextVar recursion guard, two-phase lock: snapshot → release → summarize
  → revalidate → persist, stale → 409).

## Frontend
- `/compact` exact-match (whitespace-tolerant, no false positives), never
  sent to LLM, no user node, single-flight; progress/threshold/busy/error
  states; auto path shows "Preparing conversation context…" until first
  chunk. Summary nodes distinct (FileText, Auto/Manual badge, expandable),
  tree pass-through. Panel shows live % + ≥20% nudge.

## Sharing/exports
- Summary nodes included distinctly; `PublicShareMessage` whitelist
  unchanged (no ids/tokens/costs/metadata/attachments). Owner exports full.

## Tests (all PASS)
- Backend 1389 + 1 pre-existing laya pin; vitest 414; tsc/eslint clean;
  e2e compact 6/6 stubbed; branching-flow 7/7 seeded. 27 + 11 compaction
  tests with deterministic fakes; E2E live-LLM paths BLOCKED (no egress).

## Known limits
- Single-giant-message transcript → clear 422 (narrow-range summarization
  future work); attachment dims/duration would graduate reserves from
  bytes-proxy; summary content uses selected model (documented tradeoff).
