"""Shared hermetic client for privacy API tests (helper only, no tests).

Builds a test-only FastAPI app mounting the privacy router with the same
exception handlers as production. The global app is untouched: the
orchestrator wires the router into main.py in Wave 3.
"""

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import tollms.models.privacy  # noqa: F401 — register tables before create_all
from tollms.api.privacy.router import router as privacy_router
from tollms.core import dependencies as core_deps
from tollms.core.deps import get_db
from tollms.core.exceptions import register_handlers
from tollms.models.user import User


def privacy_client(db: Session, user_id: uuid.UUID) -> TestClient:
    """TestClient bound to one user (dependency overrides, no real auth)."""
    app = FastAPI()
    register_handlers(app)
    app.include_router(privacy_router)

    def _db():
        yield db

    async def _user() -> User:
        row = db.get(User, user_id)
        assert row is not None
        return row

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[core_deps.require_active_user] = _user
    app.dependency_overrides[core_deps.get_current_user] = _user
    return TestClient(app)
