# Severity Matrix (MODULE 5)

Reporter-suggested severity is advisory only. Triage assigns the final
severity; the reporter is never told internal SEV handling detail beyond
acknowledgement + resolution notice.

| SEV | Meaning | Examples | Response |
|---|---|---|---|
| SEV1 critical | Active exploitation, RCE, mass PII exfiltration, full outage | Remote code execution, live data breach, auth bypass in prod | Immediate incident, page platform admins, guardrail trigger + request-log linkage |
| SEV2 high | Scoped PII leak, single-tenant compromise, sustained outage | Token leak in logs, one-org data exposure, regional outage | Incident within triage SLA, linked case, admin owner assigned |
| SEV3 medium | Limited-impact bug, policy violation, confirmed vuln without exploit | Reflected XSS in non-auth surface, stale subprocessor DPA | Case queue, fix-or-disclose track |
| SEV4 low | Questions, duplicates, unverifiable claims | Duplicate report, feature request filed as vuln | Close as duplicate/dismissed with reason |

Mapping to guardrail severities: `critical→SEV1, high→SEV2, medium→SEV3,
low→SEV4`. Vuln intake defaults to `medium`; triage re-grades.
Escalation is `under_review` + assignee (abuse, per F7) or `escalated`
(complaints); there is no separate escalated status on incidents — raise
severity instead and note it in the timeline.
