"""Backend smoke tests: health endpoints only."""

from fastapi.testclient import TestClient

from tollms.main import app

client = TestClient(app)


def test_liveness() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_shape() -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] in ("ok", "degraded")
