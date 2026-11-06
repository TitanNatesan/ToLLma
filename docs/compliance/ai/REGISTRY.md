# Provider-Policy Registry (Module 4)

## Record shape (F8, frozen)

`provider_policies.provider_key, scope{global|organization}, org_id?,
display_name, terms_url, aup_url, privacy_url, dpa_url, status_page_url,
commercial_use_allowed?, training_on_inputs{no|opt-in|opt-out|yes|unknown},
retention_summary?, retention_days?, dpa_available, region_pinning_available,
last_reviewed_at?, review_cadence_days=180, source_notes?, is_active`.

- `provider_key` is the `ProviderType` value (`OPENAI`, `ANTHROPIC_MESSAGES`,
  `GEMINI`, `VERTEX_AI`, `BEDROCK_CONVERSE`, `CUSTOM`) so registry rows join
  naturally to `providers.provider_type`.
- Partial uniques: `(provider_key)` where `scope='global' AND is_deleted=false`;
  `(provider_key, org_id)` where `scope='organization' AND is_deleted=false`.
- Indexes: `(provider_key)`, `(org_id)`, `(last_reviewed_at)`.

## Seed method

`ensure_seed_policies()` inserts one global row per `ProviderType` family on
first registry read (idempotent, never rewrites). All URL/legal fields seed as
NULL with `source_notes="unverified - hand seed, curator review required"`.
Missing upstream field = NULL, never fabricated. A curator (platform admin)
fills URLs from the provider's published legal pages; each edit should set
`last_reviewed_at` to the verification date.

## Review cadence

A row is **stale** when `last_reviewed_at IS NULL` or
`today - last_reviewed_at >= review_cadence_days` (default 180).
`GET /api/v1/governance/provider-policies/stale` lists overdue rows visible to
the caller. The admin UI (Agent E) surfaces a staleness badge from the
`stale` field on every read.

## Access control (Wave 2, interim)

- Reads: any verified active user. Global rows visible to all; org rows only
  to ACTIVE members of that org (404-oracle otherwise); platform admins see all.
- Writes (create/update/delete, global + org): **platform admin only**.
- Wave 3 tightening (orchestrator): introduce `Governance.*` permission codes
  so org admins can curate their own org overrides without platform admin.
