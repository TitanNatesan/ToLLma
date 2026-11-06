# Acceptable Use Policy (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `acceptable-use-policy` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud. Self-host operators: adapt for your deployment.
- Type: Binding (incorporated by the Terms) · Jurisdiction notes:
  India-first; unlawful-content categories follow Indian law plus the law
  of the operator's jurisdiction once counsel fixes L-11.

## 1. Prohibited uses

- Unlawful content or conduct, including CSAM, terrorism facilitation,
  and non-consensual intimate imagery — zero tolerance, reported as
  required by law.
- Harming the service: prompt-injection at scale, credential theft,
  scraping or quota/billing abuse, evading guardrails or rate limits,
  probing other tenants' data.
- High-stakes automated decisions (credit, employment, housing, essential
  services) without meaningful human oversight.
- Impersonation, spam, or violating upstream provider terms passed
  through in `model-provider-disclosure`.

## 2. Enforcement ladder

Warn → rate-limit → suspend → terminate, proportionate to severity and
recurrence. Zero-tolerance categories skip to suspension/termination with
preservation for legal process. Gateway denials and over-budget blocks
are technical enforcement, not disciplinary findings.

## 3. Appeal

Decisions may be appealed once via the abuse/grievance channel with the
report ID; appeals are reviewed by staff not involved in the original
action where feasible. Abuse-report states follow the frozen 7-state
contract (submitted → … → dismissed / action_upheld / action_reversed).
