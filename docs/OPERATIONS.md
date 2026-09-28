# ToLLma Operations

How the platform stays healthy and how mail stays safe. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the system layout and
[SECURITY.md](SECURITY.md) for auth/key threat models.

## Provider health strategy

- **Daily validation:** every active provider is re-validated once a day so
  the admin dashboard shows fresh healthy/broken states.
- **Failure-triggered re-validation (throttled):** a provider that errors in
  the gateway path is re-validated out of band; re-validation is throttled
  per provider so a flapping upstream never storms the scheduler.
- Routine interval polling is intentionally avoided: it burns quota and
  pages nobody. Health state changes are emitted as observability events.

## Email safety

All transactional mail flows through one router,
`services/email/service.py::route_email(kind, to, subject, html, text="")`.
Every sender wrapper (verification, password-reset, email-change-notice,
account-deletion-requested, account-deletion-reminder, account-restored,
account-purged, plus the generic `send_email`) delegates to it with a kind
string; wrapper names and signatures are stable so existing call sites and
monkeypatch-based tests keep working.

Safety layers, in order:

1. **Pytest suppression.** When `PYTEST_CURRENT_TEST` is set, the router
   logs `Email suppressed because pytest is active` and captures the message
   to the in-memory `outbox` with the ORIGINAL recipient — zero
   SMTP/network. Capture is not delivery: suites stay fast and hermetic
   (no quota burn, no Gmail limits, no latency flakes), while tests that
   assert via the outbox (e.g. account-deletion mail checks) still see the
   intended recipient, subject, and kind.
2. **Local sandbox routing.** When `settings.environment == "local"`, the
   recipient is replaced with the parsed `smtp_from` address (fallback
   `no-reply@tollma.ai`; no new env vars), and the original (masked) is
   logged alongside the sandbox address. Dev loops can never mail real
   users, even with SMTP configured.
3. **Production delivery.** Any other environment uses the actual recipient
   with the existing SMTP-or-outbox behavior: SMTP when `smtp_host` is set,
   otherwise log + outbox capture (never silently dropped).

Log hygiene: router logs carry masked emails (first char + domain) only —
never tokens or URLs, which live in the bodies that are never logged.

## Scheduled jobs

| Job | Cadence | What it does |
| --- | --- | --- |
| Provider health validation | Daily + failure-triggered (throttled) | Re-validates active providers; failures re-validate out of band |
| Usage rollup | Hourly | Rebuilds usage aggregates for yesterday + today (idempotent upsert) |
| Ops cleanup | Daily | Deletes used or expired password-reset tokens |
| Account deletion | Daily | Sends 7-day / 1-day grace reminders (notice stages 1→2→3), then hard-purges due accounts per-user (failure rolls back that user, writes a failed audit row, continues) |
| Repository sync | 24h | Idempotent model-catalog sync, per-record fault-isolated, lock-guarded |

All jobs are lock-guarded, per-item exception-safe, and skipped under pytest —
a failed job never takes down the process or other jobs. Purge outcomes are
recorded in `PurgeAuditLog` rows (`ok` with per-resource counts, `failed`
with the error); counts also go to the ops log as the audit trail.
