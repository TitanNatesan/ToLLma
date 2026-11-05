# Organizations & Teams — Requirements Specification (FINAL v1)

> Status: FINAL v1 — approved 2026-09-28. No implementation may begin except per the phase plan; no further requirements discovery. No implementation may begin from this document until owner approves Final v1.
> V1 constraint: single-user workspaces only (per ROADMAP.md). This spec targets V2.
> Last updated: 2026-09-28. Owner decisions recorded inline as `[DECIDED]`; all sections are decided and approved.

## 1. Vision — [DERIVED 2026-09-28, needs owner approval]
- ToLLma organizations give companies a governed AI gateway: one org = one billable workspace with full usage/cost visibility over org-issued keys, while personal experimentation stays private by default and credential secrets never leak upward.
## 2. Terminology — [DERIVED 2026-09-28, needs owner approval]
- Root: the single whole-org maintainer (transferable). Member: any other org user with custom allow-only permission sets. Permission set: named bundle of governance permissions (standard + custom). Team: flat grouping granting shared permission sets (owns nothing). Personal space: the user's private assets outside all orgs. Org key: admin-issued key with budget/rate-limit/model-list restrictions.
## 3. User Types — [DERIVED 2026-09-28, needs owner approval]
- Platform user (identity, personal space) · Root (per-org) · Org member (per-org custom permissions) · Platform admin (existing V1 flag, orthogonal — platform ops, not org governance).
## 4. Organization Model — [DECIDED 2026-09-28]
- Exactly one root user per org (creator; transferable, invariant: always exactly one).
- Root may grant full-admin permission sets to other members (admin ≠ root).
- Org lifecycle: cannot be disabled/deleted while any members remain; must remove all users first.
- A user who is root of any active org cannot delete their own account.
- Orgs REMOVE users (membership revocation); orgs never DELETE user identities.
## 5. Team Model — [DECIDED 2026-09-28: flat only]
- Flat: Org → Teams → Members. No nesting, no sub-teams in V2.
- Org-level membership without team membership is valid and first-class.
## 6. Membership Model — [DECIDED 2026-09-28]
- Removal revokes org access + org-issued keys; org-key USAGE EVENTS + analytics stay with the org; CONVERSATIONS stay with the user (org content visibility follows conversation_visibility_mode §15); personal assets leave with the user.
- Org disable requires zero members (§4); on terminal org delete, org usage events/logs are PURGED (aggregates only may survive per billing law — TBD); user conversations are untouched (user-owned).
## 7. Permission Model — [DECIDED 2026-09-28: role-less, allow-only, named sets]
- No roles (no admin/member/viewer). Only: root user (whole-org maintainer) + org members with custom permission sets.
- Permission sets are per-org scoped, ALLOW-ONLY, no deny rules. Effective = union of direct + team grants.
- Standard governance permissions: manage_members, manage_teams, create_keys, manage_budgets, manage_providers, view_analytics, view_audit, approve_members, manage_settings, transfer_root — PLUS reusable named custom sets.
- FIRST-CLASS PERMISSION SETS [DECIDED 2026-09-28]: permission sets are separate resources (UUID; name; description; system-set boolean; custom-set boolean; org-scoped; created_by; updated_by). A set contains many permissions. Users and teams hold MULTIPLE sets each. NO direct permission assignment to users — everything flows through sets.
## 8. Role Model — [DECIDED 2026-09-28: no roles]
- Rejected fixed-role RBAC per owner. Root is a special identity, not a role.
## 9. Provider Ownership — [DECIDED 2026-09-28]
- Two tiers: personal providers (owner-only credential access/update; survive org removal) + organization providers (credential update requires proper org permission).
- Personal credentials are NEVER visible/accessible to the org — only usage may be shared.
- Org settings may ENFORCE sharing of usage history (model usage, provider name, conversations — exact fields TBD in Privacy section).
- If org does not enforce, the user opts in/out of sharing personal provider spend data.
- ENFORCEMENT DEFAULT [DECIDED 2026-09-28]: OFF for new orgs (privacy by default); the org may enable enforcement later via settings.
- ENFORCEMENT TOGGLE [DECIDED 2026-09-28]: enabling or disabling enforcement is audit-logged AND notified to all members.
- All spend via org keys is org-monitored/analytics-visible by default.
## 10. Model Ownership — [DECIDED 2026-09-28: no team pools]
- Teams own NOTHING: teams are pure permission groupings (a set of permissions shared by member users).
- Models live in personal pools (private) + org pools; access is granted via API key model-lists + permission sets, not via team-owned model rows.
## 11. Key Management — [DECIDED 2026-09-28: admin-issued, key-scoped]
- Root or permissioned users may create API keys FOR a user in the org.
- The key carries its own restrictions (budget, rate limits, model list); the user consumes those models in chat under the key's restrictions.
- Personal keys survive org removal; org-issued keys are revoked on removal (per §20).
## 12. Budget Management — [DECIDED 2026-09-28: org cap + key allocations, no team caps]
- Single org-level max_spend cap, editable at any time by permissioned users.
- Permissioned users create keys with budgets deducted/allocated from the org budget, assigned to a user.
- Hard stop (V1-style, no overage): when a key's budget for the selected model is exhausted, the user cannot spend more.
- PER-LEG HARD STOP [DECIDED 2026-09-28]: in mixed conversations, an exhausted org pool blocks only org-keyed request legs; personal legs continue unaffected.
- BUDGET POOLS [DECIDED 2026-09-28]: Organization budget = Allocated + Unallocated. Key creation moves funds from unallocated to allocated. Both pools visible in analytics. Key deletion/deactivation returns its remaining budget to unallocated (recommendation — confirm at design).
## 13. Usage Tracking — [DECIDED 2026-09-28: immutable per-request ledger]
- Every request is attributed to (user, key, org-context or personal). Org-key spend always tracked for org analytics (§14). Personal-key spend shared per enforcement/opt-in policy (§9); content never leaves with usage (content rules §15).
- CONTEXT-SWITCH INVARIANT [DECIDED 2026-09-28]: context changes affect ONLY future requests. Historical requests remain attributed to their original context; switching never rewrites the ledger.
- USAGE-EVENT IMMUTABILITY [DECIDED 2026-09-28 — HARD INVARIANT]: usage events are append-only, never reassigned, never edited. Corrections use adjustment records (new rows referencing the original), themselves immutable and audited.
## 14. Analytics — [DECIDED 2026-09-28: full metadata on org keys]
- Org analytics see FULL metadata for org-key usage: model names, token counts, costs, provider names, API usage. Nothing hidden.
- TEAM ANALYTICS [DECIDED 2026-09-28]: hierarchy Organization ├─ Team └─ User / └─ User (direct members). Teams own nothing and conversations are NEVER team-tagged (conversations are user properties, §34). Team-level analytics = visibility aggregation over the org-key usage of CURRENT team members (a multi-team member's usage appears under each of their teams — visibility only, never charging; teams hold no budgets). All three levels support cost, tokens, requests, models, providers, trends. Budget pools (allocated/unallocated) visible at org level.
## 15. Privacy Controls — [DECIDED 2026-09-28: user-owned conversations + visibility modes]
- OWNERSHIP INVARIANT: every conversation belongs to exactly one user. Conversations are never org-owned, never team-owned, never transferred; context switching does not change ownership. Rationale: users may switch providers/models/keys mid-conversation; one conversation may span personal + org + multi-org usage, so ownership cannot derive from a single key/provider.
- ORG VISIBILITY is per-request usage event (user_id, conversation_id, organization_id nullable, key_id, provider_id, model_id, cost, tokens), NOT by conversation ownership.
- Org-issued key usage always exposes to the org: usage analytics, token counts, costs, model/provider usage, request logs.
- conversation_visibility_mode (org policy, supersedes the earlier "org can read all" decision): metadata_only (DEFAULT — user, model, provider, tokens, costs, timestamps) | full_conversation_access (prompts, responses, attachments viewable). Toggle governed like enforcement (§9: audited + member-notified).
- Personal-key chats: content ALWAYS private; metadata shared only per enforcement/opt-in (§9).
- Personal credentials NEVER visible to org under any setting.
- MODE-READ AUDIT [DECIDED 2026-09-28]: every full_conversation_access content read is audit-logged (viewer, target user, conversation, timestamp).
- FINGERPRINT NOTE [DECIDED 2026-09-28]: under metadata_only, per-request timestamps + model sequences may reveal conversation shape (length/turns). Accepted limited exposure for billing; not content access.
## 16. Invitations — [DECIDED 2026-09-28: approval-gated]
- Join requires approval workflow; only permissioned users can approve new members. No auto-join, no open link join.
- INVITE LIFECYCLE [DECIDED 2026-09-28]: invites expire after 7 days (re-invitable after expiry). manage_members/approve_members holders see a pending-approval queue (Invited + Pending Approval states).
## 17. Approval Flows — [DECIDED 2026-09-28: same as §16]
- Single flow: membership approval by permissioned users.
## 18. Team Inheritance — [DECIDED 2026-09-28: N/A, flat teams]
- No inheritance: flat teams, no nesting.
## 19. Multi-Team Membership — [DECIDED 2026-09-28]
- Users may join multiple teams in one org; effective permissions = union of grants.
## 20. Multi-Organization Membership — [DECIDED 2026-09-28]
- Users may access multiple orgs; each org grants its own permission sets, applicable only within that org.
- Removal from an org revokes only that org's access (its models/permissions/keys); personal assets (own keys, providers, analytics) and login survive.
## 21. User Experience — [DECIDED 2026-09-28: switcher + personal space]
- Explicit org switcher: one active context at a time (Personal space vs Org A vs Org B), per-org data isolation.
- Remember last-used/default org per user.
## 22. Audit Logging — [DECIDED 2026-09-28: full governance audit]
- All governance actions audited: membership add/remove, key create/revoke, budget edits, provider credential updates, approvals, root transfer.
- Visible to permissioned users. Retention period is org-configurable (set by root or permissioned users).
## 23. Security Model — [DERIVED 2026-09-28, needs owner approval]
- Credentials: personal provider secrets owner-only, never readable by org (usage-only sharing); org provider updates permission-gated. Cross-org isolation: permission sets never cross org boundaries; cross-owner reads return 404 (V1 rule extends to org scope). Root-transfer + last-root protection invariants. Audit log integrity per §22.
- ESCALATION PROTECTION [DECIDED 2026-09-28 — HARD INVARIANT]: a user may NEVER grant permissions they do not currently possess. Applies to user assignment, team assignment, permission-set creation/editing, invitations, and approvals. The granter's effective permission set must be a superset of every permission granted. Root is exempt only for initial org setup and root transfer.
- BREAK-GLASS [DECIDED 2026-09-28]: audited platform-admin root recovery. If the sole root is lost, a platform admin may reset org root to an active member. The action is audit-logged (both identities, reason), notified to all permissioned members, and never grants the platform admin org data access.
- PLATFORM ADMIN BOUNDARY [DECIDED 2026-09-28]: platform/super admins (platform holders) may see every organization's METADATA — model spend, provider spend, usage trends, and aggregates — but can NEVER see conversation CONTENT of any user, whether in an org or not. Content access is exclusively via org membership + permissions.
- REVOCATION TIMING [DECIDED 2026-09-28]: permission removal affects FUTURE actions only (outstanding keys/sessions drain naturally). Suspension revokes sessions and keys IMMEDIATELY (§35).
- SYSTEM SETS [DECIDED 2026-09-28]: system permission sets are platform-owned, immutable, and clone-to-customize per org. System-set changes never propagate into org clones.
- RATE LIMITS [DECIDED 2026-09-28]: NO org-level rate limits. Budgets are the only org-level governor; per-key rate limits (V1) continue to apply within keys.
- CONTEXT ISOLATION [DECIDED 2026-09-28 — MANDATORY]: per-context cache namespaces (no shared Valkey keys across contexts) and search-index purge coupled to source-data purge on removal/org-delete. Stale cross-context reads are a release-blocking defect class.
## 24. API Design Requirements — [DERIVED 2026-09-28, needs owner approval]
- Org-scoped CRUD for orgs/teams/memberships/invites/approvals/keys/budgets/providers/analytics/audit; every endpoint enforces active-org context + permission check; key-issuance binds (org, user, budget, model-list); chat resolves key restrictions + hard-stop.
## 25. Database Requirements — [DERIVED 2026-09-28, needs owner approval]
- New tables carry UUID PKs, created_at/updated_at, soft-delete (is_deleted/deleted_at/deleted_by) per database.md; org_id-indexed; no secrets at rest (Fernet per backend.md); single-head Alembic migrations; per-(org,user) uniqueness where applicable.
- SERVER-DERIVED ATTRIBUTION [DECIDED 2026-09-28 — ANTI-FORGERY INVARIANT]: organization_id on usage events is derived server-side from the resolving key, never client-supplied.
## 26. Future Billing Compatibility — [DECIDED 2026-09-28: org is billable unit]
- Plans/subscriptions/invoices attach to the ORGANIZATION. No team-level billing. Usage rollups per-org (+per-key/per-user) already support this.
## 27. Open Questions — [2026-09-28, FINAL: all resolved]
Ownership correction applied. Round-6 lock (owner, 2026-09-28): §27.1 configurable mechanism, default purge, billing/tax may override duration · §27.2 immediate return to unallocated on revoke/delete · §27.3 no reservation; creation-time validation + spend-time hard stop · §27.4 configurable retention + purge job enabled · §27.5 clone-only, never assigned · §27.6 block reduction below allocated · §27.7 exports inherit source retention · §27.8/§33 accept-required, cancellable pre-accept, password + Google re-auth, ex-root bare · §27.9 root/manage_settings may delete org-visible content; ledger survives · §27.10 remainder to unallocated, fresh allocation on re-issue · §27.11 break-glass accept-required, fully audited.
Additional locks: author free-delete of conversations (never deletes usage events/audit) · enforcement post-toggle only · team analytics deduped at org level · expired invites auto-Expire · personal providers invisible to orgs; creds masked + gated · usage events append-only forever; adjustments as separate records.
No open questions remain.
Ownership correction applied: §§15/§31/§32/§34/§36 + §6 rewritten (user-owned conversations; per-request org visibility; visibility modes; share governance). Items 7 (export retention) and 9 (others-delete) now read against user-owned conversations.
Resolved in round 3–4: single-team tag dropped (conversations never team property); revocation timing; system sets; personal-in-picker; enforcement OFF + toggle notice; key-org binding; rate limits REJECTED (budgets govern); namespace isolation; removed-member attribution; invite lifecycle; self-leave; author-only edit; author-controlled sharing; platform-admin metadata-yes/content-never.
Remaining:
1. Purge aggregates: may anonymized aggregates survive terminal org delete for billing/tax law?
2. Key-budget return: does deleting/deactivating a key return remaining budget to unallocated? (Recommended: yes.)
3. Budget race: concurrent spend of the last dollar — spend-time hard-stop + creation-time allocation check, no cross-key reservation? (Recommended: yes.)
4. Audit auto-purge: does org-configured retention auto-purge audit rows, with the purge itself audited? (Recommended: yes/yes.)
5. System sets: directly assignable read-only, or clone-only? (Recommended: clone-only.)
6. Budget-cap lowering below allocated total: block with explicit error, or auto-revoke? (Recommended: block.)
7. Export artifact retention policy (§31: TBD). (Recommended: inherit source-conversation retention.)
8. §33 starred: transfer accept / delay-cancel / password+Google re-auth / ex-root default perms. (Recommended: accept required; cancellable until accept; re-auth yes both; ex-root = bare member.)
9. Deletion of others' messages: author-only edit is decided; may anyone (root? permissioned?) delete another member's org-key messages, audited? (Recommended: root + manage_settings holders, audited, content retained in audit ref.)
10. Key re-assignment budget: revoke + re-issue moves budget how — old remainder to unallocated, new allocation fresh? (Recommended: yes.)
11. Break-glass target accept: must the chosen member accept the reset root? (Recommended: yes, same accept flow as transfer.)
## 28. Final Decisions — [FINAL v1, approved 2026-09-28]
- All 36 sections decided. Derived §§1–3, 23–25 APPROVED by owner. Zero open questions. No further requirements discovery.
- §33 root-transfer starred items resolved per §27.8 lock. Break-glass per §27.11 lock.

## 29. Active Context Model — [DECIDED 2026-09-28]
- A user always operates in exactly ONE active context: Personal Space | Organization A | B | C …
- The active context controls: analytics visibility, providers, models, budgets, keys, conversations, permissions.
- Context resolution: every request carries one context (UI switcher selection or API key's bound org); server rejects cross-context references with 404 (no existence oracle, V1 rule). Personal context exposes only personal assets; org context exposes org assets + the member's effective permission sets for that org only.
- Switching contexts never leaks data between contexts (separate queries, separate caches).

## 30. Chat Resolution — [DECIDED 2026-09-28]
- The chat model picker shows ALL available models in a SINGLE selector, grouped: Personal Models (user-owned providers, personal keys) + Organization Models (org providers, org-issued keys — filtered by the member's permissions AND the key's restrictions).
- Each model row shows: source (Personal/Organization), provider, key, budget state, restrictions.
- Resolution order: active context → member's keys valid in that context → key model-list ∩ permission model-sets → budget check (hard stop on exhaustion) → provider/model availability.
- In Personal context only personal models appear; in an org context the single picker shows BOTH groups: Personal section + Organization section (org models filtered per above). Personal content stays private per §15; only the model identity (name/provider) is disclosed by listing.
- ORG-KEY BINDING [DECIDED 2026-09-28]: one key = exactly one organization. The gateway resolves org context FROM the key, never from caller hints. Personal keys bind to the Personal context.

## 31. Resource Ownership Matrix — [DECIDED 2026-09-28]
| Resource | Owner | Visibility | Editable by | Deletion rules | Transfer rules |
|---|---|---|---|---|---|
| Organization | Root (single) | Members of that org | Root + manage_settings holders | Only when zero members; then purge per §6 | Root transfer per §33 |
| Team | Organization | Org members | manage_teams holders | Deleted teams release members to org-level (no cascade delete of users) | N/A (flat, org-scoped) |
| Permission Set | Organization (system sets: platform) | Org members | Holders of every permission the set contains (§23 invariant) | Custom sets deletable when unassigned; system sets immutable | N/A (org-scoped) |
| User (identity) | Self | Self + orgs they joined (membership rows only) | Self; no org can edit/delete identity | Blocked while root of any active org (§4) | N/A |
| Membership | Organization | Permissioned members | manage_members holders (grant ≤ own perms) | Removal revokes keys, retains history (§6) | N/A |
| Provider (personal) | User | Owner only (creds never shared) | Owner only | Owner deletes; survives org removal | Cannot transfer (re-create in org) |
| Provider (org) | Organization | Permissioned members (config visible; creds permission-gated) | manage_providers holders | Root/permissioned; member removal never deletes | N/A (org-scoped) |
| Model (registered) | Follows provider tier | Same tier visibility | Same tier editors | With parent provider scope | N/A |
| Key (personal) | User | Owner only | Owner | Owner deletes; survives org removal | Cannot transfer |
| Key (org-issued) | Organization (assigned to a user) | Permissioned members (metadata); assignee (usage) | create_keys holders (grant ≤ own perms) | Revoked on member removal; remaining budget → unallocated (pending §27.4) | Re-assignment = revoke + re-issue (audited) |
| Budget | Organization (max_spend + pools) | Permissioned members | manage_budgets holders | N/A (cap, not row); lowered only ≥ allocated total (recommendation — confirm) | N/A |
| Conversation (personal-key) | User | Owner only (+metadata per sharing policy §9) | Owner | Owner deletes; 15-day lifecycle (V1) | N/A |
| Conversation (any key mix) | User (sole owner) | Owner; org per conversation_visibility_mode (§15); shares per author (§34) | Author only (org never edits) | Owner deletes (V1 lifecycle); removal/org-delete never delete user conversations | Never transferable |
| Usage event / request log | Platform record (immutable ledger) | Org per policy (§15 + §9); platform admins metadata-only (§23) | Immutable; nobody edits | Retained on removal; purged on org delete (§6) | N/A |
| Message | User (conversation owner) | Owner; org per conversation_visibility_mode (§15) | Author only | With conversation | Never transferable |
| Attachment | User (conversation owner) | Owner; org per conversation_visibility_mode (§15) | Author only | With conversation | Never transferable |
| Analytics | Organization-owned aggregation (computed from usage events) | view_analytics holders; personal scope: owner | N/A (computed) | Usage events purged on org delete (§6); retention per §22 | N/A |
| Audit Logs | Organization | view_audit holders | Immutable (append-only) | Org-configured retention auto-purge (§27.8) | N/A |
| Exports | Requester (+ org copy for org-context exports) | Requester; org-context exports visible to view_analytics holders | N/A (artifacts) | With retention policy (recommendation — confirm) | N/A |

## 32. Conversation History Retention — [CORRECTED 2026-09-28: all conversations user-owned]
- ALL conversations (personal-key, org-key, mixed): owned, visible, searchable, exportable, and deletable by the OWNING USER; V1 15-day deletion lifecycle applies to all.
- Org-key usage WITHIN a conversation: usage events + request logs stay with the org after member removal and survive user-side conversation deletion (ledger integrity); purged only on terminal org delete (§6).
- Org content visibility follows conversation_visibility_mode (§15); search indexes inherit the mode; export events are audit-logged.
- Removed-author display: audit rows retain real identity; historical usage keeps author attribution; analytics views may badge removed-member (§31).
- EXPORT OWNERSHIP [DECIDED 2026-09-28]: organizations export analytics, usage events, and audit logs. Users export conversations, messages, and attachments. Organizations NEVER export user-owned conversations (mode-gated viewing §15 is not exporting).
- FORKING [DECIDED 2026-09-28]: conversation forks (V1 branching) are always user-owned by the forking user, never inherit org ownership, and start as fresh user-owned resources (usage within the fork attributes per-request as usual).

## 33. Root Transfer — [DESIGN 2026-09-28; pending owner decisions marked *]
- Eligibility: transfer ONLY to active members of the same org. (Recommended.)
- Flow: root initiates → target confirms* (Recommended: yes, explicit accept) → transfer immediate on accept, no delay*. (Recommended: no delay; *cancel possible until accept.)
- Re-auth: password re-auth required for the initiating root* (Recommended: yes); Google re-auth where applicable* (Recommend: same bar as password).
- Audit: transfer initiation, acceptance/cancellation, and completion are all audit-logged with both identities; previous root becomes a regular member with no permissions by default* (Recommended).
- Invariants hold throughout: exactly one root at all times (no window with zero or two roots); account-deletion block (§4) moves to the new root atomically.

## 34. Organization Visibility of Org-Key Data — [CORRECTED 2026-09-28: usage-owned, not conversation-owned]
- The earlier 'org owns org-key conversations' rule is REJECTED and replaced: organizations consume resources; users own conversations.
- The org owns: usage events, request logs, and analytics aggregations derived from org-key usage. It does NOT own conversations, messages, or attachments.
- Conversation content visibility is governed solely by conversation_visibility_mode (§15), default metadata_only.
- SHARING [DECIDED 2026-09-28]: conversations are user property. The author may share member-specific or anyone-with-link, no permission needed. The org CANNOT revoke personal share links; it governs only analytics/logs visibility.
- MESSAGE EDIT [DECIDED 2026-09-28]: only the author may edit their own messages; others view-only within the visibility mode. (Deletion of others' messages: OPEN — see §27.)
- TEAM PROPERTY [DECIDED 2026-09-28]: conversations are NEVER team belongings. No team-tagging. Team analytics aggregate member usage (§14).
## 35. Membership State Machine — [DECIDED 2026-09-28: suspension kept]
- States: Invited → Pending Approval → Active ⇄ Suspended → Removed (terminal).
- Transitions: invite (permissioned user) → approve (permissioned approver, §16) → Active; suspend/resume (manage_members holders); remove (manage_members holders; self-leave allowed except last-root rule §4).
- Suspended: login survives; org-context access denied; org sessions revoked and org keys revoked immediately; conversations retained but inaccessible until resume; analytics attributed to suspension window remain visible.
- Removed: per §6 (keys revoked, history retained, personal assets leave).
- SELF-LEAVE [DECIDED 2026-09-28]: any Active member may leave instantly, no approval; the sole root must transfer first (§4).

## 36. Resource Scope Matrix — [DECIDED 2026-09-28]
Which context each resource lives in, and which contexts may reference it. (Ownership details: §31.)

| Resource | Personal context | Owning-org context | Other-org context | Notes |
|---|---|---|---|---|
| Personal provider / model / key | Full access (owner) | Listed in picker Personal section (§30); content private | Invisible (404) | Credentials never cross contexts |
| Org provider / model | Invisible | Visible per permissions | Invisible (404) | Org-scoped rows |
| Org-issued key | Invisible | Usable by assignee; manageable per create_keys | Invalid (key binds one org) | Gateway resolves org from key |
| Org budget / pools | Invisible | Visible per manage_budgets / view_analytics | Invisible | Org-level only |
| Personal conversation/message/attachment | Full (owner) | Metadata only per sharing policy; content never | Invisible | §15, §32 |
| Any conversation/message/attachment | Owner: full | Org sees usage always + content per conversation_visibility_mode (§15) | Invisible | Always user-owned; sharing = author (§34) |
| Team | N/A | Visible to org members; grants permission sets | Invisible | Owns nothing; grouping only |
| Permission set (custom) | N/A | Assignable/viewable per governance perms | Invisible | Org-scoped |
| Permission set (system) | N/A (platform) | Clonable; never directly assignable* (*recommendation — confirm: assignable read-only or clone-only?) | N/A | Immutable |
| Membership | Own rows readable | Manageable per manage_members | Invisible | Per-org rows |
| Analytics | Personal scope only | Org/team/user scopes per view_analytics | Invisible | §14 |
| Audit logs | N/A (account events stay V1) | Append-only, view_audit holders | Invisible | Real identity retained (§31) |
| Exports | Own artifacts | Requester + view_analytics holders | Invisible | Events audited |

### Decision log
| Date | Question | Decision | Rationale |
|------|----------|----------|-----------|
| 2026-09-28 | Multi-org membership | Users may belong to multiple orgs; permission sets per-org scoped; orgs REMOVE (not delete) users; personal assets survive removal | Multi-company access; identity outlives any org |
| 2026-09-28 | Org ownership | Exactly ONE root per org (creator, transferable); full-admin grants possible; root of active org cannot delete account; org disable requires zero members | Single accountability; prevents orphaned orgs |
| 2026-09-28 | Team structure | Flat teams only; org membership without team is valid; members carry permission sets + keys + model sets + budget | Keep V2 simple |
| 2026-09-28 | Multi-team | Multiple teams per user in one org; effective permissions = union | Matches real orgs |
| 2026-09-28 | Permission model | No roles; root + members with custom permissions | Owner directive |
| 2026-09-28 | Provider ownership | Personal (owner-only creds, never shared) + org (permission-gated updates); org may enforce usage-history sharing; user opt-in/out for personal spend when not enforced; org-key spend always org-visible | Credentials never leak; usage sharing is policy-controlled |
| 2026-09-28 | Teams scope | Teams are permission groupings only (own no providers/models/keys/budgets); keys are admin-issued per user carrying budget/rate-limit/model-list restrictions enforced in chat | Keeps flat model; access via keys + permission sets |
| 2026-09-28 | Budgets | Org max_spend (editable by permissioned users); key budgets allocated from org budget per user; hard stop on exhaustion, no overage | V1 hard-stop semantics extended |
| 2026-09-28 | Privacy content | SUPERSEDED 2026-09-28 by visibility-mode model: default metadata_only; full access only under full_conversation_access policy (§15) | Owner correction |
| 2026-09-28 | Analytics | Full metadata on org-key usage (models, tokens, costs, providers, API usage) | Owner directive |
| 2026-09-28 | Invitations | Approval workflow; only permissioned users approve | Owner directive |
| 2026-09-28 | Offboarding | Removal retains org-key history, revokes org keys; terminal org delete purges history | Owner directive |
| 2026-09-28 | Audit | Full governance audit; org-configurable retention | Owner directive |
| 2026-09-28 | Billing | Org is the billable unit; no team billing | Owner directive |
| 2026-09-28 | Permissions | Allow-only, no denies; union of direct + team grants; standard set + named custom sets | Owner directive |
| 2026-09-28 | UX | Explicit switcher (Personal vs Org A/B), per-org isolation, last-used/default remembered | Owner directive |
| 2026-09-28 | Permission sets first-class | Separate resources (UUID/name/desc/system+custom flags/org-scoped/created+updated by); users+teams hold multiple sets; no direct permission assignment; union effective | Owner change request |
| 2026-09-28 | Active context | Exactly one active context (Personal \| Org A/B/C) controlling analytics/providers/models/budgets/keys/conversations/permissions; 404 on cross-context refs | Owner change request |
| 2026-09-28 | Chat resolution | Single picker (Personal + Org groups); rows show source/provider/key/budget/restrictions; context → keys → model-list ∩ permissions → budget → availability | Owner change request |
| 2026-09-28 | Ownership matrix | Full matrix (§31) for 19 resources: owner/visibility/editors/deletion/transfer | Owner change request |
| 2026-09-28 | Retention | Personal vs org conversation visibility/search/export/retention/deletion rules (§32) | Owner change request |
| 2026-09-28 | Escalation protection | HARD INVARIANT: never grant permissions you lack; applies to assignment/sets/invites/approvals | Owner change request |
| 2026-09-28 | Root transfer | Active-members only; accept + re-auth + atomic single-root + full audit (§33, starred items pending) | Owner change request |
| 2026-09-28 | Org-key data ownership | All output of org resources belongs to org (§34); personal output belongs to user | Owner change request |
| 2026-09-28 | Budget pools | Org budget = Allocated + Unallocated, visible in analytics (§12) | Owner change request |
| 2026-09-28 | Team analytics | Org ├─ Team └─ User / └─ User attribution (membership-based, teams own nothing); cost/tokens/requests/models/providers/trends at all levels | Owner change request |
| 2026-09-28 | Membership lifecycle | Invited → Pending → Active ⇄ Suspended → Removed; suspension keeps login, kills org access + keys (§35) | Owner change request |
| 2026-09-28 | Team attribution | Conversation optionally in exactly one team; roll-up through it; no multi-team charging | Owner directive |
| 2026-09-28 | Break-glass | Audited platform-admin root recovery; no org data access; members notified | Owner approved |
| 2026-09-28 | Revocation timing | Permission removal = future-only; suspension = immediate session+key revocation | Owner directive |
| 2026-09-28 | System sets | Platform-owned immutable; clone-to-customize | Owner approved |
| 2026-09-28 | Personal in org picker | Visible, grouped Personal/Organization sections; content stays private | Owner directive |
| 2026-09-28 | Enforcement default | OFF for new orgs; org may enable later | Owner directive |
| 2026-09-28 | Key-org binding | One key = one org; gateway resolves org from key | Owner directive |
| 2026-09-28 | Rate limits | No org-level rate limits; budgets govern, per-key limits persist | Owner directive |
| 2026-09-28 | Context isolation | Mandatory per-context cache namespaces + index purge coupled to data purge | Owner approved |
| 2026-09-28 | Removed members | Audit retains identity; history keeps author attribution; analytics may badge removed | Owner directive |
| 2026-09-28 | Resource scope matrix | Per-context visibility matrix for 13 resource classes (§36) | Owner change request |
| 2026-09-28 | Invite lifecycle | 7-day expiry (re-invitable); pending-approval queue for manage_members/approve holders | Owner directive |
| 2026-09-28 | Self-leave | Instant, no approval; sole root must transfer first | Owner directive |
| 2026-09-28 | Org message edit | Author-only edit; permissioned members view-only, cannot edit (others-delete OPEN) | Owner directive |
| 2026-09-28 | Sharing | Conversations are user property; author may share member-specific or anyone-link, no permission needed | Owner directive |
| 2026-09-28 | Platform admin boundary | All org metadata visible (spend/trends); conversation content NEVER visible to platform admins | Owner directive |
| 2026-09-28 | Enforcement toggle | Audit-logged + notified to all members on enable/disable | Owner directive |
| 2026-09-28 | Team property | Conversations never team-tagged; team analytics = member-usage aggregation (visibility, no charging) | Owner directive |
| 2026-09-28 | Conversation ownership correction | ALL conversations user-owned (multi-key/provider/org rationale); never org/team owned, never transferred; context switch keeps ownership | Owner correction |
| 2026-09-28 | Visibility modes | conversation_visibility_mode: metadata_only (default) / full_conversation_access; audited toggle + member notice | Owner correction |
| 2026-09-28 | Usage-event ledger | Per-request org visibility (user/conv/org/key/provider/model/cost/tokens); usage events platform records surviving conversation deletion | Owner correction |
| 2026-09-28 | Share governance | User controls all share links; org cannot revoke personal links; org governs analytics/logs only | Owner correction |
| 2026-09-28 | Round-5 approvals | Mode-read audit logging; per-leg hard stop; server-derived org_id; fingerprint disclosure note | Owner approved |
| 2026-09-28 | Export ownership | Orgs export analytics/events/audit; users export conversations/messages/attachments; orgs never export user conversations | Owner directive |
| 2026-09-28 | Forking | Fork owner = forking user; no org inheritance; fresh user-owned resource | Owner directive |
| 2026-09-28 | Context-switch invariant | Future requests only; history keeps original attribution | Owner directive |
| 2026-09-28 | Usage-event immutability | Append-only, never reassigned/edited; corrections via adjustment records | Owner directive |
| 2026-09-28 | FINAL v1 lock | All §27 items + additional locks recorded; derived §§1–3/23–25 approved; discovery closed | Owner approval |
| 2026-09-28 | Others-delete | Root/manage_settings may delete org-visible content; usage events + audit survive | Owner directive |
| 2026-09-28 | Author delete | Free conversation delete; never touches usage events/audit; enforcement post-toggle-only; team analytics deduped; invites auto-Expire; personal providers invisible/masked; ledger append-only forever | Owner directive |
| 2026-09-28 | Rate limits | No org-level rate limits; budgets govern, per-key limits persist | Owner directive |

---

## Change Order B — 2026-09-28 (Organization Management UX Refactor)

Owner-directed, supersedes conflicting FINAL v1 details (spec deviation logged, not silently changed):

- Permission catalog replaced: 10 flat codes → 52 granular codes in 9 groups
  (Organization 7, Members 7, Teams 7, PermissionSets 5, Providers 8, Keys 7,
  Budgets 4, Analytics 5, Audit 2). Ownership matrix §31 and permission model §7
  otherwise unchanged (allow-only, union, escalation invariant, clone-only system sets).
- Enforcement points remapped (Members.Read/Invite/Remove, PermissionSets.*,
  Organization.Settings, Audit.Read, Members.Approve/Update for approvals).
- Enterprise sidebar navigation replaces horizontal org tabs; Teams/Providers/Keys/
  Budgets/Analytics render as disabled Phase-B placeholders (no redesign later).
- Settings redesigned as cards (Privacy, Sharing, Metadata, Danger Zone with
  Phase-B-disabled actions). All window.confirm/prompt/alert replaced with
  Dialog-based components. Toast + audit coverage unchanged.
- Migration `b2c3d4e5f6a8` expands legacy grants (Owner reset to full 52-code
  canonical; Approver reset; custom sets mapped).
