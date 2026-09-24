# Platform Admin Security & Privacy Report

Date: 2026-09-24. Scope: the platform administration system
(`/api/admin/*`, `/admin`, `services/admin/*`, role plumbing).

## 1. Access control

| Check | Result |
| --- | --- |
| Anonymous request to all 11 admin endpoints | **401** (authentication required) |
| Regular authenticated account | **403** `platform administrator access required` on all 11 endpoints |
| Platform admin (`platform_role = PLATFORM_ADMIN`) | **200** on all 11 endpoints |
| `/auth/me` exposes `platform_role` | yes (frontend gates the nav; server remains authoritative) |
| Admin nav entry for regular users | absent (`sidebar-admin-nav` not rendered) |
| Admin page for regular users | renders the forbidden state (defense in depth; API still returns 403) |

Enforcement lives in `core/security.py::platform_admin_required`, which wraps
`get_current_user` (JWT + live Valkey session + active PostgreSQL user) and
then checks the platform-level role. Organization/RBAC roles are explicitly
out of scope for this gate so future org roles cannot widen it.

Promotion/demotion is an explicit operator action:
`docker compose exec -T backend python scripts/promote_admin.py <email> [--revoke]`.

## 2. Data exposure audit

Admin services select **aggregate expressions only** (counts, sums, averages,
percentiles, grouped dimension ids). Verified statically and at runtime:

- `tests/admin/test_admin_privacy.py` scans all 15 files under
  `services/admin/` and `api/admin/` for banned accesses:
  `Message.content`, `conversation.title`, `storage_path`, `extracted_text`,
  `decrypt`, `credentials`, `api_key`, `password_hash` — **none present**.
- Runtime marker test: message content, conversation title and provider
  credential strings are seeded, then every admin endpoint is called as a
  platform admin; the raw JSON never contains them.
- Recursive key scan: no response contains content-shaped keys (`content`,
  `prompt`, `response`, `messages`, `attachments`, `credentials`).

What admins can see: request/token/cost counts and trends, cache savings,
media counts and byte sizes, error codes/statuses, latency percentiles,
provider/model names, and account emails with aggregated spend. What they can
never see: prompts, responses, message or conversation text, attachment bytes,
generated media files, provider credentials, API keys, password hashes.

## 3. Endpoint protection details

- All admin routes are registered under `/api/admin` and depend on
  `platform_admin_required`; there is no unauthenticated admin surface.
- Aggregations run with the request's own DB session — no privileged
  connection, no cross-tenant bypass of the existing ownership model.
- Admin responses are validated by frozen Pydantic `response_model`s, so an
  engine cannot accidentally widen the payload shape.
- Rollups write only aggregate rows (`usage_daily_aggregates`) with no content
  or credential columns.
- Health checks expose status names and latency only; failures report the
  exception **class name** (e.g. `OperationalError`), never connection
  strings or secrets.

## 4. Abuse / reliability considerations

- Health cache probes are non-fatal (`degraded`, never `down`) and bounded by
  the cache manager's failure tolerance.
- Admin queries are read-only, indexed, and single-pass per metric (no N+1),
  so the surface cannot be used for expensive scans beyond the selected range.
- Range presets are bounded to the existing analytics vocabulary; custom
  ranges are validated through the shared resolver.

## 5. Findings & recommendations

1. **Fixed during implementation:** `platform_admin_required` was initially
   defined above `get_current_user`, which raised `NameError` at import time.
   It now lives after the dependency it wraps (verified by the access suite).
2. **Pre-existing, out of scope:** `services/cache/manager.py::_bridge()` holds
   a lock across its polling loop, making the first sync cache call in a
   process slow (~1 s). The health probe mitigates it; the one-line manager fix
   is recommended as follow-up.
3. **Recommended follow-up:** add an `admin_audit_log` table (admin id,
   endpoint, window, timestamp) when audit requirements land — the architecture
   document reserves the slot.
4. **Recommended follow-up:** rotate `LIVE_*` demo credentials used by headed
   validation specs; they are environment-provided, never committed.

## 6. Verdict

No sensitive data exposure found. Role enforcement is server-side and covered
by tests; privacy invariants are enforced by static scan and runtime marker
tests. **PASS.**
