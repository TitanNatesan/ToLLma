# 05 — Event Model (FINAL v1 companion)

All governance + ledger-relevant occurrences emit observable events (for audit rows, SSE/admin feeds, future webhooks). Content (prompts/responses) never enters event payloads — IDs + metadata only.

## Governance events (→ audit_log, org scope)

`org.created | org.disabled | org.deleted | member.invited | member.approved | member.removed | member.left | member.suspended | member.resumed | invite.expired | team.created | team.deleted | team.member_added | team.member_removed | set.created | set.updated | set.deleted | set.assigned | set.unassigned | key.issued | key.revoked | budget.cap_changed | budget.allocated | budget.returned | provider.created | provider.credentials_updated | mode.visibility_changed | enforcement.toggled | retention.changed | transfer.initiated | transfer.accepted | transfer.cancelled | transfer.completed | breakglass.initiated | breakglass.completed | mode.content_read | export.requested`

## Metering events (→ usage_event rows + analytics invalidation)

`request.attributed` (per request leg: user, conversation, org_id nullable server-derived, key, provider, model, tokens, cost) · `budget.adjusted` (adjustment records referencing originals) · `pool.exhausted` (hard-stop signal, no overage).

## Invariants

- Every governance event carries actor, org, timestamp, and affected IDs; content-free.
- `mode.content_read` fires on each full-access content view (viewer, target user, conversation).
- Events are emitted within the committing transaction scope (outbox pattern at implementation).
- Historical events are never rewritten by context switches (context-switch invariant).
