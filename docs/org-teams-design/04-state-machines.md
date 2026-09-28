# 04 — State Machines (FINAL v1 companion)

## Membership lifecycle

```
Invited --(approve by approve_members+)--> Pending? (see note) --(accept invite)--> Active
Invited --(7d timeout, job)--> Expired --(re-invite)--> Invited
Active --(manage_members)--> Suspended --(manage_members)--> Active
Active --(manage_members | self-leave*)--> Removed (terminal)
Suspended --(manage_members)--> Removed (terminal)
* self-leave blocked for sole root (must transfer first)
```

Note: Invited vs Pending Approval — Invited = org initiated; Pending Approval = user requested or invite accepted awaiting approver. Both visible in the approver queue; both expire in 7d.

Per-state behavior:

| State | Login | Org access | Org keys/sessions | Conversations | Analytics |
|---|---|---|---|---|---|
| Invited/Pending/Expired | Unaffected | None | None | Own only | Own only |
| Active | Yes | Full per sets | Live | Own + mode-gated org | Per sets |
| Suspended | Yes (personal intact) | Denied | **Revoked immediately** | Own; org-mode content hidden until resume | Historical rows remain |
| Removed | Yes | None | Revoked; remainder to unallocated | Own (usage events stay with org) | Historical rows remain, badged |

## Organization lifecycle

```
Active --(remove all members, root action)--> Emptied --(root confirms)--> Disabled/Deleted
Deleted: usage events + logs purged (configurable aggregates may survive); user content untouched.
```

## Root transfer

```
Idle --(root initiates + password/Google re-auth)--> AwaitingAccept
AwaitingAccept --(target accepts)--> Completed (atomic single-root swap; ex-root bare)
AwaitingAccept --(initiator cancels | timeout*)--> Idle (audited)
* timeout: recommend 7d mirroring invites (design-time lock).
```

Break-glass recovery mirrors this machine with platform admin as initiator; target accept required; fully audited; zero data access granted.

## Invitation

```
Invited --(accept)--> PendingApproval --(approve)--> Active
Invited/PendingApproval --(7d)--> Expired --(re-invite)--> Invited
```

## Key lifecycle (org-issued)

```
Active --(revoke/delete | removal | suspension)--> Revoked (remainder → unallocated)
Revoked keys never reactivate; re-issue = new row, fresh allocation (audited).
```
