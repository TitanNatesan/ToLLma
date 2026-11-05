# Guardrails: Global + API-Key Scope Refactor — Final Report

Date: 2026-10-27
Branch: org (uncommitted implementation + prior contrast-toast work in tree)

## 1. Initial inventory (Subagents A/D/C-audit)

- Global truth: `guardrail_policies` (`org_id` NULL=personal / non-NULL=org, `is_enabled`, `is_mandatory` org-only) + `guardrail_assignments` with `scope_type global` or zero live assignments (= workspace-global). No org-wide settings table, no platform flag (`core/config.py` only holds Laya URL).
- Key truth: policy-side link `guardrail_assignments.scope=key + api_key_id` (ON DELETE CASCADE). `api_keys` carries no guardrail columns; `ApiKeyPolicy` is budgets/rate-limits only. Key create → `attachKeyToGuardrails` fetch-merge-write per policy; never touches secret.
- No LiteLLM sync exists (`litellm` zero hits in `backend/src`); nothing to migrate.
- Resolver: `services/guardrails/resolution.py::resolve_applicable` (SQL enabled/live/non-template + workspace predicate, Python `_applies` defense-in-depth). Enforcement: `services/guardrails/enforcement.py::check_pre/record_post` (+ `_sync` bridges, fail-closed on `failure_action==block`). Internal: `api/gateway/service.py::_enforce_chat_key` (no `org_id` → ACTIVE-org fallback). External: `api/public_gateway/service.py::_guardrail_pre` (`ctx.org_id` pinned). No Valkey guardrail cache — every request re-resolves from PG; `KeyContext`/model-resolution caches hold no guardrail state.
- Team-specific guardrails: **none found**. Zero `team_id` on any guardrail table/assignment/trigger/rule/evaluator, zero `team` refs in `api/guardrails/*`, `services/guardrails/*`, `GuardrailScopeType=global|provider|key` only, zero team params in `GET /effective`, zero team guardrail UI controls. Only co-mentions are search/nav labels (`search/groups.py:1`, `search/service.py:57`, `CommandPalette.tsx:148`, `SidebarOrgNav.tsx:26`) — not behavior. Prompt-logging team targets (`PromptLog.team_ids`) are a separate feature, left untouched.
- Provider scope (`provider` + model-riding-provider rows) is existing model-targeting refinement, retained intentionally — not team inheritance.

## 2. Root causes (gaps vs Rules A/B, not team leakage)

1. No single explicit global-wins helper — logic was implicit in `_applies global→True` + `isPolicyLocked`. Direct-API edge paths (create mandatory key-only, enable key-only mandatory, PATCH enable without assignments) could yield mandatory-but-non-global rows.
2. `isPolicyLocked` ignored `is_enabled` — disabled org-global still rendered locked.
3. `attach/detachKeyToGuardrails` swallowed 404/403 (`.catch(()=>null)` + silent return) → false success toast.
4. `useEffectiveGuardrails` cached 30s while list used 0 → stale lock UI.
5. Lock copy did not contain required sentence; create-flow note always rendered; inherited heading said “global / provider” while key context never passes provider/model.

## 3. Files changed and why

Backend (`backend/**` only):
- `src/tollms/services/guardrails/resolution.py` — added `workspace_global_enforced(db, user_id, org_id)` (enabled/live/non-template + zero-live OR any global; personal vs ACTIVE-org; logs + False on DB error) and pure `resolve_key_guardrail_state(global_enabled, key_assigned)->(effective, locked)` (`effective = global or key`, `locked = global`). Single shared truth; no parallel pipeline.
- `src/tollms/api/guardrails/service.py` — `_MANDATORY_GLOBAL_MSG` + `_assignment_scope/_has_global` helpers; `create_policy`/`update_policy` (effective-state incl. live rows when `assignments` omitted; `[]`=workspace-global allowed)/`set_enabled(True)` reject mandatory+enabled with non-empty zero-global assignments (422 `ValidationError`, existing convention). `effective()` prod-wires both helpers via debug logs (return contract unchanged).
- `tests/test_guardrails_global_key_scope.py` (new, 13 tests) — global-wins, key-independence, pure-function params, workspace helper personal/org, mandatory 422 ×5 paths, non-mandatory detach allowed, no-team-attr + cross-org isolation.

Frontend (`frontend/**` only):
- `app/guardrails/components/KeyGuardrailsSection.tsx` — `hasLocked` + lock note in both modes containing exactly “Key guardrails are required while global guardrails are enabled.” (`data-testid=key-guardrail-lock-note`, `aria-live=polite role=status`); create-flow note gated on `hasLocked`.
- `components/GuardrailPicker.tsx` — inherited heading → “Inherited (global)” (key context never sends provider/model).
- `app/guardrails/components/policyLogic.ts` — `isPolicyLocked` returns False when `!is_enabled`.
- `services/guardrails.ts` — attach/detach fail-loud (removed catch-silent).
- `hooks/useGuardrails.ts` — `useEffectiveGuardrails` `staleTime:0 + refetchOnWindowFocus:true`.
- `app/guardrails/__tests__/guardrails.test.ts` — +2 cases (org-global locked/effective + no-op toggles; disabled never locked).

## 4. Final resolution logic

```python
# resolution.py
global_enabled = workspace_global_enforced(db, user_id=user_id, org_id=org_id)
#  True iff enabled/live/non-template policy in workspace has
#  zero live assignments OR any live scope==global assignment.
effective, locked = resolve_key_guardrail_state(
    global_enabled=global_enabled, key_assigned=key_has_assignment)
#  effective = True if global_enabled else key_assigned
#  locked = global_enabled
```

Enforcement (`check_pre/record_post → resolve_applicable`) already implements “global applies always, key applies on match”; new guards ensure no mandatory row can persist in enabled-but-non-global state via create/update/enable, direct API included. Detaching a key from a non-mandatory global policy is allowed (global still enforces). Frontend `isPolicyLocked = is_enabled and (is_mandatory or (org and any global))` mirrors it; `toggleAssignment` no-ops on locked.

## 5. Team-specific code removed

None to remove — verified absent. No team columns/tables/routes/params/jobs/caches/fixtures touched. `teams/team_memberships/team_permission_sets` and `prompt_logging_team_targets` kept (RBAC + separate logging feature). No migration created (schema unchanged); historical migrations left intact.

Provider scope retained as documented targeting refinement (`SCOPES={global,provider,key}`, `_applies` provider branch, wizard provider/model pickers). Not a third authority: effective decision for key requests is still global-wins, key-otherwise; provider rows only narrow provider/model matches.

## 6. Persistence and migration handling

- Inspected: `models/guardrail.py` (5 tables), `api_key.py`, `organization.py`, `g1h2i3j4k5l6`, `h2i3j4k5l6m7`, `i3j4k5l6m7n8`, `f6a7b8c9d1e2`, Valkey `guardrail:*` (per-policy only), seed templates, `ApiKey.metadata_`. No team guardrail state in DB/JSONB/LiteLLM/cache/seed.
- Strategy: no forward migration (nothing to drop/backfill). Fresh installs + upgrades coherent; `alembic check` clean. Optional future hardening only: DB `CHECK (scope_type IN ('global','provider','key'))` — not added (app-side validation suffices).

## 7. Security and authorization

- 404-oracle `_get_policy`, `_scope Guardrails.*` + `Keys.Assign` on key-scoped create/update preserved; cross-org isolation tested (org A global invisible to org B).
- Mandatory-disable/delete still 422; new global-coverage 422 uses same `ValidationError` path (no silent success; attach/detach now propagate).
- Fail-closed preserved (`failure_action==block` bridge timeout → 403 + trigger row). No secrets in errors (category-only 403, redacted reasons).

## 8. Validation commands and actual results

- `docker compose exec -T backend pytest tests/test_guardrails_global_key_scope.py tests/test_guardrails_policies.py tests/test_guardrails_engines.py tests/test_guardrails_notify_repeat.py tests/test_guardrails_llm_model_ref.py tests/test_workspace_overhaul.py -q` → **64 passed** (71s).
- Adjacent: `test_caching_external_plan + test_org_member_analytics + test_prompt_logging_hooks` → 43 passed (earlier sweep; total 87 with in-scope).
- `frontend: npx tsc --noEmit` → clean; `npx vitest run src/app/guardrails src/lib/__tests__/notify.test.ts` → **2 files, 26 passed** (guardrails 18 incl. 2 new).
- `python -c "from tollms.main import app; app.openapi()"` → 202 paths, no duplicates.
- `alembic check` → “No new upgrade operations detected.”
- Team grep (`team.*guardrail|guardrail.*team`, `team_id.*guardrail`, `TeamGuardrail`, `team_scope`) in `backend/src` + `frontend/src` → only 4 nav/search co-mentions (listed §1); zero behavior.
- E2E (Playwright) intentionally not run — host memory pressure + dev-overlay click interception (documented limitation); no product change for dev-only flakes.

## 9. Remaining limitations

- `ruff` not installed in image — lint not run (code follows file conventions).
- Full backend suite not run (in-scope + adjacent only); full e2e not run (above).
- `set_enabled(True)` on non-mandatory key-only is allowed by design (Rule B independence).
- Optional DB CHECK constraint not added (see §6).

## 10. Acceptance checklist → evidence

Global enabled:
- [x] Every key effective enabled → `resolve_applicable` global→True + `resolve_key_guardrail_state` + test global-wins (`test_guardrails_global_key_scope.py`).
- [x] Key toggles cannot disable mandatory global → UI disabled+checked (`GuardrailPicker` locked) + backend 422 on create/update/enable (`service.py`, 5 mandatory tests).
- [x] Frontend shows enabled+locked → lock note exact sentence (`KeyGuardrailsSection`, `key-guardrail-lock-note`, vitest).
- [x] Direct API cannot bypass → 422 paths tested; attach/detach fail-loud.
- [x] Existing/new/rotated/synced keys same policy → no per-key stored state; resolution live per request; key create attach flow unchanged; no LiteLLM to sync.
- [x] Cache cannot persistently override → no guardrail cache; `useEffectiveGuardrails` 0s; backend live PG.

Global disabled:
- [x] Key enable/disable independent → key-scoped `_applies`, `effective = key_assigned` when no global (tests: key independence, per-key, no cross-key bleed).
- [x] Authorized user can change → `Guardrails.Update + Keys.Assign` gates preserved.
- [x] One key ≠ others → test different-key unaffected.
- [x] UI+backend agree → `isPolicyLocked` respects `is_enabled`; effective query drives inherited.
- [x] Persist + affect path → assignments PATCH persisted; enforcement reads same rows.

No team:
- [x] No team controls in UI → grep zero; wizard scope step global/provider/key only.
- [x] No backend team resolution → `resolution.py`/`service.py` zero team lookups; tests assert no `team_id` attr + cross-org isolation.
- [x] Membership/budget/model changes don’t alter guardrails → no team hooks exist; key context 30s holds budgets only.
- [x] No hidden fallback → full-text sweep clean.
- [x] Obsolete APIs/schema removed or deprecated → none existed; no dangling imports.
- [x] Legacy state handled → none existed; no migration needed (documented).
- [x] Dead code removed without breaking teams → no deletions needed; teams/logging intact.

Architecture/quality:
- [x] Only global+key (+ retained provider targeting, documented §5) → `SCOPES`, `_SCOPE_TYPES`, wizard, `GET /effective`.
- [x] Canonical key + LiteLLM rules respected → no new registry, no direct writes, no parallel pipeline.
- [x] Auth + org isolation preserved → perm gates + 404 oracle + tests.
- [x] No duplicate source of truth → single resolver + debug-wired helpers; UI derives from same `assignments[]`.
- [x] Docs updated → this report (no guardrail docs existed to patch).
- [x] Final review reports actual results → reviewer Blockers fixed (create/enable/update guards, helper wiring, `is_enabled` lock, fail-loud attach, staleTime, aria-live); validation above.
