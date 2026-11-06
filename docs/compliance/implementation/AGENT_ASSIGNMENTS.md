# Agent Assignments — Wave 1 (analysis, read-only; no production code edits)

- A legal-arch: inventory docs/legal needs; assess existing LICENSE/NOTICE/SECURITY.md/CONTRIBUTING; draft applicability matrix skeleton; report doc list + placeholders. Owns: docs/legal/, docs/compliance/legal/ (analysis notes only in Wave 1).
- B privacy-analysis: inventory PII across models/ (user, provider creds, conversations, messages, attachments, logs, billing), existing exports/deletion/purge_audit/retention triggers; propose consent enum + retention precedence + DSR state machine. No code in Wave 1.
- C security-assessment: review core/security.py, crypto.py, rate_limit.py, sessions, gateway SSRF surface (custom endpoints), headers/CORS/CSP, tenant filters; produce threat model + remediation list. No code in Wave 1.
- D governance-assessment: review services/guardrails + api/guardrails + repository provider metadata; propose provider-policy registry shape + enforcement hook points + abuse-report flow. No code in Wave 1.
- E frontend-assessment: review app/settings, app/admin, components/trust absence, proxy.ts gating, design tokens; propose /legal/* + /trust/* routes + settings extensions. No code in Wave 1.
- F operations-assessment: review api/admin, orgs/audit, requestLogs, exports; propose incident/abuse/legal-request/vendor schemas + admin subroutes. No code in Wave 1.
- G oss-devsecops-assessment: license inventory (pip + npm), existing SECURITY.md/CONTRIBUTING/NOTICE; propose free-tool CI workflow + SBOM approach. May not edit root files in Wave 1 (proposals only).

Shared-file changes: none in Wave 1. All agents: never stage/commit, never touch another owner's paths.
