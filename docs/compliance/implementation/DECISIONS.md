# Decisions

- 2026-11-07: Apache-2.0 stays (existing LICENSE). G reviews, does not replace. Community vs Cloud distinction documented, not new licensing.
- 2026-11-07: Layered backend rules binding (api trio, no tollms.modules, models aggregate import, alembic check green). New domains are api/ feature packages.
- 2026-11-07: Reuse before build: guardrails engine, Fernet crypto, Valkey limiter, exports service, org audit, purge_audit are extended, never forked.
- 2026-11-07: Free DevSecOps tooling only; no paid gates. Severity thresholds defined in Wave 2.
- 2026-11-07: No git staging/committing by any agent; work stays in working tree for human review.

## 2026-11-07 (Wave 3, orchestrator)
- F3 Google path: session-withholding replaced by server-side feature gate (require_active_user 403 AGE_CONFIRMATION_REQUIRED until POST /auth/confirm-age). Enforcement equal for all feature routers; no short-TTL pending-token machinery. Client checkbox is UX only.
- /legal + /trust stay behind the session gate (proxy.ts untouched) until counsel approves publishing DRAFT docs. Public exposure deferred, not rejected.
- record_event failure inside legal acceptance is warn-and-continue (acceptance is evidentiary; audit write retries via central log, never blocks the user flow).
- Legal-hold gate is global (any live hold defers all purges) — conservative fail-closed; per-case scoping deferred.
- Parallel pytest runs must use distinct VALKEY DBs, not just distinct PG DBs: conftest pins VALKEY_DB=15 for every run, so overlapping `docker compose run pytest` invocations flush each other's sessions. Full-suite failures from overlap are environmental. TOLLMS_TEST_DB isolates PG only.
- SidebarAdmin untouched: E's admin page renders its own ComplianceNav; appending the 6 sections to the shared sidebar would double-list. Revisit if nav unifies.
- SETTINGS_SECTIONS extended with privacy/retention/cookies/data-rights (orchestrator) so hash nav + useHashSection cover E's new cards.
