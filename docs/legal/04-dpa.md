# Data Processing Addendum (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `data-processing-addendum` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud B2B (organization customers). Community n/a.
- Type: Binding · Jurisdiction notes: DPDP-first; GDPR Art. 28 clauses to
  be appended as an annex by counsel (L-05, L-11).

## 1. Roles

Customer is Data Fiduciary (controller) for prompts and end-user data it
routes; we act as Data Processor on documented instructions (your API
calls and dashboard settings). For account/identity data we are an
independent fiduciary under the Privacy Notice.

## 2. Scope and instructions

Processing is limited to: gateway routing, guardrail evaluation, logging
per your retention settings (including zero-retention, which
short-circuits capture), billing metering, and support subject to access
controls. Admin views are aggregates only — never message content,
prompts, attachments, or credentials.

## 3. Confidentiality and security

Fernet-encrypted provider credentials, SHA-256-hashed API keys, argon2
passwords, masked responses, tenant-isolated queries (cross-owner access
returns 404). See `infosec-overview` for the factual control baseline.

## 4. Sub-processing

Subprocessors listed in `subprocessor-list` (public shape per F10:
name, purpose, location, status). We notify customers of changes with
`[PLACEHOLDER:NOTICE_PERIOD]` to object; unresolved objections permit
termination without penalty.

## 5. Assistance, audit, return/deletion

We assist with principal-rights requests within `[PLACEHOLDER:SLA_DAYS]`
days, support audits via reports and (on enterprise plans) supervised
reviews, and on termination return exports then purge per
`retention-deletion-policy`, including backup expiry.

## 6. Breach notification

We notify affected customers without undue delay and within
`[PLACEHOLDER:BREACH_NOTICE_HOURS]` hours of confirming a personal-data
breach, with nature, categories, mitigation, and contact point.
