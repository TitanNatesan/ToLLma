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