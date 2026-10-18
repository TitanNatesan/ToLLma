# Backend Layer Rules (`backend/src/tollms`)

Three layers. Dependencies flow one way:

```text
api/*/router.py
    ↓
api/*/service.py          (feature/application service: CRUD, orchestration, validation)
    ↓
services/*                (reusable backend engines: adapters, sync, lookup, costing)
    ↓
models/* + db/*           (ORM entities, session, Base)
```

`core/` (config, crypto, deps, exceptions) is importable from any layer.

---

## `api/` — feature packages

One package per API feature: `conversations/`, `providers/`, `models/`,
`repository/`, `gateway/`, `health/`, `auth/`, `orgs/`, `keys/`.

Each feature package holds `router.py`, `schemas.py`, `service.py`
(`health` is router-only). A `service.py` inside `api/` is a
feature/application service — it owns that feature's CRUD, orchestration,
and validation, and composes engines from `services/`.

Large domains split into subpackages: `api/orgs/{overview,members,teams,
permissions,providers,keys,budgets,requests,invitations,analytics,audit}/`
(each with `router.py` + `service.py` + `schemas.py` only where justified —
no empty placeholders), `api/orgs/common/` (genuinely shared guards/audit
used by 3+ domains), `api/keys/analytics.py`, `core/{passwords,sessions,
dependencies}.py`. Thin compat facades (`api/orgs/service.py`,
`core/security.py`) re-export moved names for existing importers; new code
imports from the owning submodule directly.

Rules:

- `router.py`: FastAPI endpoints only. No business logic, no direct
  `services.*` engine imports, never touches the database.
  Top-level routers compose domain routers (`router.include_router(...)`)
  and keep the package prefix/tags; `main.py` stays one bare
  `include_router` line per package. Root `""` paths stay on the parent
  router (nested empty-path includes raise at startup).
- `service.py`: business logic + database access. May import other
  `api.*` feature services and anything under `services/`.
  Must not contain route definitions or low-level adapter implementations.
  Keep lazy (function-level) imports wherever a top-level import would
  cycle — orgs↔providers/models laziness is load-bearing on both sides.
- `schemas.py`: request/response models + DTOs. May import enums from
  `models/` (e.g. `ProviderType`), never ORM classes. Domain schemas import
  directly from `auth`/`keys`/`providers.schemas` — never sibling domain
  submodules.
- No ORM model class may be defined inside `api/`.
- No new top-level feature package without a router + service + schemas trio
  (no `utils.py` until two callers need it).
- No `common/` dumping ground: shared code lives in `common/` only with
  3+ real domain callers; single-domain helpers colocate with their domain.
- No wildcard imports; no router imports from services (one-way: routers →
  services → engines); `common/` and engines never import routers or
  `tollms.main`.
- Moves are verbatim first, behavior second: preserve paths, methods,
  status codes, error bodies (404-oracle), per-endpoint Depends, and
  response models. Verify with OpenAPI diff (paths/methods/params equal)
  plus focused tests before deleting originals.

## `services/` — reusable backend engines

ONLY engine/infrastructure code consumable by multiple APIs:

```text
services/
├── cache/                client.py, manager.py, keys.py, constants.py,
│                         decorators.py, locks.py, serializers.py, metrics.py
├── email/                service.py, templates/ (verification today; resets/invites later)
├── gateway/            adapters/, factory.py, costing.py
└── model_repository/   sync.py, lookup.py, mapping.py, sources.py,
                         canonical.py, scheduler.py
```

## Auth / ownership

- `core/security.py` owns passwords (argon2), JWTs (HS256 access 15m /
  refresh 30d, both carrying `sid`), Valkey sessions (`session:{sid}`),
  and `get_current_user` (Bearer or httpOnly cookie + live session check).
- Every router except `health` and `auth` requires `get_current_user`.
- User-owned tables (`providers`, `conversations`, `messages`) carry
  nullable `user_id`; every service function takes `user_id` and filters
  by it (None = unscoped, tests/service use only). Cross-owner access
  returns 404, never 403 (no existence oracle).
- Provider names are unique per `(user_id, name)` among live rows.

Rules:

- Keyed by **engine**, never by feature. `services/providers/`,
  `services/models/`, `services/conversations/` are forbidden — that logic
  belongs in `api/*/service.py`.
- Must never import from `api/` or `tollms.main` (no layer inversion).
  Engine-to-engine imports inside `services/` are fine.
- No scaffolding: no `storage/`, `workers/`, `notifications/`, `shared/`
  until real code needs a home.
- Precedent — the repository is two engines + one feature service:
  `services/model_repository/sync.py` (fetch/merge/store engine),
  `services/model_repository/lookup.py` (match/suggest/stats queries),
  `api/repository/service.py` (thin feature service re-exporting engine
  functions so routers only touch `api/`).

## `models/` — ORM entities

One module per table group: `conversation.py`, `message.py`, `provider.py`,
`registered_model.py`, `model_repository.py`. No ORM classes anywhere else.

- `models/__init__.py` imports every entity module (aggregate import).
  `alembic/env.py` imports only `tollms.models` — never add per-module
  imports there again.
- Every DB object created by a migration must be declared in metadata,
  including partial indexes
  (e.g. `Index(..., postgresql_where=text(...))`), so that
  `alembic check` stays green.

## Model Catalog Source Policy

Models.dev is the sole external source of model catalog metadata. Do not
introduce LiteLLM, OpenRouter, or another external model catalog source for
model discovery, pricing, capabilities, or synchronization. New model metadata
requirements must first be evaluated against the official Models.dev schema
(`https://models.dev/api.json`). Keep catalog metadata separate from provider
credentials, provider-specific model registration, runtime adapters, and
authorization. Missing upstream fields must not be fabricated.

## Invariants (CI-verifiable)

- No `tollms.modules` package and no `tollms.modules.*` imports anywhere.
- `docker compose exec backend pytest -q` passes (currently 683 tests).
- `docker compose exec backend alembic check` reports no operations.
- Every API module independently maintainable: no giant service files,
  no giant routers, no circular imports.
- `python -c "from tollms.main import app; app.openapi()"` succeeds with no
  duplicate (path, method) registrations after any router move.
