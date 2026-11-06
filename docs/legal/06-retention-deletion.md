# Data Retention & Deletion Policy (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `retention-deletion-policy` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Both (self-host operators inherit the same engine
  semantics; they set their own schedule values).
- Type: Notice; NORMATIVE input to Agent B enforcement (F9 precedence).
- Jurisdiction notes: DPDP storage-limitation; exact day-counts need
  counsel sign-off (L-08).

## 1. Precedence (F9, binding on implementation)

Org policy wins over personal for org-scoped traffic; most-restrictive
TTL wins on conflict (`min(retention_days)`); `zero_retention=true` at
either applicable scope short-circuits to no-capture. Single choke
point: the prompt-logging resolver — no parallel resolvers.

## 2. Schedule (day-counts DRAFT)

- Prompts/generations: per workspace setting, default
  `[PLACEHOLDER:DEFAULT_PROMPT_DAYS]` days; zero-retention available.
- Credentials: deleted on revocation; encrypted blobs purged with account.
- API request logs/usage aggregates: `[PLACEHOLDER:LOG_DAYS]` days, then
  aggregate-only.
- Audit/security events: `[PLACEHOLDER:AUDIT_DAYS]` days (abuse and
  incident evidence may extend a legal hold — disclosed, logged).
- Backups: rolling `[PLACEHOLDER:BACKUP_DAYS]`-day window; deletes
  propagate on expiry (no resurrection from backup after window).

## 3. Account deletion (actual current behavior)

Delete-request stamps `requested_at`, schedules hard purge 15 days out
(`scheduled_for`), sends staged reminders; pending accounts are denied
across feature routers; restore clears all three columns. API keys
disabled at request time stay deleted after restore (never resurrected).
Purge writes a forensic row (`deleted_user_id`, per-resource counts,
ok/failed) with no FK to the removed user.

## 4. Legal holds

Preservation orders suspend scheduled purges for the named scope only;
affected users are notified unless prohibited (see
`law-enforcement-policy`). Holds are reviewed every
`[PLACEHOLDER:HOLD_REVIEW_DAYS]` days and lifted in writing.
