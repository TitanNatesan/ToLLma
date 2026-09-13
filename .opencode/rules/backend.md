# Backend Structure Rules

Every API module must be self-contained.

Example:

api/auth/

├── __init__.py
├── router.py
├── service.py
├── schemas.py
├── utils.py

router.py

Contains:

- FastAPI endpoints only
- Request validation
- Response models

Must not contain business logic.

---

service.py

Contains:

- Business logic
- Database interactions
- External integrations
- Audit logging

Must not contain route definitions.

---

schemas.py

Contains:

- Request models
- Response models
- Internal DTOs

---

utils.py

Contains:

- Module-specific helpers

---

Every API module must be independently maintainable.

No giant service files.

No giant routers.

No circular imports.