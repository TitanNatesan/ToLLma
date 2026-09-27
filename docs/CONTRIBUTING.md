# Contributing to ToLLma

> The Open Source AI Gateway for Models and Agents.

## Setup

```bash
cp .env.example .env        # fill in SECRET_KEY, POSTGRES_PASSWORD, provider OAuth/SMTP as needed
docker compose up -d --build
# frontend: http://localhost:3000 · backend: http://localhost:8000
```

Backend package name is `tollms` (do not rename). Frontend lives under `frontend/src/`.

## Workflow

1. Read `.opencode/rules/workflow.md` first, then the layered guides (`database.md`, `backend.md`, `frontend.md`, `test.md`, `docker.md`, `coding-standards.md`). Rule priority is workflow → database → backend → frontend → test → docker → coding-standards.
2. Keep the layering: routers thin → API services → `services/` engines → `models/`. Services never import from `api/`.
3. Never ship TODO implementations, hacks, duplicated business logic, or untested code.

## Branches

- Short-lived feature branches off the default branch (`feat/<area>-<slug>`, `fix/<slug>`, `docs/<slug>`).
- One concern per branch; rebase over the latest default branch before opening a PR.

## Commits

- Small, reviewable commits with imperative subjects (`Add …`, `Fix …`, `Refactor …`).
- Reference the requirement in the body when the change implements spec'd behavior.

## PR Rules

- Describe: requirement, implementation summary, files changed, architecture notes.
- Prove verification (see below) with pasted results — backend suite counts, `tsc`, `eslint`, `vitest`, Playwright where touched, `alembic check` for schema changes.
- Schema changes require a single-head Alembic migration and a green `alembic check`.
- Every completed task appends one entry to `.opencode/memory.md` (never edit or delete prior entries).

## Testing

Run the targeted suites for what you changed; run the full suites before merge.

```bash
# backend (inside compose or local venv)
python -m pytest -q                 # full suite
python -m pytest -q tests/keys tests/public_gateway   # targeted example
alembic check                       # required after any migration

# frontend
npx tsc --noEmit
npm run lint
npx vitest run
npx playwright test                 # e2e (needs the live stack + mock server)
```

## Review Expectations

- Reviewers check: layering, no fabricated data (surfaces render "not tracked" over fake numbers), secrets hygiene (mask, encrypt, never log), idempotency where retries exist, and cache invalidation for every new cached read.
- Two green signals required: automated verification (tests/typecheck/lint/build) and a human review of the architecture notes.
- Pre-existing failures must be proven pre-existing (e.g. via `git stash`) — never silently "fixed" by weakening assertions.
