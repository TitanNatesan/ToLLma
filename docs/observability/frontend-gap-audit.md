# ToLLma Frontend Observability Gap Audit (Agent 4, Phase 1 READ-ONLY)

- **Pre-check:** `git status --short` → only untracked `docs/observability/` drafts. No source edits, no git writes.
- **Read before writing:** `AGENTS.md`, `frontend/AGENTS.md` (agent-rules block), `.opencode/rules/frontend.md`, `docs/observability/FILE_OWNERSHIP.md`, Agent 1 `langfuse-capability-inventory.md`, Agent 2 `backend-gap-audit.md`, Agent 3 `workspace-configuration-design.md`, and the Next.js App Router `dist/docs` guide `01-app/01-getting-started/06-fetching-data.md` (client-side data fetching via `fetch`/React Query, `cache: "no-store"`, Suspense boundaries for `useSearchParams` — the patterns this codebase follows).
- **Method:** code reading only. Evidence = file paths + behavior. Builds on Agents 1–3; does not duplicate their inventories.
- **Gap scale (shared with Agent 2):** P0 = correctness/data-loss or join-key breakage · P1 = missing capability with no workaround · P2 = partial/degraded path that works but loses fidelity · P3 = nice-to-have.
- **Scope note:** "frontend observability" here = what the UI can show, given backend Agent 2 gaps. Where the backend has no data (scores, tags, trace keys), the frontend gap is marked `blocked-backend` rather than re-graded.

## 0. Frontend observability surface inventory (what exists, by route)

| Route | File(s) | Observability role |
|---|---|---|
| `/prompt-logs` (tabs: `logs`, `settings`) | `frontend/src/app/prompt-logs/page.tsx`, `components/PromptLogsPanel.tsx`, `components/PromptLogsSettings.tsx`, `components/promptLogLogic.ts` | Ledger explorer (closest to Langfuse trace explorer) + capture-policy settings |
| `/settings#logging` | `frontend/src/app/settings/page.tsx`, `frontend/src/components/logging/WorkspaceLoggingSection.tsx` | Personal global-toggle summary + link to full controls |
| Org `?section=settings` → `logging` tab | `frontend/src/app/organizations/components/OrgSettingsSection.tsx` → `WorkspaceLoggingSection` | Org capture-policy summary |
| Key forms (create/edit, personal + org) | `frontend/src/app/api-keys/components/KeyLoggingField.tsx`, `KeyEditDrawer.tsx`, `OrgKeyEditDrawer.tsx` | Per-key logging override picker |
| `/analytics` (personal + org) | `frontend/src/app/analytics/page.tsx`, `components/AnalyticsTables.tsx`, `components/KpiCard.tsx`, `components/format.ts` | Cost/latency/volume/quality-less dashboards; CSV/JSON/XLSX export toolbar |
| Org `?section=analytics` (gated) | `frontend/src/app/organizations/components/OrgAnalyticsDashboard.tsx`, `MemberAnalyticsSection.tsx` | Same charts, org-scoped, perm-gated |
| API-key analytics drawer/panels | `frontend/src/app/api-keys/components/analytics/*.tsx` (19 files) | Per-key spend/volume/latency/budget |
| Guardrails trigger history | `frontend/src/app/guardrails/components/TriggerHistoryPanel.tsx` | Evaluator/guardrail observation list + inspector (closest to Langfuse observation detail) |
| Org audit log | `frontend/src/app/organizations/[id]/page.tsx` + `components/OrgAuditTable.tsx` | Config-change audit, not request observability |
| `/admin` dashboards | `frontend/src/app/admin/components/*.tsx` (Usage/Costs/Errors/Cache/…) | Platform-operator view, not workspace observability |
| Command palette + workspace search | `frontend/src/components/ui/CommandPalette.tsx`, `frontend/src/hooks/useWorkspaceSearch.ts` | `prompt_logs` result type deep-links to `/prompt-logs?requestId=` |
| Sessions (settings) | `frontend/src/app/settings/components/SessionsSection.tsx` | Auth/login sessions — NOT conversation sessions |

**Deliberately absent (verified by grep):** no trace/tree view, no generation-detail view, no session-replay view, no users view, no scores/annotation/datasets/experiments UI (`grep -rl "useScores|ScoreConfig|DatasetRun|AnnotationQueue"` → zero hits).

## 1. Trace explorer → Prompt Logs list (P1, partly blocked-backend)

**Exists.** `PromptLogsPanel.tsx` is a genuine ledger explorer, not a placeholder: URL-serialized filter bar (search `q`, `user_id`, `key_id`, `provider_id`, `model_id`, `status`, `from`/`to` — `filterFromParams`/`filterToParams`, `LOG_FILTER_KEYS`), tab state in URL (`?tab=`), cursor pagination (`X-Next-Cursor` header, `limit: 25`, "Load more"), timezone note, disabled-logging banner, perm-gated empty states (403 → denied copy), deep-link selection (`?requestId=` matches `request_id` then row `id`, drawer shareable + reload-safe), delete + purge-expired with correct "NULLs content, keeps metadata" copy. Data layer is clean: `services/promptLogs.ts` normalizes canonical/legacy wire shapes (never throws), `hooks/usePromptLogs.ts` is React Query (`useInfiniteQuery` list, `useQuery` detail/settings/retention, mutations invalidate `["prompt-logs"]`), settings mutations are explicitly never-optimistic. Test coverage present (`__tests__/`: acceptance, key-targets, hierarchy, gaps).

**Missing vs Langfuse trace explorer:**
- No trace concept to explore (Agent 2 §1): flat rows, no grouping, no tree. `blocked-backend` for hierarchy; but the UI compounds it — no conversation grouping either (internal chat has `conversation_id` on rows; the table doesn't group/filter by it).
- Columns mirror the PromptLog subset gap (Agent 2 §8–§9): `prompt+completion` tokens only, **no cost column at all**. The workspace-facing observability surface cannot answer "what did this cost" — **P1** (P0 backend, P1 frontend: column + formatter once backend ships it).
- No numeric range filters (tokens/cost/latency), no saved views, no full-text IO search (by design — bodies are Fernet ciphertext; correctly unsearchable). P2.
- Filter inputs for user/key/provider/model are free-text ID boxes, not pickers — usable only if the operator already knows UUIDs. **P1 UX**: needs autocomplete backed by existing key/provider/model list endpoints.
- No export button (matches backend P1 — no ledger export API). P1, `blocked-backend`.

## 2. Trace detail → LogDetailDrawer (P2, partly blocked-backend)

**Exists.** `LogDetailDrawer` (inside `PromptLogsPanel.tsx:70-228`): 14-field metadata grid (request ID, status, times, workspace, user/key/provider/model, endpoint, source, duration, tokens), copy-request-ID, `ViewContent`-gated bodies with expired/restricted empty states, delete with confirm. Solid permission UX (`canShowBodies`).

**Missing vs Langfuse trace/observation detail:**
- Single flat row: no child observations, no timing waterfall, no nested tree. `blocked-backend` (no `parent_observation_id`).
- No cost, no token breakdown beyond prompt/completion, no model parameters, no prompt name/version link, no finish reason, no error message (code only). Mostly `blocked-backend` (Agent 2 §3, §10); frontend work is display-only once shipped.
- No "open conversation" jump for rows with `conversation_id` (internal-plane rows could deep-link to `/c/[id]` today — analytics already does this pattern, §4). **P2, frontend-only.**
- Detail shows `usage`/`provenance` in the type (`PromptLogDetail.usage/provenance`) but never renders them. **P2, frontend-only** (render or drop from the type).

## 3. Generation detail → NONE (P1, blocked-backend)

No per-generation view exists anywhere. `Message` IS the generation (Agent 2 §3) but chat UI was not found to surface per-message usage/cost/latency, and prompt-log rows carry no `generation_id` link in the UI. Analytics aggregates by conversation/model, never down to a generation. Once the backend defines a generation read surface, this needs a dedicated view (see §9 IA); until then **P1 `blocked-backend`**. Do not bolt generation fields onto the log drawer — that repeats the flat-row mistake.

## 4. Analytics → strong, quality-blind (P2 + P0-blocked)

**Exists — the most complete surface.** Personal `/analytics` (9+ KPI cards, spend/usage/token charts with zoom, heatmap, model/provider/conversation tables, insights, CSV/JSON/XLSX export with truncation notice) + org variant via shared `OrgAnalyticsDashboard` with `Analytics.ViewUsage/ViewCost`, `Budgets.*` gates + per-key analytics (19 components: budget gauge, burn rate, cache savings, heatmap, efficiency). Server-computed, timezone-aware, good loading/error/empty states throughout.

**Missing vs Langfuse dashboards/Metrics:**
- No quality axis: no scores UI at all → cost-per-quality, judge agreement, score trends impossible. **P0 `blocked-backend`** (Agent 2 §5); frontend must not invent a quality story from cost/volume alone.
- No segmentation by environment/version/prompt-version (no such columns). `blocked-backend`, P1.
- Analytics → log drill-down is one-directional and partial: conversation drawer opens `/c/[id]`; there is no "view requests behind this bucket" jump to `/prompt-logs` with preset filters (both directions are frontend-only work once decided). **P2, frontend-only.**
- Tool-call rate card honestly shows "Not tracked / not persisted yet" — good placeholder discipline, keep the pattern.

## 5. Workspace settings → strong (P2 residual)

**Exists — best-in-class for the audit.** `PromptLogsSettings.tsx` (capture enabled/scope global-vs-keys/key allow-list with search/per-key overrides with inherit/on/off + reset/global-mandatory lock + confirm-on-broaden + retention + audit line + read-only state) + `WorkspaceLoggingSection.tsx` summary embedded in `/settings#logging` AND org settings `logging` tab AND `KeyLoggingField` in key forms. Precedence copy, mandatory-global guard, and R7 confirm (global clears targets) are all handled in UI. Personal-workspace scoping note present.

**Gaps:**
- Agent 3 R1/R8 (retention-policy writes under-gated; `RetentionSection` in settings routes through the weak check) is a backend/authz fix; the UI cannot compensate except by hiding the control it doesn't own — flag for Agent 6, not a frontend build.
- No export/scheduled-export toggle (no backend). P1 `blocked-backend`.
- `retention_days` input has no "existing rows keep old stamps" hint (Agent 2 §11: later changes don't restamp). One-line copy fix. **P3, frontend-only.**

## 6. Access control UI → present, one ambiguity (P3)

**Exists.** `resolvePromptLogPerms` + `can()` gating per surface (Read/ViewContent/Manage/Delete), read-only settings state with "need Manage" copy, 403→denied mapping, `PermissionSetPicker` + members/teams/sets tables on the org page. Matches Agent 3 §4.3 named checks.

**Gap:** single Delete control covers both single-row hard-delete and purge-expired (NULL-content). Backend intentionally shares the `Delete` code (Agent 2 §14 note); the UI faithfully mirrors it, but the two actions have different blast radii and the drawer/panel copy doesn't distinguish recovery semantics beyond the purge dialog. Confirm with Agent 6 whether the UI should separate or further warn; default: **P3**.

## 7. Filters / search / pagination → Langfuse-parity on URL state (P2 residual)

**Exists.** URL is the single source of truth for tab, all filters, and selected log (shareable, reload-safe, no history spam via `replace` + `scroll: false`), cursor pagination, `useDebouncedValue` available. This already matches Langfuse's "query bar ≡ sidebar ≡ URL" principle structurally — only the query *language* (single bar, operators, saved views) is missing. Command-palette `requestId` deep link is a genuine cross-surface join.

**Missing:** single-query-bar with operators (`level:`, `cost:>`, wildcards), saved views, facet counts. Given backend filter limits (fixed enums + 2 LIKE fields), a full query bar today would be theater — **P2**, build only after backend range/tag/metadata filters land. The ID-text-box → picker upgrade (§1) comes first.

## 8. Services / hooks / store / logging components → clean, one layering inversion

**Exists.** `services/promptLogs.ts` (typed client + total normalizers + cursor-via-header handling), `hooks/usePromptLogs.ts` (query-key factory, no optimistic policy writes), `hooks/useAnalytics.ts`, `hooks/useGuardrails.ts`, zustand `store/` (auth/org/chat/settings — no prompt-logs slice, correctly: server state lives in React Query). `components/ui/` exports 25+ primitives (DataTable, DetailPanel, PageContainer/PageHeader, StatGrid, Empty/Loading/Error, RangePicker, SearchInput…) — the design-token base the IA reuses. `components/logging/WorkspaceLoggingSection.tsx` is properly shared.

**Layering issue (frontend.md).** `promptLogLogic.ts` lives under `app/prompt-logs/components/` (page-specific per frontend.md) but is imported by **three** outside consumers: `components/logging/WorkspaceLoggingSection.tsx`, `app/api-keys/components/KeyLoggingField.tsx`, and transitively org settings. Page-specific modules must not be imported upward per frontend.md ("must not be moved into global components" — inverse: globals must not depend on page modules). **P2:** move `promptLogLogic.ts` (pure helpers, no JSX) to `lib/` or `components/logging/` in Phase 2. Tests move with it. No behavior change.

## 9. Proposed information architecture (Phase 2, respects frontend.md + ui/* + tokens)

Routes (new pages own their components in `app/<route>/components/`; only cross-route reuse lands in `src/components/`):

```text
/app/prompt-logs                  KEEP — flat ledger explorer = "Traces" list surrogate
  ?tab=logs                       table as today + cost column (backend-gated) + ID pickers
  ?tab=sessions  NEW (blocked-backend: needs sessionId) — conversation/session replay
  ?tab=settings                    KEEP as today
/app/prompt-logs/[id]  NEW (optional) — full-page generation/trace detail when rows
  gain children; until then the drawer stays (no split view for a flat row)
/app/analytics                      KEEP — add quality section (blocked-backend: scores API)
/app/settings#logging  + org settings logging tab  KEEP — add export toggle (blocked-backend)
```

Settings groups (no new tables per Agent 3 §4.4; UI groups map to S1–S8): **Capture** (enabled/scope/keys/flags) → **Content & retention** (retention TTL + restamp warning + purge) → **Export** (future toggle) → **Audit** (existing `updated_by/version` line). Reuse `SettingsSection/SettingItem/Switch/Checkbox/Select/Badge/ConfirmDialog` — no new primitives.

Display rules honoring backend truth: estimated-usage badge wherever tokens render (backend P0 adds the flag); `$0 unpriced` shown as "unpriced", never "$0.00"; errors show code + message + level filter chips (no severity invented client-side); metadata-only rows keep the "Metadata only" badge pattern from `FieldsCell`.

## 10. Prioritized frontend gap list

| # | Gap | Area | Severity | Depends on |
|---|---|---|---|---|
| F1 | No cost column/answer in prompt-logs list+detail | trace explorer/detail | P1 | backend cost on PromptLog (Agent 2 §9) |
| F2 | Free-text UUID filter boxes (user/key/provider/model) | explorer UX | P1 | none — use existing list endpoints for autocomplete |
| F3 | `promptLogLogic.ts` imported upward by shared/key/org surfaces | layering (frontend.md) | P2 | none — move to `lib/` or `components/logging/` |
| F4 | No analytics → prompt-logs drill-down (bucket → filtered requests) | analytics | P2 | none (filter params already URL-serializable) |
| F5 | No conversation jump from log rows with `conversation_id` | trace detail | P2 | none |
| F6 | `usage`/`provenance` typed on detail, never rendered | trace detail | P2 | none (render or drop) |
| F7 | Trigger inspector shows no request/generation link to prompt log | guardrail detail | P2 | none (backend stores `request_id` per Agent 2 §4) |
| F8 | No single query bar / saved views / facet counts | search | P2 | backend range/tag/metadata filters |
| F9 | No ledger export UI (CSV/JSONL) | export | P1 | backend ledger export (Agent 2 §12) |
| F10 | Retention restamp expectation mismatch (no copy) | settings | P3 | none — one-line copy |
| F11 | Delete vs purge blast-radius copy not distinguished in drawer | access control | P3 | confirm with Agent 6 |
| — | Scores/quality UI, session replay, generation detail, trace tree, tags/metadata filters, env/version segmentation | all | blocked-backend | Agents 2+5 data model + APIs |

## Completion contract

- [x] `git status --short` pre-check (read-only; only `docs/observability/` untracked).
- [x] Read `AGENTS.md`, `frontend/AGENTS.md`, `.opencode/rules/frontend.md`, `FILE_OWNERSHIP.md`, Next.js `dist/docs` fetching-data guide, Agent 1 inventory, Agent 2 backend audit, Agent 3 workspace design — built on, not duplicated.
- [x] Audited: `/prompt-logs` page+panel+settings+logic+tests, `/settings` (+logging card), org page (settings/audit/analytics/members sections), `/analytics` + org dashboard + key analytics, guardrail trigger history, `services/promptLogs.ts`, `hooks/usePromptLogs.ts`, `store/`, `components/ui/*`, `components/logging/`, command palette + workspace search, key forms.
- [x] Wrote ONLY `docs/observability/frontend-gap-audit.md`. No `frontend/**` or other source edits. No git writes.
- [x] Verification: N/A (doc-only; no code changed — `vitest`/`tsc` unaffected by a markdown addition).
- **Handoff:** Orchestrator Phase 2 folds §9 IA into `implementation-plan.md`; F1/F9 need Agent 5 columns first; F3 is a pure frontend move; R1/R8 + F11 need Agent 6 confirmation.
