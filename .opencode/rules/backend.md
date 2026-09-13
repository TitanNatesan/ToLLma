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
`repository/`, `gateway/`, `health/`.

Each feature package holds `router.py`, `schemas.py`, `service.py`
(`health` is router-only). A `service.py` inside `api/` is a
feature/application service — it owns that feature's CRUD, orchestration,
and validation, and composes engines from `services/`.

Rules:

- `router.py`: FastAPI endpoints only. No business logic, no direct
  `services.*` engine imports, never touches the database.
- `service.py`: business logic + database access. May import other
  `api.*` feature services and anything under `services/`.
  Must not contain route definitions or low-level adapter implementations.
- `schemas.py`: request/response models + DTOs. May import enums from
  `models/` (e.g. `ProviderType`), never ORM classes.
- No ORM model class may be defined inside `api/`.
- No new top-level feature package without a router + service + schemas trio
  (no `utils.py` until two callers need it).

## `services/` — reusable backend engines

ONLY engine/infrastructure code consumable by multiple APIs:

```text
services/
├── gateway/            adapters/, factory.py, costing.py
└── model_repository/   sync.py, lookup.py, mapping.py, sources.py,
                        canonical.py, scheduler.py
```

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

## Invariants (CI-verifiable)

- No `tollms.modules` package and no `tollms.modules.*` imports anywhere.
- `docker compose exec backend pytest -q` passes (currently 36 tests).
- `docker compose exec backend alembic check` reports no operations.
- Every API module independently maintainable: no giant service files,
  no giant routers, no circular imports.
