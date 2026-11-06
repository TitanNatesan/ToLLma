# Backup & Restore — PG + Valkey + object storage

## PostgreSQL (source of truth)

- Nightly `pg_dump -Fc`; reserve WAL archiving (`pgbackrest`/`wal-g`) when RPO demands it.
- Pre-restore safety snapshot first (`pg_dump` before any restore).
- Restore flow: `pg_restore --clean --if-exists` to **staging** → verify
  `alembic heads` single-head + row counts → promote.
- Dumps encrypted at rest (age/sops or provider-side SSE); retention 7-daily / 4-weekly.

## Valkey (sessions/cache — reconstructible)

- AOF already on (`--appendonly yes` in compose) + `valkey_data` volume snapshots.
- Loss impact: forced re-login, no data loss. Treat as P2, not P0.
- Restore = restart with AOF; accept session invalidation as benign.

## Object storage (attachments: local `./storage` now, S3 via boto3 later)

- Local: volume/file backup alongside PG dumps; restore = re-sync + verify
  ownership through owned endpoints only.
- S3 (when adopted): versioned bucket + lifecycle rules; restore from versions.

## RTO/RPO

Propose RTO ≤ 4h / RPO ≤ 24h for self-hosted single-node; orchestrator to
ratify against hosting reality in Wave 3.

## Restore-drill log (quarterly; Agent F cross-refs for incident runbook)

| Date | Operator | Scope (PG/Valkey/storage) | Duration | Result | Follow-ups |
|---|---|---|---|---|---|
| (pending first drill) | | | | | |
