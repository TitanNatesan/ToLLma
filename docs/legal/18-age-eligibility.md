# Age Eligibility Policy (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `age-eligibility` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud.
- Type: Binding-notice · Jurisdiction notes: 18+ uniform baseline;
  stricter local thresholds (if any) per APPLICABILITY.md. Gate method
  sufficiency is L-03.

## 1. 18+ only

The service is not directed at children and has no child-directed
content or features. You must be 18 or older to register or use the
service, including via organization invitations (invited minors' seats
are the inviting organization's compliance breach, not ours, and the
account is removed on discovery).

## 2. The gate (actual product behavior)

Password signup and Google signup both require an unchecked-by-default
"I am 18 or older" confirmation plus Terms acceptance; missing
confirmation fails the request (422 `AGE_CONFIRMATION_REQUIRED`). The
Google path withholds the session until confirmation via a short-lived
pending token — no persistent row for unconfirmed users.

## 3. What we store (data minimisation)

A timestamp (`age_confirmed_at`) and method (`self_declaration`) only.
We do NOT collect dates of birth or identity documents. Legacy accounts
predating the gate re-confirm once at login via banner; unconfirmed
accounts cannot use features (same pattern as the email-verification
and pending-deletion gates).

## 4. Discovery of underage use

Report via `[PLACEHOLDER:LEGAL_CONTACT]` or the grievance channel;
verified underage accounts are suspended, exported to the holder or
guardian on valid request, then deleted.
