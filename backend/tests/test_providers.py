"""Provider registry tests: encryption, masking, CRUD, validation shape."""

import asyncio
import json
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.providers import service as providers_service
from tollms.core.crypto import decrypt, encrypt, mask
from tollms.core.exceptions import ErrorCode


def test_encrypt_mask_roundtrip() -> None:
    token = encrypt(json.dumps({"api_key": "sk-secret-1234"}))
    assert json.loads(decrypt(token))["api_key"] == "sk-secret-1234"
    assert mask("sk-secret-1234") == "****1234"
    assert "sk-secret" not in token


def test_provider_crud_masks_credentials(client: TestClient, provider_factory) -> None:
    created = provider_factory("Test", creds={"base_url": "http://x", "api_key": "topsecretkey"})
    assert created["credentials_masked"] == {"base_url": "http://x", "api_key": "****tkey"}
    pid = created["id"]

    got = client.get(f"/api/v1/providers/{pid}").json()
    assert got["credentials_masked"]["api_key"] == "****tkey"

    updated = client.patch(f"/api/v1/providers/{pid}", json={"name": "Renamed"}).json()
    assert updated["name"] == "Renamed"

    assert client.delete(f"/api/v1/providers/{pid}").status_code == 204
    assert client.get(f"/api/v1/providers/{pid}").status_code == 404
    assert client.get("/api/v1/providers").json() == []


def test_validate_missing_fields(client: TestClient, provider_factory) -> None:
    # A non-empty credential dict (the fixture supplies a base_url for `{}`)
    # with no API key must fail before any network call.
    created = provider_factory("Bad", ptype="OPENAI", creds={"api_key": ""})
    result = client.post(f"/api/v1/providers/{created['id']}/validate").json()
    assert result["valid"] is False
    assert "api_key" in result["message"]


# --- failure-triggered revalidation -------------------------------------------


def _run(coro):
    return asyncio.run(coro)


def test_request_revalidation_triggers_on_invalid_credentials(db: Session, provider_factory) -> None:
    created = provider_factory("RevalCreds")
    pid = uuid.UUID(created["id"])
    calls: list[str] = []

    async def fake_probe(db, provider_id):
        calls.append(str(provider_id))

    assert _run(
        providers_service.request_revalidation(db, pid, ErrorCode.INVALID_CREDENTIALS, probe=fake_probe)
    ) is True
    assert calls == [str(pid)]


def test_request_revalidation_triggers_on_timeout_and_unavailable(db: Session, provider_factory) -> None:
    first = provider_factory("RevalTimeout")
    second = provider_factory("RevalUnavailable")
    calls: list[str] = []

    async def fake_probe(db, provider_id):
        calls.append(str(provider_id))

    assert _run(
        providers_service.request_revalidation(
            db, uuid.UUID(first["id"]), ErrorCode.TIMEOUT, probe=fake_probe
        )
    ) is True
    assert _run(
        providers_service.request_revalidation(
            db, uuid.UUID(second["id"]), ErrorCode.MODEL_UNAVAILABLE, probe=fake_probe
        )
    ) is True
    assert sorted(calls) == sorted([first["id"], second["id"]])


def test_request_revalidation_ignores_other_codes_and_success(db: Session, provider_factory) -> None:
    created = provider_factory("RevalOther")
    pid = uuid.UUID(created["id"])
    calls: list[str] = []

    async def fake_probe(db, provider_id):
        calls.append(str(provider_id))

    for reason in (
        None,
        ErrorCode.RATE_LIMITED,
        ErrorCode.PROVIDER_ERROR,
        ErrorCode.MODEL_NOT_FOUND,
        ErrorCode.VALIDATION_ERROR,
    ):
        assert _run(providers_service.request_revalidation(db, pid, reason, probe=fake_probe)) is False
    assert calls == []


def test_request_revalidation_throttled_within_window(db: Session, provider_factory) -> None:
    created = provider_factory("RevalThrottle")
    pid = uuid.UUID(created["id"])
    calls: list[str] = []

    async def fake_probe(db, provider_id):
        calls.append(str(provider_id))

    assert _run(
        providers_service.request_revalidation(db, pid, ErrorCode.TIMEOUT, probe=fake_probe)
    ) is True
    assert _run(
        providers_service.request_revalidation(db, pid, ErrorCode.TIMEOUT, probe=fake_probe)
    ) is False
    assert len(calls) == 1


def test_request_revalidation_default_probe_no_network_under_pytest(
    db: Session, provider_factory, monkeypatch
) -> None:
    created = provider_factory("RevalDryRun")
    pid = uuid.UUID(created["id"])
    called: list = []

    async def boom(db, provider_id, *args, **kwargs):
        called.append(provider_id)
        raise AssertionError("network probe must not run under pytest")

    monkeypatch.setattr(providers_service, "validate_provider", boom)
    # probe=None -> default path short-circuits under PYTEST_CURRENT_TEST.
    assert _run(providers_service.request_revalidation(db, pid, ErrorCode.TIMEOUT)) is True
    assert called == []
