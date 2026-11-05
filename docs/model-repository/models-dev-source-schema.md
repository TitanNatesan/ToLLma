# Models.dev Source Schema

Models.dev is the sole external source of ToLLma model-catalog metadata.
Verified against live responses (`?type=all`, sanitized examples below).
Runtime inference adapters (OpenAI, Anthropic, Gemini, Bedrock, Custom) are a
separate concern and are unaffected by this document.

## Endpoints and responsibilities

| Endpoint | Top level | Entries | Contributes |
|---|---|---|---|
| `GET https://models.dev/api.json?type=all` | object keyed by provider slug (232) | provider objects with nested `models` dict | Provider scoped offerings: per-provider model IDs, pricing, limits, modalities, capabilities, reasoning options |
| `GET https://models.dev/models.json?type=all` | object keyed by canonical full id (559) | canonical model objects, **no cost** | Provider-agnostic canonical metadata: identity, family, capabilities, limits, dates |
| `GET https://models.dev/catalog.json?type=all` | `{providers, models}` | byte-identical to api.json + models.json | Redundant combination. Fetched only as a consistency check (provider/model counts); its data is never used |
| `GET https://models.dev/logos/{provider-id}.svg` | SVG | — | Provider logo; `{provider-id}` is the exact api.json provider slug |

`?type=all` includes specialized model types omitted by default (api.json: 9099
vs 9048 entries with no parameter; provider count identical at 232).

## api.json provider entry (abridged, sanitized)

```json
{
  "id": "anthropic",
  "env": ["ANTHROPIC_API_KEY"],
  "npm": "@ai-sdk/anthropic",
  "name": "Anthropic",
  "doc": "https://docs.anthropic.com/",
  "models": {
    "claude-haiku-4-5": {
      "id": "claude-haiku-4-5",
      "name": "Claude Haiku 4.5 (latest)",
      "description": "...",
      "family": "claude-haiku",
      "attachment": true,
      "reasoning": true,
      "reasoning_options": [{ "type": "budget_tokens", "min": 1024 }],
      "tool_call": true,
      "structured_output": true,
      "temperature": true,
      "knowledge": "2025-02-28",
      "release_date": "2025-10-15",
      "last_updated": "2025-10-15",
      "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
      "open_weights": false,
      "limit": { "context": 200000, "output": 64000 },
      "cost": { "input": 1, "output": 5, "cache_read": 0.1, "cache_write": 1.25 },
      "canonical_model_id": "anthropic/claude-haiku-4-5"
    }
  }
}
```

Notes:

- Model dict keys are **provider-scoped IDs** (`claude-haiku-4-5`), not full IDs.
  Gateway-style providers (e.g. `nano-gpt`) nest third-party ids verbatim.
- `canonical_model_id` present on ~68% of entries and always resolves into
  models.json when present. Absent on ~32% — those associations stand alone
  (`canonical_id NULL`); identity is never guessed from display names.
- `cost` is **$/1M tokens** (stored per-token; converted on ingest). Observed
  dimensions: `input`, `output` (always together when present), `cache_read`,
  `cache_write`, `reasoning`, `input_audio`, `output_audio`, `tiers`,
  `context_over_200k`. Only the first six map to columns; the rest go to
  `extra_cost` JSONB. Missing cost = unavailable (NULL), never zero-filled.
- `limit` is `{context, output}` (majority) or `{context, input, output}`.
  `max_input_tokens` = `limit.input` when present, else `limit.context`.
- `reasoning_options` is polymorphic:
  - `{type: "effort", values: ["low","medium","high","xhigh","max"]}` (any subset; `none` only when listed)
  - `{type: "budget_tokens", min: 1024}` (optional `max`)
  - `{type: "toggle", ...}` (on/off; `default` honored when supplied)
  - Stored verbatim as JSONB; frontend renders each type dynamically.
- `modalities.input/output` string lists (`text`, `image`, `pdf`, `video`, `audio` observed).

## models.json canonical entry (abridged)

Same model fields **minus `cost` and `canonical_model_id`**, keyed by full id
(`bytedance-seed/seed-2.0-pro`). Every api.json `canonical_model_id` observed
resolves here.

## Logo convention

`https://models.dev/logos/{provider-id}.svg` where `{provider-id}` is the exact
api.json top-level slug (e.g. `anthropic`, `amazon-bedrock`). Stored as
`provider_catalog.logo_url`; frontend `ProviderLogo` falls back gracefully when
a logo is missing (no fake URLs are constructed for unverified IDs).

## Reconciliation decisions

- `model_repository` rows are provider-model associations keyed
  `model_key = {provider-slug}/{provider-scoped-id}` (canonicalized
  separators/case; never rewritten — registered models link via this string).
- `canonical_model` rows come from models.json keyed by entry id.
- Association → canonical link is set only when the entry's
  `canonical_model_id` resolves into the synced canonical set, else NULL.
- Canonical disappearance never deletes associations and never deactivates
  repository rows (FK `ON DELETE SET NULL`; sync never deletes canonicals).
- Empty merge (all endpoints failed or anomalous) changes nothing except sync
  bookkeeping — the last-known-good catalog stays servable.
- `catalog.json` mismatch (counts differ from api.json+models.json) logs a
  warning and records it in the run's error details; its payload is discarded.
