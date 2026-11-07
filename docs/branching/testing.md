# Branching Conversations — Test Report

## Backend (isolated TOLLMS_TEST_DB, serial)
- New `test_conversation_tree.py` (5): leaf chaining, root sequencing,
  siblings/children ordering, select + stale-404, HTTP tree/path/select/
  siblings/children. PASS.
- New `test_conversation_tree_versions.py` (9): select restores correct
  descendant path; new message attaches to active leaf; cross-conversation
  parent 404; intruder 404 on tree/path/select/siblings/children; failed
  sibling persists + retry creates another; concurrent duplicates adopt/409
  without corruption; delete-leaf retargets to parent; branch-tip delete
  falls back to newest; select-of-deleted 404 with leaf unchanged. PASS (9/9).
- New `test_concurrent_branch_regeneration.py` (3): same-parent threaded race
  (distinct ids, gapless versions, valid parents, consistent leaf, zero
  orphans); same-`client_key` adopts without duplicate; start-while-RUNNING
  raises documented `ConflictError`. PASS (3/3).
- New `test_streaming_regeneration_tree.py` (3, in-process fake adapters):
  multi-chunk stream into new sibling (original byte-identical, leaf moves);
  FAILED sibling retained + retry adds v3 (fresh-session re-read confirms);
  cancel preserves CANCELLED partial + sweep marks stale FAILED. PASS (3/3).
- New `e2e/branching-flow.spec.ts` (7/7 PASS, chromium, 32s): deterministic
  7-node fixture (2 roots, response versions, edited-request branch, FAILED
  version) seeded additively then cleaned up (DELETE → 204). Graph renders
  all nodes; request/response clicks switch main chat with correct
  descendants; reload + conversation-switch restore branch; screenshots
  captured (desktop + 390px). Live send-new-message BLOCKED (provider
  registration refuses non-public egress URL in sandbox); composer routing
  covered by B8 service test instead.
- Touched suites re-run: 80 passed; `test_message_history` 7 passed.
- Full suite: **1331 passed, 1 failed** — `test_laya_health_proxy_and_evaluate`
  (`laya-td-1.0.0` vs pinned `laya-rules-1.0.0`), PRE-EXISTING version-pin
  drift, unrelated, untouched. (3 delete-retarget tests added after the full
  run; their file passes 9/9 standalone.)
- Touched suites (`message_history` rewritten to sibling semantics,
  `chat_keys`, `generations`, `gateway`, `data_integrity`, guardrails head
  pin): 107 + 70 passed across runs.
- Full suite: **1325 passed, 1 failed** — `test_laya_health_proxy_and_evaluate`
  (`laya-td-1.0.0` vs pinned `laya-rules-1.0.0`), PRE-EXISTING version-pin
  drift, unrelated, untouched.

## Frontend
- New `conversationFlowLayout.test.ts` (7: layout/sibling/cycle/fallback),
  `conversationFlowStatus.test.ts` (5: active highlight, failed distinction),
  `requestVersionPager.test.ts` (3: position contract). Existing
  `messageViewPager.test.ts` still passes (testids preserved).
- Full vitest: **43 files / 359 passed**, 0 failures.
- `tsc --noEmit` + `eslint` clean (all waves). OpenAPI: 305 routes, zero
  duplicate operationIds.

## E2E / visual — PARTIAL (environmental BLOCKED items)
- `conversation-intelligence` regen-pager + `history` specs: BLOCKED in setup
  (`apiCreateProvider` → `refused egress to non-public address (local)`)
  before any UI renders; identical on untouched specs → pre-existing sandbox
  limitation, not a regression. Cases affected: live regenerate/edit-branch
  navigation, populated-graph click-to-switch, refresh-restore.
- Verified live: NEW `sidebar-header.spec.ts` 2/2 PASS; `theme-studio` 9/9
  PASS; flow-section evidence screenshots captured (`/tmp/shot-flow-desktop.png`,
  `/tmp/shot-flow-mobile.png`): section renders between Current Conversation
  and Limits with correct empty state at desktop + 390px widths.
- Zoom-scrollability + reduced-motion + heading semantics covered by
  (temporary, removed) DOM-math checks 3/3 + persisted status-contract tests.

## Known limitations
- Live multi-generation/branch-switch e2e + the 10 requested evidence
  screenshots of populated trees require mock-LLM egress; rerun
  `conversation-intelligence.spec.ts` once the sandbox allows it.
- `_resolve_image_reference` follow-up noted by backend agent (out of scope).
