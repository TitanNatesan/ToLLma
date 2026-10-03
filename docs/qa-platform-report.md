# ToLLma Full Platform QA Report — Organization, Users, Permissions & Admin (chat excluded)

**Final Result: PASS**

## Environment

- Browser: Chromium headless-shell 1243 (Playwright 1.63; headed mode unavailable — no X server on host; fullscreen 1920×1080 viewport, same rendering path)
- Frontend: http://localhost:3000 (compose dev server) · Backend: http://localhost:8000 · ENVIRONMENT=local
- Test timestamp: 2026-10-02/03 UTC. Suites: `frontend/e2e/platform-qa.spec.ts` (11 tests, 10 isolated personas), `backend/tests/test_organizations.py` (18 tests).

## Users

All `@test.tollma.ai` (platform rejects reserved `.local`; documented deviation):
root, second-root, org-admin, limited-member, existing-user, existing-reject,
new-user, new-user-reject, request, request-reject, resend-target, qa-admin (+titannatesan@gmail.com pre-existing, promoted via documented `scripts/promote_admin.py`).

## Organizations

- ToLLma QA Organization (fresh per run, unique slug; root@test.tollma.ai)
- ToLLma Isolation Organization (fresh per run; second-root@test.tollma.ai)

## Permission Sets (all created via UI builder, verified via API)

Member Manager (Members.Read/Invite/Approve), Provider Manager (Providers.Read/Create/Update/Validate/RefreshModels),
Analytics Viewer, Audit Viewer, Restricted Member (Organization.Read, Members.Read, Analytics.ViewUsage),
Set Builder, Greeter Set + system Owner/Approver/Member. 52-code granular catalog (9 groups).

## Test Matrix (all PASS, UI + API where marked)

| Test | User(s) | Expected | Actual | Result |
|---|---|---|---|---|
| accounts signup/login/logout/personal | root | personal intact, no auto-org | as expected | PASS |
| org creation x2 + switcher | root, second-root | isolated orgs, personal intact | as expected | PASS |
| sets A–E via UI builder | root | granular sets persisted | API-verified codes | PASS |
| delegated admin + escalation denied | root, org-admin | inline UI error + API 404; scoped create 200 | as expected | PASS |
| invite/accept/reject + set preserved | root, existing-*, member card shows set | as expected | PASS |
| new-user invite accept/reject via email link | root, new-* | register→verify→accept; reject→no membership | as expected | PASS |
| resend (fresh token, old dead, negatives) | root, resend-target | 200/404/422 matrix | as expected | PASS |
| permission matrix UI+API + cross-org | limited | hidden buttons; API 404s; allowed reads 200; org2 404s | as expected | PASS |
| multi-org, switcher, removal, suspension, root protection | limited/root | per-org perms; suspend 404+resume 200; remove; 409s | as expected | PASS |
| audit/notifications/no-native-dialogs | root | 9 action kinds; owner-scoped notifs; grep clean | as expected | PASS |
| platform admin views + boundary | qa-admin | /admin + aggregates 200; org routes 404 | as expected | PASS |
| session isolation | root→second-root | no leakage after logout/login | as expected | PASS |

## Security Tests

- Escalation (UI + direct API): DENIED (inline error + 404 oracle). Root bypass correct.
- Cross-org (11 surfaces × UI direct-URL + API): all 404, no leakage. Org1 sets unusable in org2.
- Fail-closed input validation precedes authz (malformed email/UUID/name → 422).
- Suspended/removed members: 404 on org routes, login + personal intact.
- Root invariants: self-remove/self-leave/self-suspend → 409; transfer endpoint absent (404/405).
- Platform admin: aggregates only; zero org content access without membership.

## Invitation Tests

existing accept/reject, new accept (register→verify→link→accept)/reject, resend (pending-only; accepted/rejected/revoked/expired → 422; old token → 404), expired (422 + auto-transition), duplicate (409), double-approve/reject (404), ghost approve (404).

## Permission Tests

All 9 groups exercised through builder; enforcement points verified per matrix (Members/PermissionSets/Organization/Audit). Unimplemented Phase-B modules (Teams/Providers/Keys/Budgets/Analytics-org) correctly absent: UI disabled placeholders, no API surface.

## Admin Tests

Documented promotion script; /admin renders; /api/admin/{users,dashboard} 200; org member/audit routes 404 for non-member admin; titannatesan@gmail.com flag verified platform_admin.

## UI Issues (found → fixed)

1. Sidebar treated `/invites` as org id → excluded static segments.
2. Governance lists went stale across section switches/actors → section-change invalidation + focus refetch + staleTime 0.
3. Assign dialog submitted before sets loaded (wiped grants to []) → loading state + disabled submit + picked-count echo.
4. Inbox cards indistinguishable for same-named orgs → `org_slug` added to API + UI.
5. Nested-label testid misalignment → per-option testids.

## Backend Issues (found → fixed)

1. Suspend/resume missing (spec'd) → implemented (Members.Suspend gate, 409 root, audit + notify).
2. Resend missing (spec'd) → implemented (pending-only, token rotation, audit + notify + re-email).

## Database Issues

None. State transitions, FKs, partial-unique constraints, timestamps, and audit/notification fan-out verified read-only. Accumulation across runs is expected (fresh orgs per run; slug-unique).

## Deviations (documented, behavior-neutral)

Headless-fullscreen instead of headed; `@test.tollma.ai` identities; API auth bootstrapping (mailbox unavailable); DB token reads where brief permits; throwaway admin promotion via documented script; suspend/resume + resend + org_slug implemented to meet the brief (were specified, missing).
