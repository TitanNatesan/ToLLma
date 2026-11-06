# Law Enforcement & Legal Requests (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `law-enforcement-policy` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud. Consumed by the Agent F legal-request workflow.
- Type: Notice · Jurisdiction notes: India process (CrPC/BNSS, IT Act
  blocking orders) vs foreign process (MLAT) distinguished only after
  counsel review (L-15).

## 1. Valid process required

We disclose user data only on valid, binding legal process (warrant,
court order, or statute-backed demand). Informal or foreign requests
without domestic effect are declined or redirected to MLAT channels.

## 2. User notification

We notify the affected user before disclosure unless prohibited by a
gag/non-disclosure order or a court seals it; delayed notification
follows once the prohibition lifts. Emergency disclosures (imminent
harm) are narrowly scoped and logged.

## 3. Scope minimization

Disclosure is limited to the named accounts, time ranges, and data
classes ordered; overbroad requests are challenged or narrowed in
writing. Admin-aggregate-only architecture means content is frequently
not available to disclose — we state that factually.

## 4. Preservation and reporting

Preservation requests suspend scheduled purges for the named scope only
(see `retention-deletion-policy` legal holds). Aggregate counts appear
in the `transparency-report`; we never confirm or deny the existence of
non-public orders beyond what the report states.
