# Requirement Completion Matrix (condensed; full text in module docs)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| P0 | Legal doc registry + hash versioning | VERIFIED | test_legal_age (4) + 20 seeded rows |
| P0 | Acceptance ledger (append-only, idempotent) | VERIFIED | same; H audit 11/11 |
| P0 | 18+ gate (signup/Google/legacy) | VERIFIED | backend tests + auth.spec checkbox |
| P0 | Consent categories + withdrawal | VERIFIED | 7 consent tests |
| P0 | Retention enforcement + zero-retention | VERIFIED | 7 retention tests + resolution hook |
| P0 | DSR export (full-account) + erasure | VERIFIED | 10 DSR tests + H purge test |
| P0 | Credential encryption at rest | VERIFIED | pre-existing Fernet + H masked/rotation tests |
| P0 | Tenant isolation (all trust domains) | VERIFIED | H 11/11 isolation tests |
| P0 | SSRF destination validation | VERIFIED | H SSRF 422 battery |
| P0 | Security headers (CSP/HSTS/XFO/RP/PP) | VERIFIED | live curl + H tests |
| P0 | Central security audit log | VERIFIED | 7 audit tests |
| P0 | Provider policy registry | VERIFIED | 5 policy tests (advisory noted) |
| P0 | Abuse reporting + transitions | VERIFIED | 6 abuse tests |
| P0 | Incident/legal-request workflows | VERIFIED | 26 incident tests |
| P0 | Secret/SAST/dep/container/license CI | IMPLEMENTED | workflow created, first run pending |
| P0 | Trust Center + privacy/security UI | VERIFIED | 315 vitest + 26 e2e |
| P1 | 20 legal drafts | IMPLEMENTED | REQUIRES_LEGAL_REVIEW |
| P1 | JWT secret split | VERIFIED | config test + full suite |
| P1 | Legal-hold purge gate | VERIFIED | H hold test |
| P1 | KEK rotation API | IMPLEMENTED | status endpoint; rotation op deferred |
| P1 | MFA | NOT_STARTED | deferred, tracked |
| P1 | Admin compliance UI | VERIFIED | 6 sections, e2e gated |
| P1 | SBOM generation | IMPLEMENTED | generator + plan; per-release artifacts pending |
| P1 | Backup/restore procedure | IMPLEMENTED | docs only; drill pending |
| P1 | Vuln disclosure process | IMPLEMENTED | docs + intake API; contact provisional |
| P2 | Jurisdiction matrix evidence | IMPLEMENTED | APPLICABILITY skeleton, counsel pending |
| P2 | Gateway denylist enforcement | DEFERRED_WITH_APPROVAL | hook points documented |
| P2 | Public legal/trust routes | DEFERRED_WITH_APPROVAL | gated until counsel approves text |
| P0fix | H1 purge ledger completeness | VERIFIED | 60/60 re-run |
| P0fix | M1 credential_security keys | VERIFIED | same re-run |

`IMPLEMENTED` = code/docs exist, tests green where applicable. `VERIFIED` = integration-tested end to end.
Nothing is marked complete without evidence above.
