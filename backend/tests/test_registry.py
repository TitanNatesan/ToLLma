"""Model registry + conversation tests: CRUD, search/filter, rename, usage totals."""

from fastapi.testclient import TestClient


def test_model_crud_search_filter(client: TestClient, provider_factory, model_factory) -> None:
    p = provider_factory("P1")
    m1 = model_factory(p["id"], model_id="gpt-x", name="GPT X", supports_vision=True)
    model_factory(p["id"], model_id="emb-y", name="Emb Y", supports_vision=False)

    assert len(client.get("/api/v1/models").json()) == 2
    assert len(client.get("/api/v1/models", params={"provider_id": p["id"]}).json()) == 2
    assert client.get("/api/v1/models", params={"search": "gpt"}).json()[0]["id"] == m1["id"]
    assert client.get("/api/v1/models", params={"capability": "supports_vision"}).json()[0]["id"] == m1["id"]

    updated = client.patch(f"/api/v1/models/{m1['id']}", json={"description": "d", "input_price": "1"}).json()
    assert updated["description"] == "d"

    assert client.delete(f"/api/v1/models/{m1['id']}").status_code == 204
    assert len(client.get("/api/v1/models").json()) == 1


def test_conversation_lifecycle_and_usage(client: TestClient, provider_factory, model_factory) -> None:
    p = provider_factory("P")
    m = model_factory(p["id"])
    conv = client.post(
        "/api/v1/conversations", json={"title": "Hello", "provider_id": p["id"], "model_id": m["id"]}
    ).json()
    cid = conv["id"]

    assert client.get("/api/v1/conversations", params={"search": "hell"}).json()[0]["id"] == cid

    renamed = client.patch(f"/api/v1/conversations/{cid}", json={"title": "Renamed"}).json()
    assert renamed["title"] == "Renamed"

    assert client.get(f"/api/v1/conversations/{cid}/messages").json() == []
    usage = client.get(f"/api/v1/conversations/{cid}/usage").json()
    assert usage == {
        "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
        "cache_read_tokens": 0, "cache_write_tokens": 0, "reasoning_tokens": 0,
        "input_cost": "0", "output_cost": "0", "total_cost": "0",
        "cache_read_cost": "0", "cache_write_cost": "0", "reasoning_cost": "0",
        "by_model": [], "by_provider": [],
    }

    assert client.delete(f"/api/v1/conversations/{cid}").status_code == 204
    assert client.get("/api/v1/conversations").json() == []
