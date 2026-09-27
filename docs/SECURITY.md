# ToLLma Security Policy

> The Open Source AI Gateway for Models and Agents.

## Reporting a Vulnerability

- **Do not open a public issue** for suspected vulnerabilities.
- Contact the maintainers privately (see the repository's contact/owner channel; `.github/` workflows and contact points are managed alongside the release process).
- Include: affected version/commit, reproduction steps, impact assessment, and any suggested mitigation.
- Expect an acknowledgment and triage prioritized by severity; we will coordinate disclosure timing with you before any public advisory.

## Supported Versions

Only the latest `0.1.x` release line receives security fixes. There are no LTS branches. If you self-host, track the default branch and apply updates promptly — especially auth, session, and gateway changes.

## Philosophy

- **Deny by default**: unauthenticated requests get 401; unauthorized or unverified access gets 403 (including `EMAIL_VERIFICATION_REQUIRED` and `ACCOUNT_PENDING_DELETION` gates).
- **Secrets stay secret**: API keys stored as SHA-256 hashes (shown once at creation); provider credentials encrypted at rest, masked in every response, never cached, never logged.
- **Fail safe on money**: budgets fail closed (403 before any provider call, no overage); rate limits fail open on cache outage so availability degrades gracefully.
- **Fail safe on identity**: refresh rotation with reuse detection revokes families; login lockout and auth rate limiting blunt brute force; OAuth uses PKCE + single-use state binding.
- **Least exposure**: platform admin sees aggregates only — never message content, prompts, attachments, or credentials; public share payloads exclude user and credential data.
- **No fabricated trust signals**: analytics and health surfaces report "not tracked"/unknown rather than inventing data.

## Disclosure

Once a fix ships on the default branch, we publish a brief advisory describing the issue, affected scope, and the fix commit. Reporters are credited unless they request anonymity. Full V1 security posture (verification gate, rate limiting, session hardening, key security, OAuth hardening, observability) is covered by permanent regression tests in the backend suite.
