# 01 — Domain Model (Organizations & Teams, FINAL v1 companion)

Source of truth: `docs/requirements/organizations-and-teams.md` (FINAL v1). This file adds no new requirements; it restates them as domain concepts with identities, invariants, and relationships for schema/API work.

## Entities

| Entity | Identity | Scope | Notes |
|---|---|---|---|
| User | user.id (V1, unchanged) | Platform | Identity outlives all orgs. Personal space = assets with NULL org binding. |
| Organization | org.id (new) | Platform-unique | Exactly one root_user_id at all times. Lifecycle: active → emptied → disabled/deleted. |
| Membership | (org_id, user_id) | Org | State machine (§35 + invite lifecycle). Carries direct permission-set assignments. |
| Team | team.id | Org | Flat grouping. Owns nothing. Members gain team permission sets (union). |
| PermissionSet | set.id | Org (system sets: platform) | UUID, name, description, system/custom flags, created_by/updated_by. Contains many permissions. Clone-only for system sets. No direct permission→user edges; everything via sets. |
| Permission | code string (e.g. `create_keys`) | Platform (catalog) | Allow-only. Standard governance set (§7) + future codes. System sets reference catalog codes. |
| Provider (personal) | V1 provider row + owner | User | Owner-only creds. Survives org removal. Invisible in org contexts. |
| Provider (org) | V1 provider row + org_id | Org | Updates require `manage_providers`. Config visible per permissions; creds gated. |
| RegisteredModel | V1 model row | Follows provider tier | Access granted via key model-lists ∩ permission model-sets. |
| ApiKey (personal) | V1 key row, owner | User | Survives org removal. Binds Personal context. |
| ApiKey (org-issued) | V1 key row + org_id + assignee | Org | Exactly one org per key. Budget allocated from org pools. Revoked on removal/suspension. |
| BudgetPool | org-level counters | Org | max_spend cap + allocated + unallocated (allocated = Σ live key budgets). |
| Conversation | V1 row, owner=user_id | **User always** | Never org/team owned, never transferred. May mix personal + org + (future) multi-org legs. |
| Message / Attachment | V1 rows | Follows conversation owner | Author-only edit. |
| UsageEvent | new immutable row per request | Platform record | (user, conversation, org_id nullable, key, provider, model, cost, tokens). Server-derived org_id. Append-only; adjustments as separate rows. |
| RequestLog | V1 rows + org_id | Platform record | Org-visible per policy. |
| Analytics | computed, never stored as source | Context scope | Org/team/user rollups over usage events; org totals deduped over users. |
| AuditLog | new append-only rows | Org (+ platform for break-glass) | Governance actions + mode-read accesses. Retention-configured auto-purge (purge itself audited). |
| Invitation | (org_id, email) + state | Org | 7-day expiry, re-invitable, auto-Expire. |
| ShareLink | V1 share rows, owner=user | User | Author-controlled; org cannot revoke. |
| ExportArtifact | export row + scope | Requester (+ org copy) | Inherits source retention. Orgs export analytics/events/audit only; users export conversations/messages/attachments. |
| RootTransfer | pending transfer row | Org | Initiated → accepted/cancelled → completed. Re-auth proofs. Atomic single-root swap. |

## Core invariants (must hold in every layer)

1. Exactly one root per org at all times (including mid-transfer).
2. Escalation: no grant beyond granter's effective set (root exempt for setup/transfer only).
3. Allow-only, union-effective permissions; no direct permission→user edges.
4. One key = one org (or Personal). Gateway resolves context from the key.
5. Conversations/messages/attachments user-owned, never transferred.
6. Usage events append-only; corrections via adjustment records; org_id server-derived.
7. Context switch affects future requests only; history keeps original attribution.
8. Budgets hard-stop per request leg; no overage; cap never below allocated.
9. Personal credentials never visible outside owner under any setting.
10. Platform admins: all metadata, zero conversation content, break-glass only.

## Bounded contexts

- **Identity** (V1, untouched): users, sessions, auth.
- **Governance** (new): orgs, memberships, teams, permission sets, invitations, transfers, audit.
- **Metering** (extends V1): keys, pools, usage events, adjustments, analytics.
- **Content** (V1, extended): conversations/messages/attachments/shares/exports with per-mode org visibility.
