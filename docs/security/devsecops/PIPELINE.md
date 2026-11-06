# Trust Security Pipeline (§9)

Workflow: `.github/workflows/trust-security.yml`. Separate name, file,
triggers, and concurrency group from `deploy-pages.yml` — neither workflow
can block, cancel, or consume the other's permissions or environments.

## Job table

| Job | Tool | Trigger | Gate | Notes |
|---|---|---|---|---|
| `gitleaks` | gitleaks-action@v2 | PR + push main + weekly + dispatch | BLOCKING (any finding) | Full history (`fetch-depth: 0`); `.env` never committed (git-verified) |
| `semgrep` | semgrep-action@v1 (`config: auto`) | same | NON-BLOCKING first cycle (`continue-on-error` + SARIF) | Becomes blocking on ERROR after baseline tuned |
| `osv` | `pip install osv-scanner` + `uv export` | same | BLOCKING on HIGH/CRITICAL **with fix available** | Backend via frozen `uv export` (parser-proof); frontend via `package-lock.json` |
| `trivy` vuln+secret | trivy-action, `fs`, `vuln,secret` | same | BLOCKING on HIGH/CRITICAL | `skip-dirs`: node_modules,.next,landing/out,.venv,graphify-out |
| `trivy` misconfig | trivy-action, `config` | same | NON-BLOCKING (SARIF, `exit-code: 0`) | Dockerfile hardening tracked as proposals, not PR failures |
| `license-check` | pip-licenses + license-checker (ephemeral) | same | BLOCKING on blocklist; freshness `--check` NON-BLOCKING | Blocklist = LICENSE_POLICY.md; LGPL skipped before `gpl` match |

Permissions: `contents: read` globally; `security-events: write` only on
`semgrep` and `trivy` (SARIF upload). No `pages`/`id-token` scope requested.

## Why semgrep is non-blocking first cycle

A fresh `auto` ruleset on this codebase is *expected* to fire on known,
accepted patterns: `allow_methods=["*"]` CORS (`main.py`), `debug=` flag
passthrough, broad `except` in job guards. Blocking day-one would red main
on informational findings. Policy: observe one cycle → triage into
wontfix-with-reason or fix → then flip `continue-on-error` off for ERROR
severity only. Same logic for trivy misconfig (root-user dev Dockerfiles
are a known, separately-tracked hardening item).

## Threshold rationale

- Secrets: zero tolerance (leak = rotate + rewrite history guidance).
- SCA: HIGH/CRITICAL **with fix** blocks; without fix → advisory + triage
  owner/date (blocking on unfixable = blocking all progress).
- MEDIUM and below: PR summary only.
