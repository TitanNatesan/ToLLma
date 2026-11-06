# Responsible AI Use Policy (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `responsible-ai-use` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Both (Cloud users and self-host operators deploying to
  others).
- Type: Notice + binding reference (Terms/AUP incorporate it).

## 1. Human oversight

Do not use model outputs as the sole basis for high-stakes decisions
(credit, employment, education, housing, legal, medical, or access to
essential services) without qualified human review. You own the decision
whatever the model suggested.

## 2. Provider pass-through

Upstream providers impose their own usage policies (linked in
`model-provider-disclosure`). Routing through ToLLma does not exempt you
from them; violations may be enforced upstream and downstream.

## 3. Transparency to your users

If you serve model outputs to third parties, disclose AI involvement
where the law or context requires it, and honor opt-outs for solely
automated processing where applicable (GDPR Art. 22-type rights; DPDP
grievance path via `dsr-procedure`).

## 4. Built-in mitigations (what the product does)

Deterministic + LLM + moderation + evasion-signal guardrails with staged
enforcement, prompt-logging controls including zero-retention, and
per-key budgets that fail closed. These reduce risk; they do not make
outputs correct, and must not be presented as guarantees.
