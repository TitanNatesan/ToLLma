# 02 — Resource Ownership Matrix (FINAL v1 companion)

Owner = controls lifecycle. Visibility/editors may be broader. Non-transferable unless stated.

| Resource | Owner | Visible to | Editable by | Deletable by | Transfer |
|---|---|---|---|---|---|
| Organization | Root (single) | Members | Root + `manage_settings` | Only at zero members; ledger purged, user content untouched | Root transfer (§33 flow) |
| Team | Org | Org members | `manage_teams` | `manage_teams`; members fall back to org-level | N/A |
| PermissionSet (custom) | Org | Permissioned members | Holders of every contained permission | When unassigned | N/A (org-scoped) |
| PermissionSet (system) | Platform | Clonable preview | Platform only (immutable) | Never | Clone-to-customize only |
| Membership | Org | `manage_members` / approvers (queue) | `manage_members` (grant ≤ own) | Removal leaves ledger; self-leave instant (non-root) | N/A |
| Invitation | Org | Approvers queue | Approvers | Auto-expire 7d; re-invite allowed | N/A |
| Provider (personal) | User | Owner only | Owner only | Owner | Never |
| Provider (org) | Org | Config: permissioned; creds: `manage_providers` | `manage_providers` | Root/permissioned; never on member removal | Never |
| Model | Follows provider tier | Same tier | Same tier editors | With tier scope | Never |
| ApiKey (personal) | User | Owner | Owner | Owner | Never |
| ApiKey (org) | Org, assigned to user | Metadata: permissioned; usage: assignee | `create_keys` (grant ≤ own) | Revoke → remainder to unallocated; removal/suspension auto-revoke | Revoke + re-issue only |
| BudgetPool | Org | `manage_budgets` / `view_analytics` | `manage_budgets` (cap ≥ allocated enforced) | N/A (cap, not row) | N/A |
| Conversation (any mix) | **User, sole** | Owner; org per visibility mode; shares per author | Author only | Author freely; never deletes usage/audit; removal/org-delete never touch it | **Never** |
| Message / Attachment | Conversation owner | Same as conversation | Author only | With conversation (`§27.9`: root/`manage_settings` may delete org-visible content, audited) | Never |
| Fork (branch) | Forking user | As new user-owned resource | Fork owner | Fork owner | Never |
| UsageEvent / RequestLog | Platform record | Org per policy; platform metadata-only | Immutable (adjustments only) | Org-delete purge only | Never (no reassignment) |
| Analytics | Org (aggregation) / user (personal) | `view_analytics` / owner | N/A (computed) | With source events | N/A |
| AuditLog | Org (+ platform rows for break-glass) | `view_audit` | Append-only | Retention auto-purge (purged-purge audited) | N/A |
| ShareLink | Authoring user | Author + grantees | Author | Author; survives removal (revocation passes to root/`manage_settings`) | Never |
| ExportArtifact | Requester (+ org copy for org-scope) | Requester; org-scope visible to `view_analytics` | N/A | Inherits source retention | N/A |
