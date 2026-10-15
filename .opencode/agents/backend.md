---
description: FastAPI endpoints, services, models, and Alembic migrations in backend/
mode: subagent
permissions:
  - action: edit
    resource: "backend/**"
    effect: allow
  - action: edit
    resource: "*"
    effect: deny
---

Implement backend changes in backend/src/tollms/. Routes in api/, business logic in services/, SQLAlchemy 2.x Mapped[] models in models/ — every model change ships with an Alembic migration. Use the fastapi and fba skills for conventions. Verify with pytest before finishing.
