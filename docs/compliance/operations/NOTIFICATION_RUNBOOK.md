# Notification Runbook (MODULE 5)

Reuses `services/guardrails/notify.py` semantics; no new notifier was built.

- Dedupe per case per repeat window in Valkey (`incidents:notify:{id}:{bucket}`,
  default 1/hour); email additionally capped (≤1 per 5 minutes per case).
- Recipients: platform admins for platform cases; org roots (≤10) only when
  the case is org-attributed. Reporters get acknowledgement + resolution
  notice for their own report only.
- Bodies carry kind/title/ids/status only — never prompts, report details,
  reporter contact, secrets, or outputs (same redaction rule as guardrails).
- Every fan-out writes one row to Agent C's security audit log
  (`config.security_changed`, reason `...status_changed:from->to`); audit
  failure never fails the request — the timeline entry is durable.
- Recovery/closure notice is a one-shot after the terminal transition.
