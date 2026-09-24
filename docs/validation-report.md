# Provider & Endpoint Validation Report

Generated: 2026-09-22 · ToLLma V1 provider refactor (endpoint-aware model architecture)

## Live validation run — 2026-09-23 (real OpenAI key + user's OpenWebUI gateway)

Executed through the app: headed Playwright UI flow (`e2e/live-openai.spec.ts`) for provider registration and chat/vision/reasoning,
plus gateway-level adapter probes for the non-chat endpoints (`backend/storage/live-test/live_openai.py`).

| Model | Endpoint | Probe | Result |
| --- | --- | --- | --- |
| gpt-4.1-nano | `chat_completions` | text → text ("Say Hello") | PASS |
| gpt-4.1-nano | `chat_completions` + image part | image → text (Ben 10 Omnitrix PNG) | PASS — "This is a symbol of the Omnitrix from the animated series Ben 10" |
| gpt-image-1 | `images/generations` | 2× low quality | PASS (1.1 MB, 1.2 MB PNG @1024²) |
| gpt-image-1 | `images/generations` | 2× medium quality | PASS (1.6 MB, 1.3 MB PNG @1024²) |
| gpt-image-1 | `images/generations` | 1× high quality | PASS (1.6 MB PNG @1024²) |
| gpt-5-mini | `responses` | reasoning summary + answer | PASS — Reasoning UI showed "Thought for <1s" with 64 reasoning tokens; answer "4" |
| gpt-oss-120b | — | text → text | FAIL (account) — `model_not_found`: the key does not have access to this model |
| sora-2 | `video/generations` | text → video (4s, 1280x720) | PASS (1,045,183 bytes MP4 in 76s) |
| sora-2 | `video/generations` | image → video (4s, 1280x720, 512² reference upscaled) | PASS (1,236,131 bytes MP4 in 86s) |
| OpenWebUI · glm-4.7-flash:latest | `chat_completions` (custom) | text → text | PASS |
| OpenWebUI · ucx0204/glm-4.6V-Flash-Q8:latest | `chat_completions` (custom) | text → text | PASS |
| OpenWebUI · qwen3-coder:30b | `chat_completions` (custom) | text → text | PASS |

Notes from the live run:

- `video/generations` was added to the OpenAI adapter family (create → poll → download) so Sora 2 is routable; the endpoint
  vocabulary already carried it, so no schema/enum migration was needed.
- Two bugs were found and fixed while validating:
  1. `draft-validate` did not propagate the repository-resolved endpoint onto discovered items, so `gpt-image-1` initially
     registered as `chat_completions`; the resolution now mirrors discovery and the model was repaired to `images/generations`.
  2. The Responses adapter did not request reasoning summaries (`reasoning.summary`), so no reasoning text streamed even
     when the model used reasoning tokens; `summary: "auto"` was added.
- The wizard selects every discovered model by default (134 for a full OpenAI account) — deselect all before picking models.

Approximate live spend for this run: images ≈ $0.27 (5 × gpt-image-1 at low/medium/high), Sora 2 ≈ $0.80–1.00 (2 × 4s 720p),
chat/reasoning ≈ fractions of a cent. OpenWebUI calls were against the user's own gateway.

## In-UI media generation (2026-09-23)

`/generate` (removed 2026-09-24 — generation is chat-native; the debug `POST /api/v1/media/images|videos` routes are gone) ran image and video generation through the same
endpoint-aware adapter factory and stores results as attachments. Verified full-screen headed Playwright
(`e2e/live-media.spec.ts`, 2 passed in 2.9m):

| Flow | Model | Result |
| --- | --- | --- |
| text → image, low quality | gpt-image-1 | PASS — PNG rendered in the UI |
| text → video, 4s 1280x720 | sora-2 | PASS — 1.49 MB MP4, 58s, player rendered in the UI |
| image → video, 4s 1280x720 + 512² reference | sora-2 | PASS — 1.73 MB MP4, 84s (reference auto-normalized to 1280×720) |

Constraints and fixes discovered while testing in the UI:

- **Video duration**: the OpenAI Videos API only accepts `seconds` = **4, 8, 12**; a 1-second request is rejected with
  `Invalid value: '1'. Supported values are: '4', '8', and '12'.` The UI therefore offers 4/8/12 and the 4s minimum is used.
- **Reference image must match the requested size**: the provider rejects mismatched references
  (`Inpaint image must match the requested width and height`); the video adapter now cover-crops/resizes the reference
  to the requested WxH (Pillow, already present via fpdf2, now a declared dependency).
- **Transient DNS during polling**: a single `getaddrinfo` failure mid-job (observed after ~30s) used to 500 the whole
  generation; video create/poll/download now retry transport errors with backoff, and provider failures map to 502
  instead of an unhandled 500.
- **`/api/v1/models` omitted endpoint fields**: the models router built `ModelRead` by hand and dropped
  `primary_endpoint`/`supported_endpoints`/`supports_embeddings`; fixed, which is what lets the chat composer discover
  the media-capable models.

## Unified chat media generation (2026-09-23)

Image and video generation now run through the conversation pipeline (`/c/{id}`), streamed as assistant progress and stored as conversation attachments. Verified headed with a real key (`e2e/live-chat-media.spec.ts`):

| Check | Result |
| --- | --- |
| `/` → auto-created conversation at `/c/{id}` | PASS |
| Image prompt streamed "Generating image…" then rendered in-chat | PASS |
| Refresh: same URL, image restored, no duplicate assistant row | PASS |
| Video prompt produced an inline video player | PASS |
| Retry on a failed media message regenerated in place (same prompt/model, 12.4s) | PASS |
| Message metadata persisted (`generation_type/status/model/provider/quality/size/filename`) | PASS |

Routing regressions (`generation`, `navigation`, `auth`, `settings`): 15/15. Video duration floor is 4s (API-supported: 4/8/12 only).

## Media viewer, cost intelligence & prompt caching (2026-09-24)

Unified media viewer, aligned media cards, generation skeletons, official OpenAI cost estimation (actual usage wins), provider-aware prompt caching, and repository-sourced capabilities/rate cards. No paid generation was performed: validation used mock transports, existing generated assets, and a free repository re-sync.

| Check | Result |
| --- | --- |
| Unified `MediaViewer` (24px blur backdrop, 90vw/90vh, single toolbar, zoom/fit/1:1/download/close) on existing generated images | PASS |
| Video opens directly in the viewer on click (no separate fullscreen button), native controls + duration/resolution/size | PASS |
| Media cards capped at 512px (image) / 720px (video), centered, filename·resolution·size·cost inside one card | PASS |
| Skeletons: 512×512 image / 16:9 video, shimmer + indeterminate progress, live state label, crossfade into the card | PASS (component + prior live run) |
| Official image prices (gpt-image-1 0.011/0.042/0.167; gpt-image-2 0.006/0.053/0.211) and video rates (sora-2 $0.10/s; sora-2-pro $0.30/$0.50/$0.70/s) | PASS |
| Actual provider usage overrides estimates (image API `usage`; sora per-second) — mocked image with usage stored $0.1667 as actual | PASS |
| Prompt caching: OpenAI cache key, Anthropic system + conversation breakpoints, Bedrock Claude cache point, Gemini/Vertex/Custom implicit; unsupported = byte-identical body | PASS |
| Repository sync derives capability flags and seeds media prices from the official rate card | PASS (live re-sync: `openai/gpt-image-1`, `openai/gpt-image-2`, `sora-2`, `sora-2-pro`) |

Backend suite: **254 passed / 0 failed**. Frontend: `tsc`/`eslint` clean, `vitest` **119/119**. Headed Playwright (`e2e/`, all non-live specs): see "Tests passed / failed" below.

## How validation runs

| Suite | Command | Scope |
| --- | --- | --- |
| Automated matrix (always on) | `docker compose exec -T backend python -m pytest tests/test_validation_matrix.py tests/test_endpoints.py -q` | Every endpoint kind through the gateway dispatcher, mocked transport, zero API cost |
| Live probes (opt-in) | `docker compose exec -T backend python scripts/validate_endpoints.py --live --report docs/validation-report.md` | Cheapest model per family, 16 max output tokens, 1x1 PNG, lowest-quality image, <1s audio |
| Plan only | `docker compose exec -T backend python scripts/validate_endpoints.py` | Prints the probe plan and credential availability without network calls |

The live suite is deliberately tiny: chat prompts are `Say Hello` capped at 16 output tokens, vision sends a
1x1 PNG with `What do you see?`, image generation asks for `green circle` at the lowest quality and a single
image, embeddings embed `hello`, transcription sends 0.3s of silence, and speech synthesizes `hello`.

## Provider coverage

| Provider | Transport | Probes | Status |
| --- | --- | --- | --- |
| OpenAI (`OPENAI`) | `chat_completions`, `responses`, `embeddings`, `images/generations`, `audio/transcriptions`, `audio/speech` | chat, responses, vision, embeddings, images, transcriptions, speech | Mock matrix PASS · live SKIPPED (no `OPENAI_API_KEY`) |
| Anthropic (`ANTHROPIC_MESSAGES`) | `messages` | chat, vision | Mock matrix PASS · live SKIPPED (no `ANTHROPIC_API_KEY`) |
| Google Gemini (`GEMINI`) | `chat_completions` | chat, vision | Mock matrix PASS · live SKIPPED (no `GEMINI_API_KEY`) |
| Vertex AI (`VERTEX_AI`) | `chat_completions` | chat, vision | Mock matrix PASS · live SKIPPED (no `VERTEX_*` credentials) |
| AWS Bedrock (`BEDROCK_CONVERSE`) | `converse` | chat | Mock matrix PASS · live SKIPPED (no AWS credentials) |
| Custom / OpenAI-Compatible (`CUSTOM`) | `responses`, `chat_completions`, `embeddings`, `images/generations`, `audio/*` | chat, responses, embeddings | Mock matrix PASS · live SKIPPED (no `CUSTOM_BASE_URL`) |

Mock matrix result: **8/8 passed** (`tests/test_validation_matrix.py`) plus **10/10** endpoint-routing and
repository-metadata tests (`tests/test_endpoints.py`).

## Endpoint coverage

| Endpoint | Routing | Mock matrix |
| --- | --- | --- |
| `responses` | `OpenAIResponsesAdapter` / custom base URL | PASS (`Hello`, usage accounted) |
| `chat_completions` | `OpenAIChatAdapter` / custom base URL | PASS (`Hello`, streaming SSE parsed) |
| `messages` | `AnthropicAdapter` (fixed family) | PASS (adapter discovery/routing) |
| `converse` | `BedrockAdapter` (fixed family) | PASS (adapter discovery/routing) |
| vision (chat + image part) | `chat_completions` content parts | PASS (image part on the wire) |
| `embeddings` | `OpenAIEmbeddingsAdapter` / custom | PASS (vector returned) |
| `images/generations` | `OpenAIImagesAdapter` / custom | PASS (1 image, lowest quality, bytes returned) |
| `audio/transcriptions` | `OpenAIAudioTranscriptionsAdapter` / custom | PASS (multipart file → text) |
| `audio/speech` | `OpenAIAudioSpeechAdapter` / custom | PASS (bytes returned) |
| `video/*` | accepted by the endpoint vocabulary, no adapter yet | SKIPPED (future work) |

## Tests passed / failed

- Full backend suite: **254 passed / 0 failed** (adds cost estimator, prompt caching, media cost, repository capabilities).
- Frontend: `vitest` **119/119**, `tsc`/`eslint` clean.
- Headed Playwright (`e2e/`, non-live specs; live specs auto-skip): full runs pass 59–61 specs, with occasional environment flakes (Docker stack restarts mid-run, screenshot protocol errors). After the final draft-send fixes the affected suites pass with `--retries=0`: `settings`+`history`+`generation`+`conversation-intelligence` **18/18**, `live-draft-media`+`manage`+`reasoning-selector`+`settings` **12/12**.

## Estimated cost

- Mock matrix and repository tests: **$0.00** (no network).
- Live suite (when credentials are provided): chat probes are capped at 16 output tokens on the cheapest
  model of each family, vision uses a 1x1 PNG, one lowest-quality image, one short embedding, one second of
  audio and a two-word speech request. Expected total: **fractions of a cent per full run**.

## Missing features

- Video generation/understanding endpoints are represented in the vocabulary (`supported_endpoints`) but have
  no adapter yet.
- Embeddings, image and audio endpoints are reachable through the gateway dispatcher and adapter layer but do
  not yet have dedicated REST routes or product UI (chat remains the only user-facing flow).
- Fixed-endpoint families (Anthropic, Gemini, Vertex, Bedrock) reject non-chat endpoints rather than
  translating them; Gemini/Vertex embeddings would be the first natural addition.
- Live validation requires operator-provided credentials; CI runs the mock matrix only.

## Recommendations

1. Run `scripts/validate_endpoints.py --live` with production keys before enabling any new provider family;
   the report is written to the path passed to `--report`.
2. Add Gemini/Vertex embeddings behind the existing `embeddings` endpoint when an embeddings feature lands.
3. When video arrives, add `video/generations` to the adapter map only — no schema or enum migration needed,
   because endpoint metadata is TEXT/JSONB.
4. Keep the mock matrix in CI; it catches routing regressions at zero cost and covers every endpoint kind the
   backend claims to support.
