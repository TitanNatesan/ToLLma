# File Ownership Registry (orchestrator-owned, binding)

Second column wins on conflict. Shared files change only through the orchestrator.

```text
docs/legal/**                          Agent A
docs/compliance/legal/**               Agent A
docs/compliance/privacy/**             Agent B
docs/compliance/ai/**                  Agent D
docs/compliance/operations/**          Agent F
docs/compliance/implementation/**      Orchestrator (this dir)
docs/opensource/**                     Agent G
docs/security/devsecops/**             Agent G
docs/security/audit/**                 Agent H

backend/src/tollms/api/legal/**        Orchestrator (spec from A)
backend/src/tollms/models/legal.py     Orchestrator
backend/src/tollms/api/privacy/**      Agent B
backend/src/tollms/models/privacy.py   Agent B
backend/src/tollms/api/security/**     Agent C
backend/src/tollms/models/security_audit.py  Agent C
backend/src/tollms/api/governance/**   Agent D
backend/src/tollms/models/governance.py Agent D
backend/src/tollms/api/incidents/**    Agent F
backend/src/tollms/models/incidents.py Agent F

backend/src/tollms/models/__init__.py  Orchestrator
backend/src/tollms/main.py             Orchestrator
backend/src/tollms/core/**             Orchestrator (proposals from C)
backend/src/tollms/api/orgs/**         Orchestrator (untouched unless asked)
backend/alembic/versions/**            Orchestrator (models input from B/C/D/F)
backend/tests/test_legal*.py          Orchestrator
backend/tests/test_privacy*.py        Agent B
backend/tests/test_security*.py       Agent C
backend/tests/test_governance*.py     Agent D
backend/tests/test_incidents*.py      Agent F
backend/tests/test_audit_*.py         Agent H

frontend/src/app/legal/**              Agent E
frontend/src/app/trust/**              Agent E
frontend/src/components/trust/**       Agent E
frontend/src/app/settings/**           Agent E (existing files: extend, don't rewrite)
frontend/src/app/admin/**              Agent F (new compliance subroutes only, coordinated)
frontend/e2e/trust-*.spec.ts           Agent E
frontend/e2e/trust-security/**         Agent H

docker-compose.yml                      Orchestrator
backend/pyproject.toml                  Orchestrator
frontend/package.json                   Orchestrator
frontend/src/app/layout.tsx             Orchestrator
frontend/src/proxy.ts                   Orchestrator
.github/workflows/trust-security.yml    Agent G
SECURITY.md, NOTICE, THIRD_PARTY_NOTICES.md  Agent G (read current content first; no license change)
LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md  Agent G (review only, no replacement without orchestrator)
```

Rules: check assignment before editing; never touch a shared file; report needed
shared-file changes to the orchestrator with exact diff proposal; never stage/commit.
