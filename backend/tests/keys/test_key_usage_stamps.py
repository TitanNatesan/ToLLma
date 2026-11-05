"""Key `last_used_at` stamps + unified per-key analytics over both ledgers.

Status semantics: `last_used_at` = most recent SUCCESSFULLY COMPLETED request.
Public-gateway (`ApiRequestLog`) + in-app-chat (`RequestLog`) rows union in
`GET /api/v1/keys/{id}/analytics` with in-app rows under `endpoint:"chat"`.
Covers: non-streaming/streaming success stamps, org attribution + ledger
isolation, failed/cancelled no-stamp, listing/detail basis parity,
analytics union + ranges + empty/error, retry idempotency + history survival
+ org analytics 404 oracle. Mocks provider transports only (SSE transport /
fake adapters), never live calls.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as pg_service
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult
from tollms.services.request_logs import touch_key_last_used

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


def _transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chat/completions"
        return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def _req(pid: str, mid: str, kid: uuid.UUID | None, **kw) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid), message="hi",
        key_id=kid, **kw,
    )


def _primary_id(client: TestClient) -> str:
    keys = client.get("/api/v1/chat/keys").json()
    assert keys, "signup provisions a primary key"
    return keys[0]["id"]


def _await_task(generation_id: uuid.UUID) -> None:
    async def _go():
        active = generation_engine.manager.get(generation_id)
        if active is not None and active.task is not None:
            await active.task

    asyncio.run(_go())


# --- 1. non-streaming success stamps ------------------------------------------


def test_nonstreaming_success_stamps_last_used(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("StampP")
    m = model_factory(p["id"])
    kid = uuid.UUID(_primary_id(client))

    before = client.get(f"/api/v1/keys/{kid}").json()
    assert before["last_used_at"] is None

    result = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], kid), _transport(), user_id=uid))
    assert result.message_id is not None

    db.expire_all()
    log = db.scalar(select(RequestLog).where(RequestLog.message_id == result.message_id))
    assert log is not None
    assert log.api_key_id == kid and log.user_id == uid and log.org_id is None
    assert log.status == RequestStatus.SUCCESS.value
    assert log.total_tokens == 15
    assert log.total_cost is not None and log.total_cost > 0

    key = db.get(ApiKey, kid)
    assert key is not None and key.last_used_at is not None
    assert key.last_used_at >= log.request_completed_at - timedelta(seconds=5)

    listed = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    detail = client.get(f"/api/v1/keys/{kid}").json()
    assert listed[str(kid)]["last_used_at"] == detail["last_used_at"]
    assert detail["last_used_at"] is not None


# --- 2. streaming success stamps (completion path) ----------------------------


def test_streaming_success_stamps_last_used(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("StreamP")
    m = model_factory(p["id"])
    kid = uuid.UUID(_primary_id(client))
    assert db.get(ApiKey, kid).last_used_at is None

    async def _main():
        started = await gateway_service.start_generation(
            db, _req(p["id"], m["id"], kid), _transport(), user_id=uid
        )
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_main())
    db.expire_all()

    log = db.scalar(select(RequestLog).where(RequestLog.message_id == started.message_id))
    assert log is not None
    assert log.api_key_id == kid and log.user_id == uid
    assert log.status == RequestStatus.SUCCESS.value
    assert log.is_streaming is True
    assert log.total_tokens is not None and log.total_tokens > 0

    key = db.get(ApiKey, kid)
    assert key is not None and key.last_used_at is not None

    detail = client.get(f"/api/v1/keys/{kid}").json()
    assert detail["last_used_at"] is not None


def test_touch_max_guard_never_raises_and_same_commit(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """Max-guard: stale stamps never move backwards; helper never raises."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("GuardP")
    m = model_factory(p["id"])
    kid = uuid.UUID(_primary_id(client))

    asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], kid), _transport(), user_id=uid))
    db.expire_all()
    first = db.get(ApiKey, kid).last_used_at
    assert first is not None

    # Stale stamp is ignored; fresh stamp moves forward; None/deleted never raise.
    touch_key_last_used(db, kid, completed_at=first - timedelta(days=1))
    db.flush()
    assert db.get(ApiKey, kid).last_used_at == first
    touch_key_last_used(db, None)
    touch_key_last_used(db, uuid.uuid4(), completed_at=datetime.now(timezone.utc))
    later = first + timedelta(hours=1)
    touch_key_last_used(db, kid, completed_at=later)
    db.flush()
    assert db.get(ApiKey, kid).last_used_at == later
    db.rollback()  # same-commit: touch joins the caller's tx (flush-visible, commit-owned)


# --- 3. org-key attribution + ledger isolation --------------------------------


def _org_provider_model(client: TestClient, db: Session, oid: str, name: str) -> tuple[str, str]:
    from tollms.models.registered_model import AIModel

    r = client.post(
        f"/api/v1/orgs/{oid}/providers/register",
        json={
            "name": name, "provider_type": "CUSTOM",
            "credentials": {"base_url": "http://mock"},
            "models": [{"model_id": f"{name}-model", "name": f"{name} Model",
                        "endpoint_type": "chat_completions",
                        "input_price": "1", "output_price": "2"}],
        },
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    mid = db.scalar(select(AIModel.id).where(
        AIModel.provider_id == uuid.UUID(pid), AIModel.model_id == f"{name}-model"))
    assert mid is not None
    return pid, str(mid)


def test_org_key_chat_attributed_to_org_key_and_org(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    root_id = client.get("/auth/me").json()["id"]
    oid = client.post("/api/v1/orgs", json={"name": "Stamp Org"}).json()["id"]
    opid, omid = _org_provider_model(client, db, oid, "StampOrgProv")
    issued = client.post(
        f"/api/v1/orgs/{oid}/keys", json={"assignee_user_id": root_id, "name": "org-chat-key"})
    assert issued.status_code == 201, issued.text
    org_kid = uuid.UUID(issued.json()["key"]["id"])

    # Control: personal chat traffic on the personal key (chat/keys mixes
    # org+personal with org first, so resolve the personal primary explicitly).
    p = provider_factory("StampPersonal")
    m = model_factory(p["id"])
    personal_list = client.get("/api/v1/keys").json()
    personal_kid = uuid.UUID(next(
        k["id"] for k in personal_list if k.get("is_primary")
    ))
    asyncio.run(gateway_service.run_chat(
        db, _req(p["id"], m["id"], personal_kid), _transport(), user_id=uid))

    result = asyncio.run(gateway_service.run_chat(
        db, _req(opid, omid, org_kid), _transport(), user_id=uid))
    db.expire_all()

    org_log = db.scalar(select(RequestLog).where(RequestLog.message_id == result.message_id))
    assert org_log is not None
    assert org_log.api_key_id == org_kid and org_log.org_id == uuid.UUID(oid)

    # Ledger isolation: personal analytics exclude the org row and vice versa.
    personal_rows = db.scalars(
        select(RequestLog).where(RequestLog.api_key_id == personal_kid)).all()
    assert all(r.org_id is None for r in personal_rows) and len(personal_rows) == 1
    org_rows = db.scalars(
        select(RequestLog).where(RequestLog.api_key_id == org_kid)).all()
    assert len(org_rows) == 1 and org_rows[0].org_id == uuid.UUID(oid)

    personal_analytics = client.get(
        f"/api/v1/keys/{personal_kid}/analytics", params={"preset": "last_7d"}).json()
    assert personal_analytics["requests"] == 1
    org_analytics = client.get(
        f"/api/v1/keys/{org_kid}/analytics", params={"preset": "last_7d"}).json()
    assert org_analytics["requests"] == 1
    assert personal_analytics["requests"] == 1  # no cross-contamination either direction


# --- 4. failed / cancelled -----------------------------------------------------


class _BoomAdapter:
    async def chat_stream(self, messages):
        raise RuntimeError("provider blew up")
        yield  # noqa: unreachable

    async def chat(self, messages):
        raise RuntimeError("provider blew up")


def test_failed_and_cancelled_never_move_stamp(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("FailP")
    m = model_factory(p["id"])
    kid = uuid.UUID(_primary_id(client))

    # Public-gateway failed streaming row: NULL tokens/cost, no stamp (existing semantics).
    created = client.post("/api/v1/keys", json={"name": "gw-fail"})
    assert created.status_code == 201, created.text
    raw, gw_kid = created.json()["raw_key"], created.json()["key"]["id"]
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _BoomAdapter())
    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": f"{p['name']}/mock-model",
              "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {raw}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        assert "error" in resp.read().decode().lower()
    db.expire_all()
    gw_row = db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(gw_kid)))
    assert gw_row is not None and gw_row.status == "failed"
    assert gw_row.input_tokens is None and gw_row.total_tokens is None and gw_row.cost is None
    assert db.get(ApiKey, uuid.UUID(gw_kid)).last_used_at is None

    # In-app non-streaming failure: raises, records one FAILED request row
    # with unknown (NULL) usage — never fabricated — and leaves the stamp
    # and the message table untouched (no assistant message is created).
    class _ChatBoom(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="boom")

        async def chat_stream(self, messages):  # pragma: no cover
            raise NotImplementedError
            yield

        async def chat(self, messages):
            raise RuntimeError("provider blew up")

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _ChatBoom())
    with pytest.raises(Exception):
        asyncio.run(gateway_service.run_chat(
            db, _req(p["id"], m["id"], kid), _transport(), user_id=uid))
    db.expire_all()
    fail_rows = db.scalars(select(RequestLog).where(RequestLog.api_key_id == kid)).all()
    assert len(fail_rows) == 1
    assert fail_rows[0].status == RequestStatus.FAILED.value
    assert fail_rows[0].total_tokens is None and fail_rows[0].total_cost is None
    assert fail_rows[0].latency_ms is not None and fail_rows[0].latency_ms >= 0
    assert fail_rows[0].message_id is None
    assert fail_rows[0].error_code is not None
    assert db.get(ApiKey, kid).last_used_at is None

    # In-app streaming cancel: CANCELLED row recorded, stamp still untouched.
    class _Slow(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="slow")

        async def chat_stream(self, messages):
            import asyncio as _aio
            yield StreamChunk(delta="partial ")
            await _aio.sleep(30)

        async def chat(self, messages):  # pragma: no cover
            raise NotImplementedError

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _Slow())

    async def _cancel_main():
        started = await gateway_service.start_generation(
            db, _req(p["id"], m["id"], kid), _transport(), user_id=uid
        )
        await gateway_service.cancel_generation(db, started.generation_id)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_cancel_main())
    db.expire_all()
    clog = db.scalar(select(RequestLog).where(RequestLog.message_id == started.message_id))
    assert clog is not None and clog.status == RequestStatus.CANCELLED.value
    assert db.get(ApiKey, kid).last_used_at is None


# --- 5. listing/detail basis parity + lifecycle ---------------------------------


def test_listing_detail_basis_identical_and_lifecycle(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    from datetime import timezone as _tz

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("LifeP")
    m = model_factory(p["id"])
    created = client.post("/api/v1/keys", json={"name": "Basis"})
    assert created.status_code == 201, created.text
    kid = created.json()["key"]["id"]
    asyncio.run(gateway_service.run_chat(
        db, _req(p["id"], m["id"], uuid.UUID(kid)), _transport(), user_id=uid))
    db.expire_all()

    listed = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    detail = client.get(f"/api/v1/keys/{kid}").json()
    for field in ("enabled", "expires_at", "last_used_at"):
        assert listed[kid][field] == detail[field], field
    assert detail["last_used_at"] is not None

    # Disabled is represented identically and never auto-reactivates on denied use.
    assert client.patch(f"/api/v1/keys/{kid}", json={"enabled": False}).status_code == 200
    listed_d = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    detail_d = client.get(f"/api/v1/keys/{kid}").json()
    assert listed_d[kid]["enabled"] is False and detail_d["enabled"] is False
    assert listed_d[kid]["last_used_at"] == detail_d["last_used_at"]
    denied = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": kid})
    assert denied.status_code == 404
    assert client.get(f"/api/v1/keys/{kid}").json()["enabled"] is False

    # Expired is represented (DB-set past; API rejects past input) and stays denied.
    past = datetime.now(_tz.utc) - timedelta(days=1)
    db.execute(ApiKey.__table__.update().where(
        ApiKey.id == uuid.UUID(kid)).values(expires_at=past, enabled=True))
    db.commit()
    db.expire_all()
    listed_e = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    assert listed_e[kid]["expires_at"] is not None
    expired_denied = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": kid})
    assert expired_denied.status_code == 404

    # Revoked (soft-delete): detail 404s, list drops it, history rows survive.
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    assert client.get(f"/api/v1/keys/{kid}").status_code == 404
    assert kid not in [k["id"] for k in client.get("/api/v1/keys").json()]
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(RequestLog).where(
        RequestLog.api_key_id == uuid.UUID(kid))) == 1


# --- 6. per-key analytics union -------------------------------------------------


def _seed_both_ledgers(db: Session, key: ApiKey, uid: uuid.UUID, now: datetime) -> None:
    from tollms.models.registered_model import AIModel

    model_id = db.scalar(select(AIModel.id).limit(1))
    db.add(ApiRequestLog(
        request_id=f"gw-{uuid.uuid4().hex[:8]}", api_key_id=key.id, user_id=uid,
        provider="openai", model="gpt-4o", endpoint="/v1/chat/completions",
        status="success", latency_ms=100.0, cost=Decimal("0.02"),
        input_tokens=50, output_tokens=50, total_tokens=100,
        created_at=now - timedelta(hours=1),
    ))
    db.add(RequestLog(
        user_id=uid, api_key_id=key.id, provider_id=None, model_id=model_id,
        total_tokens=300, total_cost=Decimal("0.05"), latency_ms=200.0,
        status=RequestStatus.SUCCESS.value, is_streaming=True,
        created_at=now - timedelta(hours=2),
    ))
    # Outside the last_7d window: must not leak into the preset.
    db.add(ApiRequestLog(
        request_id=f"old-{uuid.uuid4().hex[:8]}", api_key_id=key.id, user_id=uid,
        provider="openai", model="gpt-4o", endpoint="/v1/chat/completions",
        status="success", latency_ms=50.0, cost=Decimal("9.99"),
        input_tokens=10, output_tokens=10, total_tokens=20,
        created_at=now - timedelta(days=30),
    ))
    db.add(RequestLog(
        user_id=uid, api_key_id=key.id, total_tokens=9999,
        total_cost=Decimal("9.99"), status=RequestStatus.SUCCESS.value,
        created_at=now - timedelta(days=30),
    ))
    db.commit()


def test_per_key_analytics_unions_ledgers_ranges_and_empty(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider_factory("UnionP")
    # model_factory needs a provider; reuse the first personal provider.
    from tollms.models.provider import Provider
    pid = db.scalar(select(Provider.id).where(Provider.user_id == uid))
    from tollms.models.registered_model import AIModel
    mid = db.scalar(select(AIModel.id).where(AIModel.provider_id == pid))
    if mid is None:
        m = model_factory(str(pid))
        mid = uuid.UUID(m["id"])
    created = client.post("/api/v1/keys", json={"name": "Union"})
    assert created.status_code == 201, created.text
    kid = uuid.UUID(created.json()["key"]["id"])
    key = db.get(ApiKey, kid)
    now = datetime.now(timezone.utc)
    _seed_both_ledgers(db, key, uid, now)

    body = client.get(f"/api/v1/keys/{kid}/analytics", params={"preset": "last_7d"}).json()
    assert body["requests"] == 2
    assert body["tokens"] == 400
    assert Decimal(str(body["cost"])) == Decimal("0.07")
    assert body["error_rate"] == 0.0
    assert body["series"] and sum(p["requests"] for p in body["series"]) == 2
    endpoints = {r["endpoint"]: r for r in body["top_endpoints"]}
    assert endpoints["chat"]["requests"] == 1  # in-app ledger label
    assert endpoints["/v1/chat/completions"]["requests"] == 1

    # Empty key: valid empty payload, never an error.
    fresh = client.post("/api/v1/keys", json={"name": "Empty"}).json()["key"]["id"]
    empty = client.get(f"/api/v1/keys/{fresh}/analytics", params={"preset": "last_7d"})
    assert empty.status_code == 200, empty.text
    payload = empty.json()
    assert payload["requests"] == 0 and payload["tokens"] == 0
    assert Decimal(str(payload["cost"])) == 0
    assert payload["series"] == [] and payload["error_rate"] == 0

    # Errors propagate (raise, never silent-empty).
    with pytest.raises(ValidationError):
        from tollms.api.keys import analytics as key_analytics
        key_analytics.get_analytics(db, kid, uid, "banana")
    assert client.get(f"/api/v1/keys/{kid}/analytics", params={"preset": "banana"}).status_code == 422
    with pytest.raises(NotFoundError):
        from tollms.api.keys import analytics as key_analytics2
        key_analytics2.get_analytics(db, kid, uuid.uuid4(), "last_7d")
    assert client.get(f"/api/v1/keys/{uuid.uuid4()}/analytics",
                      params={"preset": "last_7d"}).status_code == 404


# --- 7. retry idempotency + history survival + org 404 --------------------------


def test_retry_single_row_history_survives_deletes_and_org_404(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    user = user_factory()
    uid = uuid.UUID(user["id"])
    root_id = client.get("/auth/me").json()["id"]
    p = provider_factory("RetryP")
    m = model_factory(p["id"])
    kid = uuid.UUID(_primary_id(client))

    # Lost-response retry with the same client_key: one message, one usage row.
    ckey = f"retry-{uuid.uuid4().hex}"

    async def _main():
        first = await gateway_service.start_generation(
            db, _req(p["id"], m["id"], kid, client_key=ckey), _transport(), user_id=uid)
        second = await gateway_service.start_generation(
            db, _req(p["id"], m["id"], kid, client_key=ckey), _transport(), user_id=uid)
        assert second.generation_id == first.generation_id
        active = generation_engine.manager.get(first.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return first

    started = asyncio.run(_main())
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(RequestLog).where(
        RequestLog.message_id == started.message_id)) == 1

    # Soft-deletes never cascade history; hard removal nulls refs, keeps costs.
    db.add(ApiRequestLog(
        request_id="hist-1", api_key_id=kid, user_id=uid, provider="custom",
        model="mock-model", endpoint="chat_completions", status="success",
        cost=Decimal("0.05"), total_tokens=100,
    ))
    db.commit()
    assert client.delete(f"/api/v1/models/{m['id']}").status_code == 204
    assert client.delete(f"/api/v1/providers/{p['id']}").status_code == 204
    db.expire_all()
    assert db.scalar(select(RequestLog).where(
        RequestLog.message_id == started.message_id)) is not None
    assert db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.request_id == "hist-1")) is not None
    # Hard removal of the key nulls refs but keeps the row (SET NULL, costs kept);
    # provider/model rows stay live here because conversations still reference
    # them (their soft-deletes above already proved history survival).
    db.delete(db.get(ApiKey, kid))
    db.commit()
    db.expire_all()
    req = db.scalar(select(RequestLog).where(RequestLog.message_id == started.message_id))
    assert req is not None and req.api_key_id is None  # SET NULL, row kept
    assert req.total_cost is not None

    # Non-member cannot read org-key analytics (404, never empty-200).
    oid = client.post("/api/v1/orgs", json={"name": "Retry Org"}).json()["id"]
    issued = client.post(
        f"/api/v1/orgs/{oid}/keys", json={"assignee_user_id": root_id, "name": "org-404"})
    assert issued.status_code == 201, issued.text
    org_kid = issued.json()["key"]["id"]
    assert client.get(f"/api/v1/keys/{org_kid}/analytics").status_code == 200
    user_factory("retry-stranger@tollma.ai")
    assert client.get(f"/api/v1/keys/{org_kid}/analytics").status_code == 404
