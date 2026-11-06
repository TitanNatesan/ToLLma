# Privacy Notice (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `privacy-notice` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud; self-host operators should adapt it as their own
  notice (see `selfhost-operator-guide`).
- Type: Binding-as-notice (statutory information duty) · Jurisdiction
  notes: drafted DPDP Act 2023-first; GDPR/UK-GDPR/CPRA/LGPD deltas in
  APPLICABILITY.md.

## 1. Fiduciary identity

Data Fiduciary: `[PLACEHOLDER:COMPANY_NAME]`,
`[PLACEHOLDER:REGISTERED_ADDRESS]`. Privacy contact:
`[PLACEHOLDER:PRIVACY_CONTACT]`. Grievance Officer details are in
`grievance-redressal`.

## 2. Data we collect and why

- Account: email, name (optional), password hash (argon2), OAuth
  identifiers. Purpose: identity, authentication, support. Basis: consent
  at signup + contract performance.
- Credentials you store: provider API keys/tokens, encrypted at rest
  (Fernet, key derived from server secret), masked in every response,
  never logged. Purpose: calling upstream providers on your behalf.
- Content: prompts, attachments, generations. Logging follows your
  retention settings (including zero-retention); see
  `retention-deletion-policy`.
- Operational: request logs, audit events, usage aggregates for billing,
  security, and abuse prevention (login lockout, rate limits).

## 3. What we do NOT collect

Full IP addresses in legal records (truncated/hashed only); document
bodies in acceptance records (hash pin only); dates of birth or ID
documents (age is self-declared, never verified by document).

## 4. Sharing

Upstream model providers receive prompts you route to them (see
`model-provider-disclosure`); subprocessors are listed in
`subprocessor-list`. No sale of personal data. Legal disclosures follow
`law-enforcement-policy`.

## 5. Your rights

Access, correction, erasure, nomination (DPDP), consent withdrawal with
parity of ease, and grievance escalation — exercised via `dsr-procedure`.
Withdrawing functional consent (account data) means account closure.

## 6. Retention and transfers

Retention per `retention-deletion-policy`. Cross-border transfers use
contractual safeguards; transfer destinations are disclosed per DPDP
notification rules once counsel fixes the matrix (L-06).
