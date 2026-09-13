"""Cache infrastructure tests: manager, decorators, provider/repository
integration, distributed locks, sync invalidation, health endpoint.

Unit-level tests use fakeredis (hermetic); integration tests use the real
compose Valkey (connected explicitly; flushed between tests by conftest).
"""

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.conversations.service import usage_totals
from tollms.api.providers.service import discover_provider_models, validate_provider
from tollms.api.repository import service as repository_service
from tollms.core.exceptions import ValidationError
from tollms.models.model_repository import RepositoryModel
from tollms.services import cache as cache_pkg
from tollms.services.cache import client as cache_client
from tollms.services.cache import keys as cache_keys
from tollms.services.cache import locks as cache_locks
from tollms.services.cache import decorators as cache_decorators
from tollms.services.cache.manager import CacheManager, get_manager
from tollms.services.cache.metrics import metrics


def _fake_manager() -> CacheManager:
    return CacheManager(redis_client=FakeRedis(decode_responses=True))


def _run(coro):
    return asyncio.run(coro)


# --- manager ---------------------------------------------------------------


def test_manager_roundtrip_types() -> None:
    from pydantic import BaseModel

    class M(BaseModel):
        a: int

    mgr = _fake_manager()
    assert _run(mgr.set("k:dict", {"x": [1, 2], "when": datetime(2026, 1, 1, tzinfo=timezone.utc)})) is True
    got = _run(mgr.get("k:dict"))
    assert got == {"x": [1, 2], "when": "2026-01-01T00:00:00+00:00"}
    assert _run(mgr.set("k:model", M(a=3))) is True
    assert _run(mgr.get("k:model")) == {"a": 3}
    assert _run(mgr.set("k:dec", {"p": Decimal("2.5"), "id": uuid.UUID(int=1)})) is True
    assert _run(mgr.get("k:dec")) == {"p": "2.5", "id": "00000000-0000-0000-0000-000000000001"}
    assert _run(mgr.get("k:missing")) is None
    assert _run(mgr.set("k:none", None)) is False


def test_manager_ttl_exists_bulk_pattern() -> None:
    mgr = _fake_manager()
    assert _run(mgr.set("t:a", {"v": 1}, ttl=100)) is True
    assert _run(mgr.exists("t:a")) is True
    ttl = _run(mgr.ttl("t:a"))
    assert ttl is not None and 0 < ttl <= 100
    assert _run(mgr.expire("t:a", 200)) is True
    assert _run(mgr.mset({"m:1": {"v": 1}, "m:2": {"v": 2}}, ttl=100)) is True
    assert _run(mgr.mget(["m:1", "m:2", "m:nope"])) == [{"v": 1}, {"v": 2}, None]
    assert _run(mgr.delete("t:a", "m:1")) == 2
    assert _run(mgr.exists("t:a")) is False
    assert _run(mgr.set("tollma:probe:1", {"v": 1})) is True
    assert _run(mgr.set("tollma:probe:2", {"v": 1})) is True
    assert _run(mgr.invalidate_pattern("tollma:probe:*")) == 2
    assert _run(mgr.exists("tollma:probe:1")) is False


def test_manager_graceful_without_valkey(monkeypatch: pytest.MonkeyPatch) -> None:
    from tollms.core.config import get_settings

    monkeypatch.setattr(get_settings(), "cache_enabled", False)
    mgr = CacheManager()  # resolves nothing while disabled
    assert _run(mgr.get("k")) is None
    assert _run(mgr.set("k", {"v": 1})) is False
    assert _run(mgr.delete("k")) == 0
    assert _run(mgr.invalidate_pattern("k*")) == 0


# --- decorators ------------------------------------------------------------


def test_decorators_cached_invalidate_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _fake_manager()
    monkeypatch.setattr(cache_decorators, "get_manager", lambda: fake)
    calls = {"n": 0}

    @cache_decorators.cached("dec:item", ttl=60)
    async def _expensive() -> dict:
        calls["n"] += 1
        return {"v": calls["n"]}

    assert _run(_expensive()) == {"v": 1}
    assert _run(_expensive()) == {"v": 1}  # cache hit: no recompute
    assert calls["n"] == 1

    @cache_decorators.cache_invalidate("dec:item")
    async def _mutate() -> str:
        return "ok"

    assert _run(_mutate()) == "ok"
    assert _run(_expensive()) == {"v": 2}  # invalidated: recomputed

    @cache_decorators.cache_refresh("dec:item", ttl=60)
    async def _refresh() -> dict:
        calls["n"] += 10
        return {"v": calls["n"]}

    assert _run(_refresh()) == {"v": 12}
    assert _run(_expensive()) == {"v": 12}  # refresh overwrote the entry


# --- provider validation + discovery cache ---------------------------------


def test_provider_validation_served_from_cache(db: Session, provider_factory) -> None:
    assert _run(cache_client.connect()) is True
    p = provider_factory("VC", creds={"base_url": "http://invalid.invalid"})
    pid = uuid.UUID(p["id"])
    manager = get_manager()
    assert _run(manager.set(cache_keys.provider_validation(pid),
                            {"valid": True, "message": "cached-ok", "latency_ms": 230,
                             "checked_at": "2026-09-13T00:00:00+00:00"})) is True
    # No transport + unreachable credentials: a miss would probe the network
    # and fail — the seeded hit must win.
    assert _run(validate_provider(db, pid)) == (True, "cached-ok", 230.0)
    assert metrics.snapshot()["hits"] >= 1


def test_provider_update_invalidates_cache(client: TestClient, provider_factory) -> None:
    assert _run(cache_client.connect()) is True
    p = provider_factory("VI")
    manager = get_manager()
    assert _run(manager.set(cache_keys.provider_validation(p["id"]), {"valid": True})) is True
    assert _run(manager.set(cache_keys.provider_models(p["id"]), {"models": []})) is True
    assert client.patch(f"/api/v1/providers/{p['id']}", json={"name": "VI2"}).status_code == 200
    assert _run(manager.exists(cache_keys.provider_validation(p["id"]))) is False
    assert _run(manager.exists(cache_keys.provider_models(p["id"]))) is False


def test_discovery_served_from_cache_with_live_registration(db: Session, provider_factory, model_factory) -> None:
    assert _run(cache_client.connect()) is True
    p = provider_factory("DC", creds={"base_url": "http://invalid.invalid"})
    pid = uuid.UUID(p["id"])
    payload = {
        "models": [
            {"model_id": "m1", "name": "M1", "endpoint_type": "chat_completions",
             "suggested": {"model_id": "m1"}, "repository_match": {}},
            {"model_id": "m2", "name": "M2", "endpoint_type": "chat_completions",
             "suggested": {"model_id": "m2"}, "repository_match": {}},
        ],
        "total": 2,
        "last_discovery_at": "2026-09-13T00:00:00+00:00",
    }
    assert _run(get_manager().set(cache_keys.provider_models(pid), payload)) is True
    first = _run(discover_provider_models(db, pid))
    assert first.total == 2 and first.new_count == 2 and first.registered_count == 0
    model_factory(p["id"], model_id="m1", name="M1")
    second = _run(discover_provider_models(db, pid))
    assert second.total == 2 and second.new_count == 1 and second.registered_count == 1


# --- repository cache ------------------------------------------------------


def test_repository_match_cached(db: Session) -> None:
    from tollms.services.model_repository.lookup import find_for_model

    assert _run(cache_client.connect()) is True
    entry = RepositoryModel(model_key="openai/mock-x", canonical_name="mock-x",
                            provider="openai", provider_model_id="mock-x")
    db.add(entry)
    db.commit()

    assert find_for_model(db, "OPENAI_CHAT", "mock-x") is not None
    assert metrics.snapshot()["misses"] >= 1
    assert find_for_model(db, "OPENAI_CHAT", "mock-x") is not None
    assert metrics.snapshot()["hits"] >= 1

    # Misses are cached too (avoids rescanning the table for unknown models).
    assert find_for_model(db, "OPENAI_CHAT", "no-such-model") is None
    assert find_for_model(db, "OPENAI_CHAT", "no-such-model") is None
    assert metrics.snapshot()["hits"] >= 2


def test_sync_invalidates_repository_cache(db: Session) -> None:
    from tollms.services.model_repository.lookup import find_for_model

    assert _run(cache_client.connect()) is True
    entry = RepositoryModel(model_key="openai/mock-y", canonical_name="mock-y",
                            provider="openai", provider_model_id="mock-y")
    db.add(entry)
    db.commit()
    assert find_for_model(db, "OPENAI_CHAT", "mock-y") is not None
    assert _run(get_manager().exists(cache_keys.repository_match("OPENAI_CHAT", "mock-y"))) is True

    run = repository_service.run_sync(db, litellm_data={}, openrouter_data={})
    assert run.status == "done"
    assert _run(get_manager().exists(cache_keys.repository_match("OPENAI_CHAT", "mock-y"))) is False


def test_sync_busy_returns_422(db: Session) -> None:
    assert _run(cache_client.connect()) is True
    token = _run(cache_locks.acquire(cache_keys.LOCK_REPO_SYNC, 60_000))
    assert token is not None
    try:
        with pytest.raises(ValidationError, match="already running"):
            repository_service.run_sync(db, litellm_data={}, openrouter_data={})
    finally:
        assert _run(cache_locks.release(cache_keys.LOCK_REPO_SYNC, token)) is True


# --- locks -----------------------------------------------------------------


def test_distributed_lock_contention() -> None:
    assert _run(cache_client.connect()) is True
    name = cache_keys.provider_refresh_lock("test-contention")
    token = _run(cache_locks.acquire(name, 60_000))
    assert token is not None
    try:
        assert _run(cache_locks.acquire(name, 1_000)) is None  # busy
        assert _run(cache_locks.release(name, "wrong-token")) is False
        with cache_locks.locked_sync(name, 1_000) as acquired:
            assert acquired is False
    finally:
        assert _run(cache_locks.release(name, token)) is True
    token2 = _run(cache_locks.acquire(name, 1_000))
    assert token2 is not None
    assert _run(cache_locks.release(name, token2)) is True


def test_locked_scope_releases() -> None:
    assert _run(cache_client.connect()) is True
    name = cache_keys.provider_refresh_lock("test-scope")
    with cache_locks.locked_sync(name, 60_000) as acquired:
        assert acquired is True
        assert _run(cache_locks.acquire(name, 1_000)) is None
    assert _run(cache_locks.acquire(name, 1_000)) is not None


# --- conversations usage cache ---------------------------------------------


def test_usage_totals_cached_and_invalidated(client: TestClient, db: Session, provider_factory, model_factory) -> None:
    from tollms.api.conversations.service import add_message
    from tollms.models.message import Role

    assert _run(cache_client.connect()) is True
    p = provider_factory("UC")
    m = model_factory(p["id"])
    cid = client.post("/api/v1/conversations",
                      json={"title": "T", "provider_id": p["id"], "model_id": m["id"]}).json()["id"]
    first = client.get(f"/api/v1/conversations/{cid}/usage")
    assert first.status_code == 200
    assert _run(get_manager().exists(cache_keys.usage_totals(cid))) is True
    second = client.get(f"/api/v1/conversations/{cid}/usage")
    assert second.json() == first.json()
    assert metrics.snapshot()["hits"] >= 1
    # New message invalidates; totals still correct afterwards.
    add_message(db, uuid.UUID(cid), Role.USER, "hi")
    assert _run(get_manager().exists(cache_keys.usage_totals(cid))) is False
    assert client.get(f"/api/v1/conversations/{cid}/usage").json()["prompt_tokens"] >= 0


# --- health ----------------------------------------------------------------


def test_cache_health_endpoint(client: TestClient) -> None:
    body = client.get("/health/cache").json()
    assert body["status"] in ("healthy", "degraded")
    assert isinstance(body["hit_rate"], (int, float))
    assert isinstance(body["keys"], int)
    assert "metrics" in body and "server" in body


def test_cache_package_exports() -> None:
    assert cache_pkg.get_cache() is get_manager()
    assert set(cache_pkg.__all__) >= {"cached", "cache_invalidate", "cache_refresh", "locked", "locked_sync"}
