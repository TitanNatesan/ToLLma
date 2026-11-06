# Compliance Operations (MODULE 5, Agent F)

Wave 2 implementation. Intake + review for incidents, legal requests,
vulnerability reports, complaints, and the subprocessor registry.
Abuse-report intake/table/PATCH stay with Agent D (F7) — F reads D's queue.

- Statuses: `SEVERITY_MATRIX.md` (triage), `NOTIFICATION_RUNBOOK.md`,
  `LEGAL_REQUEST_SOP.md` (REQUIRES_LEGAL_REVIEW), `VULN_DISCLOSURE.md`,
  `SUBPROCESSOR_PROCESS.md`, `ADMIN_UI_SPEC.md` (Agent E, Wave 3).
- Backend: `backend/src/tollms/api/incidents/` (router/schemas/service) +
  `backend/src/tollms/models/incidents.py`. No `abuse_reports` duplicate;
  no `abuse_review_notes` side table (F7 conflict resolved: notes live in
  D's table — default chosen, D agreed via freeze).
- Audit: transitions emit C `record_event` as `config.security_changed`
  with `reason=<domain>.status_changed:from->to` until dedicated
  `incident.*` event types are minted (Wave 3, orchestrator).
- Deletion engines must call `assert_no_active_hold` before any hard purge.
