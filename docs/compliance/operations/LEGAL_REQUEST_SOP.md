# Legal Request SOP — REQUIRES_LEGAL_REVIEW

> All procedure text here is a technical draft. Nothing in this file is
> legal advice. Counsel must review before any production disclosure.

## Never auto-disclose on claimed authority

No data leaves the platform on the strength of an email, letter, phone call,
or support ticket alone — including claims of law-enforcement, IP-holder, or
regulator status. Intake (`received`) only opens a `verifying` case with
`hold_active=true` (blocks DSR/account purges via
`assert_no_active_hold`). Fulfillment requires ALL of:

1. Identity + authority verified out-of-band (letterhead, case number,
   counsel callback on a known number — checklist below).
2. Scope narrowed to the minimum necessary (named accounts, date range).
3. Dual admin approval: `validated.verified_by != fulfilled.fulfilled_by`
   (enforced in `transition_legal_request`; same-admin fulfill is 422).
4. Audit row per transition (actor, from→to, reason).

## Verification checklist

- [ ] Requesting party identity confirmed (not just the From: header).
- [ ] Authority instrument identified (subpoena / court order / warrant /
      regulatory / takedown / preservation / other) with reference number.
- [ ] Jurisdiction + target scope recorded (`authority_ref`, `claimant`).
- [ ] Counsel looped in before `validated`.
- [ ] Preservation vs disclosure distinguished: preservation only freezes
      deletion (`hold_active`); disclosure additionally needs 2–4.
- [ ] `verify_notes` record who verified what and when (admin-only field).
- [ ] Rejections carry a reason and still pass through `closed` (releases hold).

## State machine

`received → verifying → validated → in_review → fulfilled → closed`,
with `rejected → closed` from any non-terminal state. Terminal `closed`
releases the hold. Link a platform incident when the request reveals or
implies one (`link_incident_id`).
