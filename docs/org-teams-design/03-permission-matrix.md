# 03 — Permission Matrix (FINAL v1 companion)

Model: allow-only codes, bundled in named sets (custom) or immutable catalog sets (system, clone-only). Effective = union(direct sets ∪ team sets). Grant ≤ granter's effective set. Root holds all implicitly.

## Catalog (standard governance set, §7)

| Code | Allows | Typical holders |
|---|---|---|
| `manage_members` | Invite, suspend/resume, remove, self-leave approvals n/a | Root, delegated admins |
| `approve_members` | Approve pending queue (subset of manage) | Team leads, HR |
| `manage_teams` | Create/rename/delete teams, assign members + team sets | Root, delegated admins |
| `create_keys` | Issue org keys to users (budget ≤ unallocated, models ∩ own scope) | Root, budget owners |
| `manage_budgets` | Edit org max_spend (≥ allocated), view pools | Root, finance |
| `manage_providers` | Create/update org provider credentials (gated view) | Root, infra |
| `view_analytics` | Org/team/user analytics, mode-gated content | Managers, finance |
| `view_audit` | Governance + mode-read audit rows | Root, compliance |
| `manage_settings` | Visibility mode, enforcement toggle, retention setting, delete org-visible content | Root, delegated admins |
| `transfer_root` | Initiate root transfer (root only in practice) | Root |

## Enforcement points (backend authorization checklist)

| Operation | Required permission(s) | Context |
|---|---|---|
| Invite / approve / remove / suspend | `manage_members` (approve: `approve_members` suffices) | Owning org |
| Create/delete team, team membership, team sets | `manage_teams` | Owning org |
| Create/revoke org key, set key budget/models | `create_keys` + grant ≤ own scope | Owning org |
| Edit max_spend / pools view | `manage_budgets` | Owning org |
| Org provider CRUD (creds) | `manage_providers` | Owning org |
| View analytics / audit | `view_analytics` / `view_audit` | Owning org (+ mode for content) |
| Toggle visibility mode / enforcement / retention | `manage_settings` (+ member notify) | Owning org |
| Root transfer initiate/accept | `transfer_root` + root identity / target accept | Owning org |
| Chat with org model | Valid org key + key model-list ∩ effective model scope + pool budget | Key's org |
| Export org analytics/events/audit | `view_analytics` (`view_audit` for audit) | Owning org |
| Export conversations | Ownership (user) only — org never | Personal/user |
| Share link create/revoke | Author only | n/a |

## Negative rules (must be tested)

- No endpoint accepts a permission code directly on a user (sets only).
- No cross-org permission evaluation (sets are org-scoped; 404 across).
- System sets never appear in assignment writes.
- Suspended/removed members evaluate to empty effective set in org context.
- Personal context ignores all org sets.
