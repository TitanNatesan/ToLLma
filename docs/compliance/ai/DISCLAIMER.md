# AI Disclaimer (DRAFT — REQUIRES_LEGAL_REVIEW)

> Do not publish to the Trust Center until Agent A (legal) reviews and the
> orchestrator pins this text to a legal-document version + content hash.

1. **What ToLLma is.** ToLLma is a gateway and control plane over
   third-party AI providers. ToLLma does not train foundation models.
2. **Hallucination.** Model outputs can be inaccurate, incomplete, or
   confidently wrong. Verify independently before acting. Do not rely on
   model output for medical, legal, financial, or safety-critical decisions
   without qualified human review.
3. **Human review.** Automated safeguards (deterministic filters, LLM and
   third-party evaluators) are best-effort and advisory. Documented fail-open
   paths exist; a clean verdict is not a guarantee of safety or correctness.
4. **Outages and degradation.** Upstream provider outages, rate limits, and
   model deprecations propagate to you. Streaming outputs cannot be withheld
   after delivery — post-delivery findings are audit-only. Per-provider
   status pages are linked in the provider registry.
5. **Pricing changes.** Upstream price moves re-sync from the model catalog;
   pre-call estimates may differ from billed actuals. Your organization and
   key spend caps are the enforcement truth, not the estimate.
6. **Third-party dependency and data.** Your prompts and outputs transit
   provider APIs under *their* terms, acceptable-use, privacy, and DPA
   documents (linked per provider in the registry). Data retention and
   training-use posture differ per provider; your organization's
   prompt-logging retention settings control ToLLma-side copies only.
7. **Abuse reporting and appeals.** Anyone may file an abuse report with a
   reason code; reports move through triage (`submitted → under_review →
   action_taken | dismissed`) with exactly one appeal from `action_taken`.
8. **Acceptance.** Use of AI features constitutes acceptance of this
   disclaimer version; material changes re-require acceptance per the legal
   acceptance record.
