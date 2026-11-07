# Observability — File Ownership (orchestrator-owned, binding)

```text
docs/observability/langfuse-capability-inventory.md   Agent 1 (general, research)
docs/observability/backend-gap-audit.md               Agent 2 (backend, read-only Phase 1)
docs/observability/workspace-configuration-design.md  Agent 3 (general, read-only)
docs/observability/frontend-gap-audit.md              Agent 4 (frontend, read-only)
docs/observability/data-architecture-design.md        Agent 5 (db, read-only)
docs/observability/security-gap-audit.md              Agent 6 (reviewer, read-only)
docs/observability/test-acceptance-plan.md            Agent 7 (general, read-only)
docs/observability/langfuse-gap-analysis.md           Orchestrator (Phase 2)
docs/observability/observability-erd.md               Orchestrator (Phase 2)
docs/observability/implementation-plan.md             Orchestrator (Phase 2)
docs/observability/api-reference.md                   Orchestrator (Phase 3+)
docs/observability/configuration-reference.md         Orchestrator (Phase 3+)
docs/observability/implementation-status.md           Orchestrator only
```

Rules: Phase 1 is READ-ONLY except for the agent's own doc. No backend/frontend/models/migration edits. No git writes. Check `git status --short` first. Never touch shared services. Serial pytest only if needed (prefer code reading).
