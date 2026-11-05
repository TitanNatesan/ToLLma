# 07 — API Surface Design (FINAL v1 companion, design-level)

Layering per backend.md: `api/orgs|teams|sets|members|keys|budgets|analytics|audit/` trios (router/schemas/service), engines in `services/`, ORM in `models/`. Every non-health/auth route: `get_current_user` + active-context + permission check. Cross-scope reads → 404.

## Endpoints (prefix `/api/v1`, context header `X-Tollma-Context: personal | org:<id>`; gateway keys resolve context server-side)

- Orgs: `POST /orgs` (create; caller becomes root) · `GET /orgs` (list mine) · `GET/PATCH /orgs/{id}` (`manage_settings`) · `POST /orgs/{id}/disable` (emptied only) · `GET /orgs/{id}/settings` · `PATCH /orgs/{id}/policy` (visibility mode, enforcement, retention; audited + notified).
- Transfers: `POST /orgs/{id}/transfer` (root + re-auth) · `POST /transfers/{tid}/accept|cancel` · break-glass: `POST /admin/orgs/{id}/recover` (platform admin, audited, accept-required).
- Members: `GET /orgs/{id}/members` · `POST /orgs/{id}/invitations` · `GET /orgs/{id}/approvals` (queue) · `POST /approvals/{aid}/approve|reject` · `PATCH /members/{mid}/suspend|resume` · `DELETE /members/{mid}` (remove) · `POST /orgs/{id}/leave` (self-leave) · `POST /members/{mid}/sets` (assign, grant ≤ own).
- Teams: CRUD `/orgs/{id}/teams` · membership + set assignment sub-routes (`manage_teams`).
- Permission sets: CRUD `/orgs/{id}/permission-sets` (+ `POST /permission-sets/{sid}/clone` for system sets) · assign/unassign routes.
- Keys: `POST /orgs/{id}/keys` (to user, budget ≤ unallocated, models ∩ scope; `create_keys`) · `DELETE /keys/{kid}` (revoke → return) · V1 key routes unchanged for personal keys.
- Budgets: `GET /orgs/{id}/budget` (cap + allocated + unallocated) · `PATCH /orgs/{id}/budget` (cap ≥ allocated enforced).
- Providers/models: org scope via `org_id` on existing V1 routes + `manage_providers` gate; personal routes unchanged and invisible cross-context.
- Chat/gateway: unchanged paths; resolver = context → keys → model-list ∩ scope → per-leg budget hard-stop; usage events written per leg with server-derived org_id.
- Analytics: `GET /orgs/{id}/analytics[/team/{tid}|/user/{uid}]` (dedup over users at org level; `view_analytics`; mode gates content endpoints).
- Audit: `GET /orgs/{id}/audit` (`view_audit`, includes mode-read rows).
- Exports: org-scope (analytics/events/audit) vs user-scope (conversations/messages/attachments) separated by route + scope check; artifact inherits source retention.

## Envelopes & errors

- V1 error envelope reused (`success:false, error:{code,message,retryable}`).
- New codes: `ORG_CONTEXT_REQUIRED`, `PERMISSION_DENIED` (note: existence-oracle cases stay 404), `BUDGET_EXHAUSTED` (hard-stop, retryable=false), `ESCALATION_BLOCKED`, `ORG_NOT_EMPTIED`, `LAST_ROOT_BLOCK`, `KEY_ORG_MISMATCH`, `INVITE_EXPIRED`, `TRANSFER_PENDING`.
