"""Provider registry tests: encryption, masking, CRUD, validation shape."""

import json

from fastapi.testclient import TestClient

from tollms.core.crypto import decrypt, encrypt, mask


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
    created = provider_factory("Bad", ptype="OPENAI_CHAT", creds={})
    result = client.post(f"/api/v1/providers/{created['id']}/validate").json()
    assert result["valid"] is False
    assert "api_key" in result["message"]
