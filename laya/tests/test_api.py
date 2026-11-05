"""HTTP contract tests: same envelope the backend consumes (stubbed engine)."""

from fastapi.testclient import TestClient

import app as app_module
from engine import RawResult


class StubEngine:
    loaded = True
    checkpoint = "stub-model"
    device_actual = "cpu"
    load_ms = 1.0
    load_error = None

    def __init__(self, raw: RawResult | None = None, exc: Exception | None = None):
        self._raw = raw or RawResult(
            answers={}, evaluated=[], unevaluated=[], routing_model="stub-model")
        self._exc = exc

    async def evaluate(self, text, categories):
        if self._exc:
            raise self._exc
        return self._raw


def _client(engine) -> TestClient:
    client = TestClient(app_module.app, raise_server_exceptions=False)
    app_module.app.state.engine = engine
    return client


def test_health_shape_and_no_inference():
    c = _client(StubEngine())
    r = c.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert "model_version" in body and "checkpoint" in body
    assert "device" in body and "uptime_s" in body


def test_ready_true_when_loaded():
    c = _client(StubEngine())
    body = c.get("/ready").json()
    assert body == {"ready": True, "model_loaded": True,
                    "model_version": body["model_version"]}


def test_evaluate_contract_fields():
    c = _client(StubEngine())
    r = c.post("/evaluate", json={"text": "hello", "categories": []})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"verdict", "confidence", "matched_categories",
                         "reason", "latency_ms", "model_version"}
    assert body["verdict"] == "allow"


def test_evaluate_failure_is_503_never_allow():
    from engine import InferenceError
    c = _client(StubEngine(exc=InferenceError("boom")))
    r = c.post("/evaluate", json={"text": "hi", "categories": ["pii"]})
    assert r.status_code == 503
    assert "verdict" not in r.json()


def test_evaluate_not_ready_is_503():
    from engine import NotReadyError
    c = _client(StubEngine(exc=NotReadyError("cold")))
    r = c.post("/evaluate", json={"text": "hi", "categories": []})
    assert r.status_code == 503


def test_lifespan_wires_model_startup():
    assert app_module.app.router.lifespan_context is not None
