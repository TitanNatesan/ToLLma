# Data Subject Rights (DSR) Procedure (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `dsr-procedure` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud. Implemented by Agent B's DSR state machine (F5);
  displayed by Agent E.
- Type: Notice · Jurisdiction notes: DPDP rights (access, correction,
  erasure, nomination, grievance) first; GDPR portability/restriction and
  CPRA deletion deltas in APPLICABILITY.md.

## 1. Rights and self-service

Access/export and correction: in-product settings and export endpoints.
Erasure: account deletion (15-day grace, then purge incl. backup-window
expiry). Nomination (DPDP): designate a nominee via
`[PLACEHOLDER:NOMINATION_CHANNEL]` — process defined post-counsel (L-04).

## 2. Filing a request

In-product privacy request form, or `[PLACEHOLDER:PRIVACY_CONTACT]` with
account email + request type (`access|correction|erasure|portability|
grievance`). State machine: submitted → under_review → in_progress →
fulfilled | partially_fulfilled | rejected (rejections carry a reason
code). Default SLA: 30 days (`due_at`); DPDP grievance clocks may be
shorter and run in parallel.

## 3. Identity verification

We verify control of the account email (fresh login or verification
link) before disclosing or deleting — the same re-auth pattern as
password reset and account restore. Requests for another person's data
require legal authority; agent/nominee requests require proof of mandate.

## 4. Limits

We may partially fulfil or reject where the law permits: legal holds
(disclosed to the extent allowed), other principals' data severed rather
than disclosed, and repeated manifestly-unfounded requests answered
once with reasons. Rejections are appealable via `grievance-redressal`.
