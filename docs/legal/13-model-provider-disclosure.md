# Third-Party Model Provider Disclosure (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `model-provider-disclosure` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Both (any deployment routing to upstream providers).
- Type: Notice · Feeds the Agent D provider-policy registry (F8);
  unverified fields stay NULL/`"unverified"`, never fabricated.

## 1. What happens to your prompts

When you select an upstream model, your prompt (and attachments/context
you include) is sent to that provider for inference under the
provider's terms, privacy policy, and retention practice summarized
below. Your stored ToLLma credentials are never sent anywhere except to
authenticate with the provider you chose.

## 2. Provider summary (all rows DRAFT — Agent D verifies per F8)

| Provider | Terms | Training on inputs | Retention | DPA available |
|---|---|---|---|---|
| `[PLACEHOLDER:PROVIDER_A]` | `[PLACEHOLDER:URL]` | `[PLACEHOLDER:unknown until verified]` | `[PLACEHOLDER]` | `[PLACEHOLDER]` |
| `[PLACEHOLDER:PROVIDER_B]` | `[PLACEHOLDER:URL]` | `[PLACEHOLDER:unknown until verified]` | `[PLACEHOLDER]` | `[PLACEHOLDER]` |

## 3. Your controls

Choose providers per request; set prompt-logging and zero-retention per
workspace (org policy overrides personal; most-restrictive wins); rotate
or revoke stored credentials at any time — revocation is immediate and
irreversible. Provider changes upstream are tracked in the Agent D
registry; material changes to this disclosure are versioned, never
edited silently, and re-acceptance applies only if counsel deems the
change binding (F1 MAJOR rule).
