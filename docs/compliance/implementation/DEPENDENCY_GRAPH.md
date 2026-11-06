# Dependency Graph

```text
A (legal docs inventory + 20 drafts + applicability matrix)
 └─> Orchestrator: api/legal + legal_acceptances (needs doc versions/hashes from A)
 └─> E: /legal/* pages render A's drafts; registration acceptance posts to orchestrator API

B (privacy: consent, retention, DSR, export/delete)
 ├─> needs A: retention policy text, DPA roles (controller/processor)
 ├─> needs existing: api/exports, purge_audit, prompt-logging retention
 └─> E: settings UI consumes B's APIs

C (security: hardening, audit log, SSRF, headers, rate limits)
 ├─> independent of A/B/D; audit-log table consumed by F (incidents reference it)
 └─> needs orchestrator: core/* and main.py wiring

D (governance: provider registry, enforcement, abuse reports)
 ├─> builds on existing services/guardrails + api/guardrails (reuse, don't replace)
 └─> F: abuse reports flow D -> F review queue (interface agreed in Wave 2)

F (incidents, legal requests, vendors, complaints, vuln reports)
 └─> needs C: security-audit-log reference format; needs A: legal-request procedure text

G (OSS + DevSecOps)
 └─> independent; free tools only (gitleaks, semgrep, osv-scanner/syft, trivy); no paid gates

H (audit)
 └─> runs last on integrated tree; blocks release on P0/P1
```

Wave 2 interfaces to freeze before coding: legal-document version identifier
format (A -> orchestrator/E); consent-category enum (B -> E); audit-event
envelope (C -> F); abuse-report status enum (D -> F); provider-policy record
shape (D -> E admin UI).
