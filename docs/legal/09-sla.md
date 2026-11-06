# Service Level Agreement (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `sla` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud paid tiers only. Community: no SLA (best effort).
- Type: Binding once counsel approves targets (L-14) — until then treat
  all numbers below as PROPOSALS, not commitments.

## 1. Proposed targets (NOT commitments yet)

- Availability: `[PLACEHOLDER:UPTIME_PCT]`% monthly, measured at the API
  edge, excluding scheduled maintenance windows (announced
  `[PLACEHOLDER:MAINT_NOTICE_HOURS]`h ahead) and upstream provider outages.
- Support response: per `support-policy` tiers.

## 2. Credits (proposal)

Service credits of `[PLACEHOLDER:CREDIT_PCT]`% of affected monthly fees
per full `[PLACEHOLDER:CREDIT_GRANULARITY]` below target, capped at
`[PLACEHOLDER:CREDIT_CAP]`%. Credits are the sole remedy for SLA misses.

## 3. Exclusions

Customer-caused outages, revoked/expired provider credentials, over-budget
denials (fail-closed by design), force majeure, beta features marked
as such, and any Community self-hosted deployment.

## 4. Measurement and claims

Availability is measured at the API edge per calendar month; scheduled
maintenance announced `[PLACEHOLDER:MAINT_NOTICE_HOURS]`h ahead is
excluded. Credit claims must be filed within `[PLACEHOLDER:CLAIM_DAYS]`
days of the affected month with request IDs; approved credits apply to
the next invoice. Status history is published at
`[PLACEHOLDER:STATUS_URL]` and is the evidentiary record for disputes.
