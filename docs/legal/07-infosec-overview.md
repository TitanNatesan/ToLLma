# Information Security Overview (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `infosec-overview` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Both (describes the shared codebase controls).
- Type: Notice — FACTUAL DESCRIPTION ONLY. We claim NO certification
  (no ISO 27001, SOC 2, or similar) until an independent audit says
  otherwise. Any certification language added later requires evidence.

## 1. Identity and access

Passwords: argon2 hashes. API keys: SHA-256 hashes, shown once at
creation. Sessions in Valkey with JWT access (~15 min) / rotating
refresh (~30 days); refresh reuse revokes the family; login lockout plus
auth rate limiting blunt brute force. Google OAuth uses PKCE with
single-use bound state. Tenant isolation: user/org-owned rows filtered by
owner; cross-owner access returns 404 (no existence oracle).

## 2. Data protection

Provider credentials encrypted at rest (Fernet from server secret),
masked in every API response, never cached, never logged. Email addresses
masked in logs. Legal acceptance records store truncated/hashed network
identifiers, never full IPs. Platform admin sees aggregates only — never
message content, prompts, attachments, or credentials.

## 3. Abuse and spend safety

Budgets fail closed (403 before provider spend); rate limits fail open on
cache outage for availability. Egress controls block private/loopback/
link-local targets and DNS-rebinding/redirect tricks. Guardrails evaluate
deterministic, LLM, moderation, and evasion signals with enforcement and
notification hooks.

## 4. Disclosure posture

Analytics and health surfaces report "not tracked"/unknown rather than
inventing data. Vulnerabilities: see `coordinated-disclosure`. Security
events feed a centralized audit log with hashed identifiers.
