# Subprocessor List (DRAFT skeleton)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `subprocessor-list` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud. Public shape per F10: name, purpose, location,
  status. Admin-only fields (`dpa_ref`, assessments) are never public.
- Type: Notice · Jurisdiction notes: locations feed the DPDP transfer
  matrix (L-06). Every row below is a `[PLACEHOLDER]` until procurement
  confirms; do NOT publish with placeholders filled by guesswork.

## Current subprocessors

| Name | Purpose | Location | Status |
|---|---|---|---|
| `[PLACEHOLDER:HOSTING_VENDOR]` | Compute, PostgreSQL, object storage | `[PLACEHOLDER:REGION]` | Proposed |
| `[PLACEHOLDER:EMAIL_VENDOR]` | Transactional email (verification, resets, notices) | `[PLACEHOLDER:REGION]` | Proposed |
| `[PLACEHOLDER:MODEL_PROVIDER_1]` | Upstream inference (customer-routed) | `[PLACEHOLDER:REGION]` | Proposed |
| `[PLACEHOLDER:ERROR_TRACKING]` | Crash diagnostics (no prompt content) | `[PLACEHOLDER:REGION]` | Proposed |

## Change policy

Additions or region changes are notified `[PLACEHOLDER:NOTICE_PERIOD]`
in advance via product notice and DPA channel; material objections
permit termination without penalty. Version history of this list is
retained (archived versions stay retrievable, never edited in place).

## What subprocessors never receive

Full API key secrets (only SHA-256 hashes exist server-side), provider
credential plaintext (Fernet-encrypted blobs are never exported to
vendors), and document bodies underlying legal acceptances (hash pins
only). Email delivery necessarily receives recipient addresses and
message content of transactional mails; crash diagnostics receive
stack traces and IDs, never prompts, attachments, or credentials.
