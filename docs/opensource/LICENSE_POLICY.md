# License Policy — ToLLma (Apache-2.0 project)

Project license is Apache-2.0 and stays Apache-2.0. This policy governs
**dependency** licenses only. Enforced by the `license-check` job in
`.github/workflows/trust-security.yml` (blocking on blocklist).

## Allowlist (no review needed)

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, PSF-2.0 / Python-2.0,
PostgreSQL Licence, CC0-1.0, Unlicense, UPL-1.0.

## Review list (allowed with attribution + recorded justification)

LGPL-2.1/3.0, MPL-2.0, EPL-1.0/2.0, CDDL-1.0.

Current review-list member: `psycopg[binary]` (LGPL-3.0) — used as a
dynamically-linked database driver (standard compliant pattern), attributed
in NOTICE and THIRD_PARTY_NOTICES.md. No code change required. Any NEW
review-list dependency needs a one-line justification in the PR + a
THIRD_PARTY_NOTICES.md regeneration.

## Blocklist (CI fails the PR)

GPL-2.0/3.0, AGPL-3.0, SSPL, Commons Clause, BUSL, any PROPRIETARY terms
without a vendored exception note. Rationale: copyleft/SSPL terms conflict
with Apache-2.0 redistribution. LGPL is explicitly NOT blocklisted
(see review list; the CI check skips `lgpl` before matching `gpl`).

## Adding a dependency

1. Check its license on PyPI/npm first; blocklist → pick an alternative.
2. Review-list → add PR justification + regenerate notices.
3. Regenerate: `bash docs/opensource/generate-third-party-notices.sh`.
4. CI re-verifies; human reviewer confirms the policy section of the PR.
