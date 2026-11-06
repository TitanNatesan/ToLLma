# Requirements Register (condensed; full matrix in REQUIREMENT_COMPLETION_MATRIX at release)

P0: legal acceptance API+table; 18+ eligibility gate; consent categories+withdrawal;
retention enforcement incl. zero-retention; DSR export/delete across PG/object/Valkey/Qdrant/ARQ;
credential encryption at rest (existing Fernet) + rotation/revocation API + no secret exposure;
tenant isolation (org/user/key/conversation/export/log); distributed rate limits + spend caps;
SSRF private/loopback/link-local/DNS-rebinding/redirect protection; centralized security audit log;
provider policy registry + enforcement hooks; abuse reporting; incident/legal-request workflows;
secret/SAST/dependency/container/license CI gates; Trust Center + privacy/security settings UI.
P1: 20 legal drafts; privacy notices; cookie consent; subprocessor registry; DPA draft;
vuln disclosure process; admin compliance UI; SBOM; backup/restore procedure.
P2: jurisdiction applicability matrix evidence; vendor assessments; SLA draft; Community vs Cloud matrix.
Legal-uncertain items are marked REQUIRES_LEGAL_REVIEW, never marked complete without counsel.

Statuses: NOT_STARTED | ANALYZING | READY | IN_PROGRESS | IMPLEMENTED | TESTING | VERIFIED | BLOCKED | REQUIRES_LEGAL_REVIEW | DEFERRED_WITH_APPROVAL
