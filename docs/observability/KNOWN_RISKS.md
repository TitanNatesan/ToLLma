# Observability Known Risks & Deferrals

1. Spans/parent-child hierarchy: NOT implemented (no writers, no tree API). Reserved shape in data-architecture-design §2.7; gate = tool-call persistence writer + tree read API. A `traces` parent table is created only when spans or trace-level aggregation need a join parent.
2. Tags/metadata: NOT implemented (closed schema holds; GIN rule). Gate = named query. Classified: next milestone (P1-deferred), not core-complete.
3. Datasets/experiments/judges: NOT implemented (P3). `experiment_id` subject field reserved.
4. Prompt authoring/links: NOT implemented (no managed prompts; P2).
5. KEK rotation/versioning: NOT in this wave (Trust track owns the rotation op; no partial crypto agility shipped).
6. Spend-control retrofits: `Prices differ silently when repo re-syncs` — mitigated by `pricing_version` pin per row (history never re-prices on read; consumers must group by pin).
7. Session keys are unowned labels (M6): any key holder can tag any session_key in the workspace. No auth impact; do not build trust boundaries on them.
8. Zero-retention fail-closed blackout (M1): DB outage suppresses ALL capture; signal is the log line + Valkey counter + queue drop counters now exposed on GET retention (dropped_full/dropped_error/duplicates/enqueued). No pager configured here.
9. Export audit-fail-closed (M5): ExportEvent write failure → 500 with no download. Availability note.
10. E2E seeded-row coverage blocked: mock egress rejected by SSRF guard (`.internal` hard-rejected), so no seeded-ledger browser test exists; unit + empty-state e2e cover the UI. Unblock = mock egress allowlist (security decision, not taken here).
11. `resolve_retention` org-scope is blind for non-Readers (M3): read-path only; enforcement paths bypass it (documented in configuration-reference).
12. Metadata-forever (Trust-known): ledger rows persist after body expiry; joinable emails retained. Needs GDPR-minimization sign-off (Trust LEGAL_REVIEW_PENDING).
