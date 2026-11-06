# Known Risks

1. Counsel review outstanding on all legal text (LEGAL_REVIEW_PENDING.md) — nothing publishable to production.
2. CI workflow never run — first `trust-security.yml` run may surface semgrep/trivy advisories (expected non-blocking first cycle).
3. MFA absent; JWT single-key (rotation deferred); no edge flood guard (C2 deferred) — residual auth-abuse surface documented in SECURITY_AUDIT_REPORT.md.
4. Legal hold is global (M2) — a single hold pauses all purges; erasure-SLA risk if holds linger.
5. Provider registry is advisory — no gateway block on provider legal posture (needs product decision).
6. Third-party provider terms never verified — F8 rows ship `unverified` until curators confirm; commercial-use claims must not be made.
7. Backup/restore is procedure-only — no drill evidence; RTO/RPO unratified.
8. Dev-only states that must not be mistaken for prod: legal docs published on dev DB; dev-owner backfill user; probe signup user.
9. Turbopack dev panic (env-only, prod build green); Valkey-15 test coupling (serial discipline required).
