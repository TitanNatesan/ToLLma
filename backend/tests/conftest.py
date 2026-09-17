"""Pytest fixtures: isolated tollms_test database on the compose postgres."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from tollms.core.config import get_settings
from tollms.core.deps import get_db
from tollms.db.base import Base
from tollms.main import app


def _test_url() -> str:
    s = get_settings()
    return f"postgresql+psycopg://{s.postgres_user}:{s.postgres_password}@{s.postgres_host}:{s.postgres_port}/tollms_test"


def _admin_url() -> str:
    return _test_url().rsplit("/", 1)[0] + "/postgres"


@pytest.fixture(scope="session")
def _database() -> str:
    admin = create_engine(_admin_url(), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text("DROP DATABASE IF EXISTS tollms_test WITH (FORCE)"))
        conn.execute(text("CREATE DATABASE tollms_test"))
    admin.dispose()
    url = _test_url()
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    return url


@pytest.fixture()
def db(_database: str):
    engine = create_engine(_database)
    TestingSession = sessionmaker(bind=engine)
    session: Session = TestingSession()
    yield session
    session.close()
    # Soft-deletes linger but are filtered; hard-clean tables between tests.
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    engine.dispose()


@pytest.fixture()
def client(db: Session):
    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _flush_cache():
    """Keep cache-using tests hermetic: Valkey never leaks state between tests."""
    yield
    try:
        from tollms.services.cache.manager import cache_invalidate_sync
        from tollms.services.cache.metrics import metrics

        cache_invalidate_sync("tollma:*")
        metrics.reset()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _generation_test_sessions(db: Session):
    """Background generation tasks must write to the test database, not the
    real one: bind the generation engine to the test engine for each test."""
    from sqlalchemy.orm import sessionmaker

    from tollms.services import generation as generation_engine

    maker = sessionmaker(bind=db.get_bind())
    previous = generation_engine.manager._sessions
    generation_engine.manager.configure(maker)
    yield
    generation_engine.manager.configure(previous)


@pytest.fixture()
def user_factory(client: TestClient):
    def _make(email: str = "u@tollma.ai", password: str = "password123", **kw) -> dict:
        r = client.post("/auth/signup", json={"email": email, "password": password, **kw})
        assert r.status_code == 200, r.text
        client._authed = True  # type: ignore[attr-defined]
        return r.json()["user"]

    return _make


def _ensure_authed(client: TestClient, user_factory) -> None:
    if not getattr(client, "_authed", False):
        user_factory()
        client._authed = True  # type: ignore[attr-defined]


@pytest.fixture()
def provider_factory(client: TestClient, user_factory):
    def _make(name: str = "P", ptype: str = "CUSTOM", creds: dict | None = None, **kw) -> dict:
        _ensure_authed(client, user_factory)
        r = client.post(
            "/api/v1/providers",
            json={"name": name, "provider_type": ptype, "credentials": creds or {"base_url": "http://mock"}, **kw},
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture()
def model_factory(client: TestClient, user_factory):
    def _make(provider_id: str, **kw) -> dict:
        _ensure_authed(client, user_factory)
        payload = {
            "provider_id": provider_id,
            "model_id": "mock-model",
            "name": "Mock",
            "endpoint_type": "chat_completions",
            "input_price": "2.5",
            "output_price": "10",
            **kw,
        }
        r = client.post("/api/v1/models", json=payload)
        assert r.status_code == 201, r.text
        return r.json()

    return _make
