"""Benchmark runs: auth/isolation, body rejection, cursor listing, delete."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.main import app  # noqa: F401 (client fixture binds get_db)
from tollms.models.benchmark import BenchmarkRun
from tests.test_prompt_logging import _assign, _invite, _me, _org, _other, _set

BM = "/api/v1/benchmarks"


def _run(client: TestClient, **kw) -> dict:
    body = {"name": "smoke", "traffic_path": "internal",
            "provider_label": "p", "model_label": "m",
            "conditions": {"concurrency": 4, "prompt_mix": "mixed",
                           "max_tokens": 512,
                           "window": "2026-01-01/2026-01-07"},
            "n": 100, "errors": 2, "mean_ms": 120.5, "p50_ms": 100.0,
            "p95_ms": 300.0, "p99_ms": 500.0,
            "prompt_tokens": 1000, "completion_tokens": 2000,
            "cache_read_tokens": 100, "cache_write_tokens": 50,
            "total_cost": "1.25", **kw}
    r = client.post(f"{BM}/runs", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _roster(client: TestClient, db: Session, codes: list[str]):
    """Root org + member holding `codes`. Returns (member_client, oid)."""
    member = _other(f"bm-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)["id"]
    _invite(client, member, db, oid)
    if codes:
        sid = _set(client, oid, f"S-{uuid.uuid4().hex[:6]}", codes)
        _assign(client, oid, _me(member)["id"], [sid])
    return member, oid


def test_personal_owner_only(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    created = _run(client)
    assert created["org_id"] is None and created["conditions"]["concurrency"] == 4
    assert float(created["total_cost"]) == 1.25

    items = client.get(f"{BM}/runs").json()["items"]
    assert [row["id"] for row in items] == [created["id"]]

    stranger = _other("bm-stranger@tollma.ai")
    assert stranger.get(f"{BM}/runs").json()["items"] == []
    assert stranger.delete(f"{BM}/runs/{created['id']}").status_code == 404
    assert stranger.post(f"{BM}/runs", json={"name": "x"}).status_code == 201

    assert client.delete(f"{BM}/runs/{created['id']}").status_code == 204
    assert client.get(f"{BM}/runs").json()["items"] == []


def test_org_requires_view_usage(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    member, oid = _roster(client, db, [])

    payload = {"name": "org-run", "org_id": oid}
    assert member.post(f"{BM}/runs", json=payload).status_code == 404
    assert member.get(f"{BM}/runs", params={"org_id": oid}).status_code == 404

    sid = _set(client, oid, "Viewer", ["Analytics.ViewUsage"])
    _assign(client, oid, _me(member)["id"], [sid])
    created = _run(member, org_id=oid)
    assert created["org_id"] == oid

    stranger = _other("bm-stranger2@tollma.ai")
    assert stranger.get(f"{BM}/runs", params={"org_id": oid}).status_code == 404

    got = member.get(f"{BM}/runs", params={"org_id": oid}).json()["items"]
    assert [row["id"] for row in got] == [created["id"]]
    # personal list stays isolated from org rows
    assert member.get(f"{BM}/runs").json()["items"] == []


def test_body_rejection(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.post(f"{BM}/runs", json={
        "name": "bad", "conditions": {"input_text": "secret"}}).status_code == 422
    assert client.post(f"{BM}/runs", json={
        "name": "bad", "conditions": {"plan": [{"output_text": "x"}]}}).status_code == 422
    assert client.post(f"{BM}/runs", json={
        "name": "bad", "input_text": "top-level"}).status_code == 422
    assert client.post(f"{BM}/runs", json={
        "name": "bad", "traffic_path": "sideways"}).status_code == 422
    created = _run(client, conditions={"prompt_mix": "mixed"})
    assert created["conditions"] == {"prompt_mix": "mixed"}


def test_listing_newest_first_cursor(client: TestClient, db: Session,
                                     user_factory) -> None:
    user_factory()
    ids = [_run(client, name=f"run-{i}")["id"] for i in range(3)]
    r = client.get(f"{BM}/runs", params={"limit": 2})
    assert r.status_code == 200, r.text
    page1 = [row["id"] for row in r.json()["items"]]
    assert page1 == ids[::-1][:2]
    cursor = r.headers.get("X-Next-Cursor")
    assert cursor is not None
    r2 = client.get(f"{BM}/runs", params={"limit": 2, "cursor": cursor})
    assert [row["id"] for row in r2.json()["items"]] == [ids[0]]
    assert "X-Next-Cursor" not in r2.headers


def test_delete_creator_or_root(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    member, oid = _roster(client, db, ["Analytics.ViewUsage"])

    own = _run(member, org_id=oid, name="own")
    assert member.delete(f"{BM}/runs/{own['id']}").status_code == 204

    other = _run(member, org_id=oid, name="others-target")
    # second member in the SAME org (not the creator, not root)
    peer_client = _other(f"bm-{uuid.uuid4().hex[:8]}@tollma.ai")
    _invite(client, peer_client, db, oid)
    sid = _set(client, oid, f"S-{uuid.uuid4().hex[:6]}", ["Analytics.ViewUsage"])
    _assign(client, oid, _me(peer_client)["id"], [sid])
    assert peer_client.delete(f"{BM}/runs/{other['id']}").status_code == 404

    # root (creator of nothing here) can delete any org run
    assert client.delete(f"{BM}/runs/{other['id']}").status_code == 204
    assert client.delete(f"{BM}/runs/{other['id']}").status_code == 404
    assert db.scalar(select(BenchmarkRun).where(
        BenchmarkRun.id == uuid.UUID(other["id"]))) is None
