# 08 — Implementation Phase Plan (FINAL v1 companion)

No code, no migrations, no app changes in this phase — artifacts only (this directory). When the owner commissions build, execute phases in order; each phase ends with tests green + `alembic check` green + memory append. V1 behavior must stay green throughout (single-user = personal context with zero org rows).

## Phase A — Governance foundation (schema + memberships + sets)

Tables: organizations, memberships, teams, team_memberships, permission_sets (+permissions/assignments), invitations, root_transfers, audit_logs. Active-context middleware + switcher contract. Escalation invariant enforced in service layer with tests. Deliverables: CRUD per 07 (orgs/members/teams/sets/invites/transfers), queue + expiry job, break-glass route. QA: permission-matrix negative tests, last-root block, 404-oracle tests.

## Phase B — Metering (keys, pools, ledger)

Columns: api_keys.org_id/assignee, providers.org_id, request_logs.org_id. Tables: usage_events (+server-derived org_id), usage_adjustments. Pool accounting (allocated/unallocated, cap ≥ allocated, immediate return, per-leg hard-stop, no reservation). Gateway per-leg attribution + mixed-conversation continue-on-personal-leg. QA: exhaustion races, removal revocation, adjustment immutability, attribution anti-forgery.

## Phase C — Visibility & content governance

visibility_mode + enforcement toggles (audited + notified), mode-read audit logging, author-only edit enforcement, author-controlled shares (revocation passing to root), export scoping (org vs user artifacts + inherited retention), purge/retention jobs (usage, audit, exports). QA: metadata_only leak tests (no prompts/responses/attachments in any org response), fingerprint disclosure doc check, platform-admin content-never tests.

## Phase D — Analytics, UX, hardening

Org/team/user analytics (dedup over users), team member-aggregation, pool visibility, scheduled expiry/retention jobs wired into scheduler docs, frontend (switcher, grouped picker with source/key/budget badges, masked provider UI), E2E across contexts. QA: full matrix regression, cross-context 404 sweep, Lighthouse/a11y on new UI.

## Billing/enterprise deferrals (explicitly out)

Invoicing, plans, subscriptions, cost-center labels (billing); SSO/SCIM, SIEM streaming, dual-control break-glass (enterprise). Schema reservations already in place (org billable unit, pools, configurable retention).

## Definition of done (per phase)

pytest green · `alembic check` single-head green · tsc/eslint/vitest green (D+) · Playwright contexts suite (D+) · memory appended · spec deviation log (any deviation returns here for owner sign-off, never silent).
