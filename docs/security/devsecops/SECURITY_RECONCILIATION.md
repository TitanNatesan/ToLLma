# Security-support wording reconciliation (orchestrator decision needed)

Neither file below was edited. Exact diffs as read 2026-11-06.

## Supported versions

- `docs/SECURITY.md`: "Only the latest `0.1.x` release line receives security
  fixes. There are no LTS branches. If you self-host, track the default branch
  and apply updates promptly."
- `.github/SECURITY.md`: table (`0.1.x` ✅, `< 0.1` ❌) + "Pre-1.0 releases move
  fast; only the latest `0.1.x` release line receives security fixes. If you are
  pinned to an older commit, please upgrade before reporting."

Substance agrees (`0.1.x` only); framing differs (track-default-branch vs
upgrade-before-reporting). No contradiction, mild duplication.

## Reporting channel

- `docs/SECURITY.md`: "Contact the maintainers privately (see the repository's
  contact/owner channel…)" — no concrete address.
- `.github/SECURITY.md`: "Use GitHub's **Private vulnerability reporting** on
  the Security tab, or email the maintainer with `[SECURITY]` in the subject
  line. (Set the contact address when the canonical repository org is
  finalized…)" — concrete but placeholder-blocked.

## Disclosure

- `docs/SECURITY.md`: "Once a fix ships on the default branch, we publish a
  brief advisory… Reporters are credited unless they request anonymity."
  Plus a philosophy section (deny-by-default, secrets, fail-safe) with no
  `.github/` counterpart.
- `.github/SECURITY.md`: "We will acknowledge receipt… coordinate a release…
  publish a GitHub Security Advisory." Plus a scope section (in/out of scope)
  with no `docs/` counterpart.

## Recommendation (for orchestrator)

Single-source `docs/SECURITY.md` (it has the philosophy + disclosure detail);
`.github/SECURITY.md` becomes a 10-line pointer (supported-versions table +
"see docs/SECURITY.md" + reporting link once the org/repo contact is real).
Root `SECURITY.md` (new, Agent G) stays a pointer only. Do NOT triplicate
prose — three copies already diverge once.
