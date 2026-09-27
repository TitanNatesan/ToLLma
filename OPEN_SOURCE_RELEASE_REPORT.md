# Open-Source Release Report — ToLLma

Scope: read-only audit of release readiness. No code or docs were edited and nothing was rebuilt for this report.

## Files created

- `OPEN_SOURCE_RELEASE_REPORT.md` (this file)

## Files modified

- None. Audit was read-only except for writing this report.

## Documentation coverage

Docs present and line-counted:

- `README.md` (169 lines) — overview, providers, install, config, API table, security notes, roadmap summary, license pointer.
- `docs/ARCHITECTURE.md` (131 lines) — implemented V1 layering, gateway, repository, jobs, analytics, security; links to FEATURES, ROADMAP, SECURITY.
- `docs/FEATURES.md` (73 lines) — chat, providers, models, repository, gateway, analytics, shares, attachments, exports, authentication with key endpoints and limits.
- `docs/ROADMAP.md` (33 lines) — V1 implemented list, V1.5 empty, V2 planned, V3 vision. States no dates and that unlisted items are not implemented.
- `docs/SECURITY.md` (27 lines) — reporting channel, supported versions, philosophy, disclosure.
- `docs/CONTRIBUTING.md` (59 lines) — setup, workflow, branches, commits, PR rules, testing.
- `docs/BRAND.md` (43 lines) — name, positioning line, palette, typography, logo rules.
- `docs/FAQ.md` (43 lines) — scope, comparison table, self-host, commercial use, planned-items pointer.
- `landing/README.md` (116 lines) — stack, dev/build, Pages deploy, BASE_PATH, placeholder-link table, section list, constraints.
- Internal notes not linked from README: `docs/admin-architecture.md`, `docs/admin-security-report.md`, `docs/validation-report.md`.

### Link audit (markdown links in `README.md`, `docs/*.md`, `landing/README.md`)

Relative file links checked by resolution against the working tree. All resolve except the badge/placeholder cases below:

- `README.md` → `docs/ROADMAP.md`, `docs/FEATURES.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/SECURITY.md`, `docs/BRAND.md`, `docs/FAQ.md`, `LICENSE`, `NOTICE` — all resolve.
- `docs/ARCHITECTURE.md` → `SECURITY.md`, `FEATURES.md`, `ROADMAP.md` (same-directory) — all resolve to `docs/`.
- `docs/FAQ.md` → `ROADMAP.md` (2 occurrences, link text reads `docs/ROADMAP.md`) — resolves to `docs/ROADMAP.md`; text is misleading but the target exists.
- `landing/README.md` — contains no markdown links; code-span references to `src/lib/site.ts` and `landing/out/` resolve.
- Bare URLs found: `https://github.com/ORG/REPO/...` (README badges, explicitly marked placeholder — see open issues), `https://github.com/TOLLMA/tollma...` (landing README placeholder table), localhost URLs, `http://backend:8000` (README Docker section). No markdown anchor-only links (`](#...)`) were found in the audited set.

Broken / stale references:

1. README badges reference workflows `ci.yml` and `pages.yml` under `ORG/REPO`. The repo contains only `.github/workflows/deploy-pages.yml`; `ci.yml` and `pages.yml` do not exist. The badge block is explicitly marked with a `TODO(org/repo)` HTML comment, so placeholder status is declared but the filenames do not match the actual workflow.
2. README Screenshots section lists `landing/mockups/chat.png`, `providers.png`, `analytics.png`, `admin.png` as code spans marked `*(placeholder)*`. The directory `landing/mockups/` does not exist. The landing site instead renders CSS/SVG mockups from `landing/src/components/screenshots.tsx`, each captioned illustrative. The README paths are stale.
3. The shields.io license badge image URL is an external service URL, not a repo file; the badge target `[LICENSE](LICENSE)` resolves.

## Licensing status

Consistent Apache-2.0 declarations across the checked surfaces:

- `LICENSE` — full Apache-2.0 text with appendix copyright line `Copyright 2026 Titan Natesan`.
- `NOTICE` — names ToLLma, copyright holder, Apache-2.0 pointer, third-party attribution list (Next.js, React, FastAPI, SQLAlchemy, Pydantic, Valkey/redis client, PostgreSQL/psycopg, Tailwind, lucide-react) with a pointer to `backend/pyproject.toml` and `frontend/package.json` as authoritative.
- `README.md` — `## License` section points to `LICENSE` and `NOTICE`; license badge present.
- `docs/FAQ.md` — states Apache-2.0 and commercial-use permission; comparison table lists ToLLma license as Apache-2.0.
- `backend/pyproject.toml` — `license = { text = "Apache-2.0" }` plus `License :: OSI Approved :: Apache Software License` classifier.
- `frontend/package.json` — `"license": "Apache-2.0"`.
- `landing/package.json` — no `license` field; package is `"private": true`. No conflicting license declaration, but the field is absent while the other two manifests declare Apache-2.0.
- Landing UI and README state Apache-2.0 (open-source section, footer `Licensed under Apache 2.0`).

Inconsistency note: `.github/SECURITY.md` (supported-versions table for `0.1.x`) and `docs/SECURITY.md` (latest commit on the default branch only) describe support windows differently. License itself is consistent; support-window wording is not.

## Roadmap-vs-code spot check

V1-implemented claims in `docs/ROADMAP.md` checked against `backend/src/tollms/api/` routers:

- Public gateway — 8/8 endpoints present in `api/public_gateway/router.py`: `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`, `GET /v1/models`, `POST /v1/images/generations`, `POST /v1/images/edits`, `POST /v1/videos/generations`, `GET /v1/me`. Matches README API table, FEATURES gateway section, and ROADMAP public-API line.
- API keys — `api/keys/router.py` covers create, list, read, patch, delete, rotate, policy, ip-rules, model-permissions, and per-key analytics. Matches ROADMAP budgets/rate-limits/IP/per-model/analytics claim.
- Admin — `api/admin/router.py` covers dashboard, api-keys, usage, models, providers, users, costs, tokens, cache, media, errors, health, and `health/stream`. Matches ROADMAP platform-dashboard claim including live health SSE.
- Deletion lifecycle — `api/settings/router.py` has `POST /account/delete-request`; `api/auth/router.py` has `POST /restore` plus signup, verify, resend-verification, login, google login/callback, refresh, logout, me, forgot-password, reset-password validate/reset. `services/jobs/scheduler.py` contains purge logic with 7-day/1-day reminder windows. Matches the 15-day grace/purge claim.
- Provider families — `models/provider.py` defines exactly the 6 documented values (`OPENAI`, `ANTHROPIC_MESSAGES`, `GEMINI`, `VERTEX_AI`, `BEDROCK_CONVERSE`, `CUSTOM`).
- Supporting V1 surfaces present: repository (`stats`, `models`, `lookup`, `sync`, `map`, `sync-history`), attachments (upload, read, content, delete), exports (conversations, analytics, history), shares (CRUD, regenerate, public read), search (search, status). All are named in FEATURES or ROADMAP chat/provider/analytics lines.
- V2 items (organizations, teams, RBAC beyond the admin flag, billing/subscriptions, first-class agents) — no `organizations`, `teams`, or `billing` routers or ORM aggregates were found under `api/` / `models/`. The one `billing` substring hit is an unrelated code comment in `gateway/service.py`. Planned-only status holds.

No promised-but-missing V1 feature was found in the spot check. No implemented-but-undocumented major feature was found; sub-routers (conversations, messages, health, request-logs, analytics_api) fall under documented chat/analytics/gateway areas.

## GitHub Pages readiness

- `landing/out/` exists and contains `index.html` (plus `404.html`, `_next/`, route folders). `next.config.mjs` sets `output: "export"`, `trailingSlash: true`, and `images.unoptimized`, consistent with static hosting.
- `.github/workflows/deploy-pages.yml` — triggers on push to `main` for `landing/**` and the workflow file itself, plus `workflow_dispatch`. Permissions are least-privilege (`contents: read`, `pages: write`, `id-token: write`). Concurrency group `pages` with `cancel-in-progress: true`. Build installs with `npm ci`, builds with `BASE_PATH=/<repo-name>`, uploads `landing/out` via `upload-pages-artifact`, deploys via `deploy-pages`. Paths and steps are sane for a project Pages site.
- Placeholder URLs are centralized in `landing/src/lib/site.ts` (`GITHUB_URL`, `DOCS_URL`, `ROADMAP_URL`, `COMMUNITY_URL`, `LICENSE_URL`, `GET_STARTED_URL`, `IS_PLACEHOLDER_LINKS = true`) and the footer discloses the placeholder state. `landing/README.md` documents the single-file update procedure.
- Gaps: `landing/out/.nojekyll` is absent while the export contains an underscore-prefixed `_next/` directory; the workflow does not create `.nojekyll`. No workflow run was observed in this audit (read-only, no rebuild, no remote run inspection), so end-to-end Pages deployment is untested here.

## Community files (spot check)

- `.github/CODE_OF_CONDUCT.md` — Contributor Covenant with pledge, standards, enforcement responsibilities, and attribution section. Present with required sections.
- `.github/SECURITY.md` — supported-versions table, private reporting path, disclosure process, scope notes. Present; support-window wording differs from `docs/SECURITY.md` (see licensing status).
- `.github/PULL_REQUEST_TEMPLATE.md` — summary, type, related issues, how-to-test, checklist (tests, docs, secrets, migrations). Present.
- `.github/ISSUE_TEMPLATE/bug_report.md` / `feature_request.md` — both present with description/repro/environment and problem/solution/scope sections.
- `.github/FUNDING.yml` — present but fully commented-out placeholder skeleton with no configured accounts; explicitly marked as such in its header comment.
- No root-level `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, or `SECURITY.md`; the canonical content lives in `docs/` and `.github/` and is linked from `README.md`.

## Open issues

1. Real org/repo placeholders: README `ORG/REPO` badges, `landing/src/lib/site.ts` `TOLLMA/tollma` URLs, `NOTICE` `github.com/tollma` line, `.github/SECURITY.md` maintainer-contact placeholder, `FUNDING.yml` unconfigured skeleton. All are explicitly marked as placeholders in comments or UI copy, but none resolve to a real repository.
2. Badge-to-workflow mismatch: README CI badge (`ci.yml`) has no corresponding workflow file; Pages badge (`pages.yml`) does not match the actual `deploy-pages.yml` filename. Fixing requires choosing real filenames alongside the real org/repo.
3. Untested workflow: `deploy-pages.yml` was reviewed statically only. No build, artifact upload, or Pages deployment was executed or observed in this audit. `BASE_PATH` handling for org-site or custom-domain cases is documented but not exercised.
4. Missing `.nojekyll`: `landing/out/` ships `_next/` assets without a `.nojekyll` marker, and the workflow does not add one.
5. Mockups vs real screenshots: README references nonexistent `landing/mockups/*.png` files; the landing site uses labeled CSS/SVG mockups (`UI mockup — illustrative, not a screenshot`) with a `Real screenshots ship with v1`-style panel. No real product screenshots are present.
6. Minor wording divergences: `docs/FAQ.md` link text `docs/ROADMAP.md` pointing at bare `ROADMAP.md` (resolves, text misleading); `.github/SECURITY.md` vs `docs/SECURITY.md` support-window wording; `landing/package.json` missing `license` field.

## Recommendations

- Assign the canonical org/repo, then update in one pass: README badge URLs and workflow filenames, `landing/src/lib/site.ts` constants, `NOTICE` repository URL, `.github/SECURITY.md` contact, and `FUNDING.yml` entries. Keep the single-source pattern for landing links.
- Align badge targets with real workflow filenames (add a CI workflow or drop the CI badge; point the Pages badge at `deploy-pages.yml`).
- Add `.nojekyll` handling for the Pages artifact (either committed at the export root during build or written as a workflow step before upload) given the `_next/` directory.
- Either remove the stale `landing/mockups/*.png` references from README or replace the section with the actual mockup source (`landing/src/components/screenshots.tsx`) until real screenshots exist.
- Reconcile the two security-support statements and add the missing `license` field (or a documented reason for its absence) to `landing/package.json`.
- Exercise the Pages workflow end to end (build, artifact, deployed URL, asset paths under the project subpath) and record the observed result before announcing the public site.
