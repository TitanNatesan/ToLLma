"""Provider registration wizard: draft-validate, mapping, register."""

import asyncio
import uuid

import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.services.model_repository.mapping import detect_providers_from_url, map_one
from tollms.services.model_repository.sync import run_sync
from tollms.api.models.service import get_model
from tollms.models.provider import ProviderType
from tollms.api.providers.service import draft_validate


def _modelsdev(*entries: tuple[str, str, dict]) -> dict:
    """Build a models.dev payload from (provider, model_id, model_info) triples."""
    payload: dict = {}
    for provider, model_id, info in entries:
        payload.setdefault(
            provider, {"id": provider, "name": provider, "models": {}}
        )["models"][model_id] = info
    return payload


def _chat_model(name: str, input_per_1m: float = 2.5) -> dict:
    return {
        "id": name,
        "name": name,
        "modalities": {"input": ["text"], "output": ["text"]},
        "limit": {"context": 128000, "output": 4096},
        "cost": {"input": input_per_1m, "output": 10.0},
    }


def _models_transport(models: list[dict]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": models})

    return httpx.MockTransport(handler)


def test_draft_validate_lists_models_without_persisting(db: Session, client: TestClient, user_factory) -> None:
    user_factory()
    before = client.get("/api/v1/providers").json()
    valid, message, _, discovered = asyncio.run(
        draft_validate(
            ProviderType.CUSTOM,
            {"base_url": "http://mock"},
            _models_transport([{"id": "m1"}, {"id": "m2"}]),
        )
    )
    assert valid is True and message == "credentials valid"
    assert [d.model_id for d in discovered] == ["m1", "m2"]
    assert client.get("/api/v1/providers").json() == before  # nothing persisted

    r = client.post(
        "/api/v1/providers/draft-validate",
        json={"provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert r.status_code == 200  # endpoint shape (live call may fail gracefully upstream)


def test_mapping_priorities(db: Session) -> None:
    run_sync(
        db,
        modelsdev_data=_modelsdev(
            ("groq", "gpt-oss-20b", _chat_model("gpt-oss-20b", 1.0)),
            ("openai", "gpt-4o", _chat_model("gpt-4o")),
            ("meta", "gpt-oss-20b", {**_chat_model("gpt-oss-20b"), "name": "GPT OSS"}),
        ),
    )
    assert detect_providers_from_url("https://api.groq.com/openai/v1") == ("groq",)
    assert detect_providers_from_url("http://localhost:11434/v1") == ("ollama",)

    p1 = map_one(db, "gpt-oss-20b", provider_type="CUSTOM", base_url="https://api.groq.com/openai/v1")
    assert p1["match_type"] == "provider_specific"
    assert p1["repository_model_key"] == "groq/gpt-oss-20b"
    assert p1["suggested"]["input_price"] == "1.000000000000"

    # Same id, no hints: still resolves, globally (either groq entry or meta entry).
    p3 = map_one(db, "gpt-oss-20b")
    assert p3["match_type"] in ("provider_specific", "global")
    assert p3["repository_model_key"] is not None

    p4 = map_one(db, "totally-unknown-xyz")
    assert p4["match_type"] == "fallback"
    assert p4["repository_model_key"] is None
    assert p4["suggested"]["input_price"] == "0"
    assert p4["suggested"]["supports_text"] is True

    r = map_one(db, "gpt-4o", provider_type="OPENAI")
    assert r["match_type"] == "provider_specific"


def test_register_is_atomic_with_match_stats(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    run_sync(
        db,
        modelsdev_data=_modelsdev(("openai", "gpt-4o", _chat_model("gpt-4o"))),
    )
    payload = {
        "name": "WizProv",
        "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "validation_status": "valid",
        "validation_message": "credentials valid",
        "models": [
            {
                "model_id": "gpt-4o", "name": "GPT-4o", "endpoint_type": "chat_completions",
                "repository_model_key": "openai/gpt-4o",
                "repository_match": {"match_type": "global"},
                "input_price": "2.5", "output_price": "10",
            },
            {"model_id": "mystery", "name": "Mystery", "endpoint_type": "chat_completions"},
        ],
    }
    r = client.post("/api/v1/providers/register", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["models_created"] == 2
    assert body["match_stats"] == {"provider_specific": 0, "global": 1, "fallback": 1}
    assert body["provider"]["validation_status"] == "valid"

    models = client.get("/api/v1/models", params={"provider_id": body["provider"]["id"]}).json()
    assert len(models) == 2
    linked = next(m for m in models if m["model_id"] == "gpt-4o")
    assert linked["repository_model_key"] == "openai/gpt-4o"
    assert linked["metadata"]["repository_match"]["match_type"] == "global"

    # Duplicate name rejected; nothing extra persisted.
    r = client.post("/api/v1/providers/register", json={**payload, "models": []})
    assert r.status_code == 422
    assert len(client.get("/api/v1/providers").json()) == 1
