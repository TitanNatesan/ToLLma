# Coordinated Vulnerability Disclosure (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `coordinated-disclosure` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Both (Cloud service + open-source codebase).
- Type: Notice · Promotes `docs/SECURITY.md` to formal policy; safe-harbor
  wording needs counsel sign-off before it protects anyone.

## 1. Reporting

Contact `[PLACEHOLDER:SECURITY_CONTACT]` privately — never open a public
issue for suspected vulnerabilities. Include: affected version/commit,
reproduction steps, impact assessment, suggested mitigation. Expect
acknowledgment within `[PLACEHOLDER:ACK_DAYS]` days and triage by severity.

## 2. Scope and rules

In scope: the hosted service, this repository's default branch,
authentication/session handling, gateway and credential paths. Out of
scope: social engineering, physical attacks, third-party providers.
Do not access other tenants' data, degrade the service, or retain data
beyond what proves the issue; delete it after reporting.

## 3. Safe harbor (counsel must approve)

Good-faith research complying with this policy will not result in legal
action by us, and we will advocate that position to third parties. This
paragraph is INOPERATIVE until counsel confirms it.

## 4. Disclosure and credit

Fixes ship on the default branch with a brief advisory (issue, scope,
fix commit). Reporters are credited unless they request anonymity.
Supported versions: latest `0.1.x` line only unless stated otherwise.
