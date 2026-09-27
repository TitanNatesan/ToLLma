# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

Pre-1.0 releases move fast; only the latest `0.1.x` release line receives
security fixes. If you are pinned to an older commit, please upgrade before
reporting version-specific issues.

## Reporting a vulnerability

**Do not open a public issue for a suspected security vulnerability.**

Instead, report it privately:

1. Use GitHub's **Private vulnerability reporting** on the Security tab, or
2. Email the maintainer with `[SECURITY]` in the subject line.
   (Set the contact address when the canonical repository org is finalized —
   see the placeholder comment at the top of `README.md`.)

Include, where possible:

- A description of the vulnerability and its impact
- Steps to reproduce or a minimal proof of concept
- Affected version/commit and environment (backend/frontend, Docker or local)
- Any relevant logs (redact secrets: API keys, tokens, credentials)

## Disclosure process

- We will acknowledge receipt as promptly as possible.
- We will investigate, prepare a fix, and coordinate a release.
- We ask reporters to keep the issue confidential until a fix and advisory
  are published, and we will credit reporters who wish to be acknowledged.
- Once fixed, we will publish a GitHub Security Advisory describing the issue,
  affected versions, and the patched release.

## Scope notes

In scope: authentication, authorization, secret handling (API keys, JWTs),
input validation, injection risks, dependency vulnerabilities in this repo's
first-party code and configuration.

Out of scope (please still report if exploited through ToLLma): vulnerabilities
in upstream model providers, browsers, or third-party infrastructure itself.

Thank you for helping keep ToLLma and its users safe.
