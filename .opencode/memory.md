# ToLLms Project Memory

## Project Creation

Date:
Initial architecture established.

## 2026-09-12 - Local development foundation

Requirement: initial repo structure only; no business features, AI providers, chat, or auth.
Implemented: backend FastAPI foundation (src/tollms: api/core/db/modules/services,
/health + /health/ready, pydantic-settings from .env, SQLAlchemy 2.x UUID base model),
Alembic foundation (env.py reads DB URL from settings), frontend Next.js TS foundation
(health page SSR via BACKEND_URL, /api-test client page via NEXT_PUBLIC_API_URL,
components/hooks/services/lib/types), dev Dockerfiles with hot reload, compose wiring
(frontend hot-reload volume, BACKEND_URL=http://backend:8000), .env.example, scripts/dev.sh.
Rules validated: workflow.md gained autonomous-completion exception (was contradicting
AGENTS.md loop); docker.md clarified localhost policy (browser/healthcheck OK, container
traffic uses service names); root AGENTS.md references frontend/AGENTS.md instead of
duplicating the Next.js auto-managed block. Kept frontend under src/ (matches frontend.md
and existing scaffold) instead of target's root-level app/.
Verification: docker compose up clean; postgres healthy; backend /health ok,
/health/ready database reachable; frontend /, /health, /api-test all 200 with SSR backend
status ok; alembic current/history load against Postgres; pytest 2 passed.
Note: Docker Desktop daemon was paused; used native dockerd via DOCKER_HOST=default context.
Decision: no DATABASE_URL in .env — backend builds it from POSTGRES_* parts (single source).

## 2026-09-12 - Docker build time and performance optimization

Requirement: optimize frontend and backend docker build time for faster and performance-efficient builds; resolve port binding collision from native dockerd and ensure services run on Docker Desktop.
Root causes identified:
1. Missing .dockerignore in frontend/ caused Docker to transfer 550MB+ (node_modules and .next) on every build context upload and package it into image layers.
2. In frontend/Dockerfile, lack of BuildKit npm cache mount and use of unoptimized `npm install` instead of `npm ci --prefer-offline`.
3. In backend/Dockerfile, `COPY src/ ./src/` invalidated dependency caching layer on every source change; lack of BuildKit uv cache mount and missing `uv.lock`.
4. Compose healthchecks had 15s/10s intervals with no start_period, slowing down compose orchestration checks.
Implemented:
1. Created `frontend/.dockerignore` excluding node_modules, .next, .git, etc.
2. Created `backend/.dockerignore` excluding .venv, __pycache__, pytest caches, etc.
3. Created root `.dockerignore` for repo-level builds.
4. Optimized `frontend/Dockerfile` with `RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund`.
5. Generated `backend/uv.lock` and optimized `backend/Dockerfile` with two-stage caching (install dependencies first via `uv sync --frozen --group dev --no-install-project`, then copy src and install package) with `--mount=type=cache,target=/root/.cache/uv`.
6. Tuned `docker-compose.yml` healthchecks with `start_period: 2s` and `interval: 3s` and added consistent restart policy.
Verification:
- Build time reduced from ~43.3s down to 1.9s - 2.5s (over 94% speedup).
- Build context transfer dropped from ~80MB+ to under 250KB.
- Clean compose up -d --build completes with exit code 0.
- All services healthy (postgres, backend, frontend).
- Backend /health, /health/ready and frontend /health, / endpoints return 200 OK.
- pytest passes 2/2 in backend container.