# Platform Administration Architecture

Status: implemented 2026-09-24. Scope: platform-wide analytics, monitoring and
cost intelligence for ToLLma operators — **aggregated data only**, never
conversation content.

## 1. Existing architecture review

```text
api/*/router.py        FastAPI endpoints (no business logic, no DB)
api/*/service.py       feature services (CRUD, orchestration, validation)
services/*             reusable engines (gateway adapters, costing, model repo)
models/* + db/*        ORM entities and session
core/*                 config, crypto, security, deps, exceptions
```

Relevant existing data already carries everything analytics needs:

| Source | Holds | Used for |
| --- | --- | --- |
| `messages` | per-assistant tokens (prompt/completion/cache read+write/reasoning), input/output/cache/reasoning costs, total cost, latency, status, error_code, provider/model/user/conversation ids, `metadata` JSONB (`generation_type`, `quality`, `seconds`, `cost_source`) | usage, tokens, costs, media, cache, errors, per-user/model/provider breakdowns |
| `request_logs` | status, error_code, latency, streaming/regeneration flags, completed_at | error ledger and health rates |
| `generation_runs` / `message_versions` | regeneration history | future retry/regeneration analytics |
| `attachments` | kind, mime, file_size, created_at (bytes on disk) | media inventory (bytes), never content |
| `conversations`, `providers`, `models`, `users` | names, provider types, prices, emails, `platform_role` | dimension joins and the admin gate |
| `model_repository` | canonical model metadata, capabilities, media rate card, cache support | pricing context and capability truth |
| `services/gateway/costing.py`, `services/cost_estimator.py` | token costing engine + official OpenAI rate card | cache savings and cost fallbacks |
| `services/gateway/caching.py` | provider-aware prompt-cache plans | cache capability context |

There are no `usage_records`, `requests`, `provider_requests` or
`generation_jobs` tables; the real ledger is `messages` + `request_logs`. The
admin layer maps onto the real schema instead of introducing parallel tables.

## 2. Admin analytics architecture

```text
GET /api/admin/*                 router.py — query parsing, platform_admin_required
        │
        ▼
services/admin/*                 analytics engines (no api/ imports)
 ├── usage.py        totals, series, per-model/provider breakdowns
 ├── tokens.py       prompt/completion/cache/reasoning composition
 ├── costs.py        spend, projection, savings, top spenders
 ├── cache.py        cached tokens, hit rate, net savings (capability-aware)
 ├── media.py        image/video counts, bytes, media cost
 ├── errors.py       failed/cancelled ledger + rates (deduped across tables)
 ├── models.py       per-model ranking (requests/tokens/cost/latency/errors)
 ├── providers.py    per-provider ranking
 ├── users.py        per-user aggregates (email + counts/costs only)
 ├── health.py       DB/cache/generation-queue probes + latency percentiles
 ├── rollup.py       idempotent daily aggregates (usage_daily_aggregates)
 └── dashboard.py    composition of the engines into one overview payload
        │
        ▼
models + db                      existing tables + usage_daily_aggregates
```

### Data flow

```text
generation finishes ──► messages row (tokens/costs/metadata) + request_logs row
                                   │
admin request ──► window resolved (preset/timezone → UTC instants + prev period)
                                   │
              engines run one grouped aggregation per result set
                                   │
              FastAPI response_model validates the frozen schemas
                                   │
              Next.js /admin dashboard renders KPIs + Recharts charts
```

### Range resolution

Presets (`today`, `yesterday`, `last_7d`, `last_30d`, `last_90d`, `this_month`,
`last_month`, `custom`) reuse the existing analytics `resolve_range` (IANA
timezone aware, equal-length preceding window for comparisons) and are passed
into the engines as a plain `AdminWindow` dataclass — services never import
from `api/`.

## 3. Aggregation strategy

- **Live aggregation is authoritative.** Admin endpoints aggregate directly
  from `messages`/`request_logs` with the new composite indexes
  (`ix_messages_created_status`, `ix_messages_provider_created`,
  `ix_messages_model_created`, `ix_request_logs_completed_status`,
  `ix_request_logs_error_code`, `ix_attachments_kind_created`), so numbers
  always match the per-user analytics page.
- **`usage_daily_aggregates` is the long-range accelerator** for
  enterprise-scale ranges and future billing: one row per
  `(day, user, provider, model)`, written idempotently by
  `services/admin/rollup.py` (delete-and-upsert per day, `ON CONFLICT` on
  `uq_usage_daily_scope`). Rollup days are UTC.
- **Why not a materialized view:** a matview cannot carry a per-scope unique
  constraint, cannot be updated incrementally without full refreshes, and is
  harder to test idempotently. The rollup table gives the same read
  performance with explicit, testable ownership and no refresh storms.
- **Query budget:** one grouped query per result set; dimension names are
  resolved with a single `IN` lookup per endpoint (no N+1). Measured on the
  dev dataset: dashboard **268 ms**, other endpoints 24–149 ms, health 36 ms
  warm (target: dashboard < 2 s, API < 300 ms).

## 4. Privacy boundary (hard rule)

Platform admins may read: counts, tokens, costs, latencies, statuses, model
and provider names, user emails, media counts/bytes.

Platform admins may never read: message content, prompts, responses,
conversation titles, attachment bytes/`storage_path`/`extracted_text`, provider
credentials or API keys. The boundary is enforced by:

1. `services/admin/*` selecting only aggregate expressions (static scan in
   `tests/admin/test_admin_privacy.py` bans the risky attribute names).
2. Response schemas containing no content-shaped fields.
3. Runtime tests seeding marker strings and asserting they never appear in any
   admin response.

## 5. Future expansion (no schema rewrites)

| Future capability | How it lands |
| --- | --- |
| **Organizations / teams** | Add `organizations` + `memberships(org_id, user_id, role)`; `usage_daily_aggregates` and the engines already group by `user_id`, so org rollups are a join/group-by change. |
| **RBAC** | `platform_role` stays the platform gate; org/team roles live on memberships and never widen `platform_admin_required`. Add a `permissions` table keyed by role when needed. |
| **Subscriptions / billing** | The daily aggregate table is the billing source of truth (per user/provider/model per day); add plan/price columns to a new `subscriptions` table keyed by user/org. |
| **Enterprise analytics** | Roll up from `usage_daily_aggregates` instead of raw messages for long ranges; the engines keep the same signatures. |
| **Audit logs** | Add an `admin_audit_log` table (admin_id, endpoint, window, at) written by a router dependency; no changes to analytics engines. |
| **More providers / modalities** | Capability-driven: `model_repository` flags + `services/gateway/caching.py` + `services/cost_estimator.py` already drive behavior from metadata, not names. |

## 6. Frontend

`/admin` (Next.js App Router) renders eleven sections (Overview, Usage, Costs,
Tokens, Providers, Models, Users, Media, Cache, Errors, Health) with Recharts
(area/bar/donut/stacked) and a shared range picker; every query is keyed by the
range and cached by react-query. The sidebar entry and the page itself gate on
`user.platform_role === "platform_admin"`, and any 403 renders a clean
"Platform administrator access required" state.
