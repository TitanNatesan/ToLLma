# Database Migration Report

- Pre-existing block repaired: dev volume at fb3312981ccc with 32 ownerless pre-auth providers. Backup: /tmp/tollms-dev-pretrust-backup.dump. Backfill: dev-owner user + user_id on 32 providers/30 conversations/54 messages (migration's prescribed path). Stepwise upgrade to head green.
- New revision 44e09f1438c5 ("trust framework tables + age gate"): 14 tables (legal_documents, legal_acceptances, consent_records, retention_policies, dsr_requests, dsr_events, security_audit, provider_policies, abuse_reports, incidents, legal_requests, vulnerability_reports, complaints, subprocessors — 14 tables) + users.age_confirmed_at/age_confirm_method. CHECKs + partial unique indexes preserved by autogenerate (verified in file). Additive only, single head.
- Rollback tested on dev: downgrade -1 (tables + columns gone) → upgrade head (restored) → `alembic check` green → legal docs re-seeded + published (dev state only).
- No data migrations (seed script is operator-run, idempotent, draft-only).
