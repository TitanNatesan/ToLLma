"""Laya AI guardrail evaluation service (model-driven, v2).

The Laya checkpoint makes every content-safety decision via typed decisions
(noul per category, choice for the overall action, score for severity).
Python only validates input, invokes the model, and normalizes probabilities
into the backend's {verdict, confidence, matched_categories} envelope.

Contract (unchanged for the ToLLma backend):
- GET  /health   -> {status, model_loaded, model_version, checkpoint,
                     device, uptime_s, ...}              (never runs inference)
- GET  /ready    -> {ready, model_loaded, model_version} (true only after a
                     successful warmup inference)
- POST /evaluate {text, categories[]} -> {verdict, confidence,
  matched_categories, reason, latency_ms, model_version}
  413 on oversize input; 503 when the model is not ready or inference fails
  (failures never become `allow` — the backend's failure_action decides).
"""

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import get_settings
from engine import InferenceError, ModelEngine, NotReadyError, PayloadTooLargeError
from mapping import normalize

logging.basicConfig(level=logging.INFO,
                      format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

STARTED_AT = time.monotonic()


class EvaluateIn(BaseModel):
    text: str = ""
    categories: list[str] = Field(default_factory=list)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = ModelEngine(settings)
    app.state.engine = engine
    app.state.settings = settings
    try:
        engine.startup()  # loads the checkpoint once; reused for all requests
    except Exception:
        logger.error("laya startup: model unavailable, serving 503s", exc_info=True)
    yield
    engine.shutdown()


app = FastAPI(title="Laya", lifespan=lifespan, version=Path(__file__).parent.joinpath(
    "MODEL_VERSION").read_text().strip())


def _engine(request: Request) -> ModelEngine:
    engine = getattr(request.app.state, "engine", None)
    if engine is None:  # TestClient without lifespan, or startup path skipped
        engine = ModelEngine(getattr(request.app.state, "settings", None)
                             or get_settings())
        request.app.state.engine = engine
    return engine


@app.get("/health")
def health(request: Request) -> dict:
    """Liveness + model info. The backend caches this for 30s; no inference."""
    settings = getattr(request.app.state, "settings", None) or get_settings()
    engine = getattr(request.app.state, "engine", None)
    body = {
        "status": "ok",
        "model_loaded": bool(engine and engine.loaded),
        "model_version": settings.model_version,
        "checkpoint": (engine.checkpoint if engine else settings.model),
        "device": (engine.device_actual if engine else settings.device),
        "uptime_s": round(time.monotonic() - STARTED_AT, 1),
    }
    if engine is not None:
        body["load_ms"] = round(engine.load_ms, 1)
        if engine.load_error:
            body["load_error"] = engine.load_error[:300]
    return body


@app.get("/ready")
def ready(request: Request) -> dict:
    """True only after the checkpoint loaded AND warmup inference succeeded."""
    settings = getattr(request.app.state, "settings", None) or get_settings()
    engine = getattr(request.app.state, "engine", None)
    ok = bool(engine and engine.loaded)
    return {"ready": ok, "model_loaded": ok,
            "model_version": settings.model_version}


@app.post("/evaluate")
async def evaluate(data: EvaluateIn, request: Request) -> JSONResponse:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    text = data.text or ""
    # Input validation is not inference: oversize is 413 in every server state.
    if len(text) > settings.max_text_chars:
        return JSONResponse(status_code=413, content={"error": "payload too large"})
    engine = _engine(request)
    try:
        raw = await engine.evaluate(text, data.categories or [])
    except PayloadTooLargeError as exc:
        return JSONResponse(status_code=413, content={"error": str(exc)})
    except (NotReadyError, InferenceError) as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)[:300]})
    except Exception:  # never leak internals; never fail open with allow
        logger.exception("laya evaluate failed")
        return JSONResponse(status_code=503, content={"error": "evaluation failed"})
    verdict = normalize(raw, settings)
    return JSONResponse({
        "verdict": verdict["verdict"],
        "confidence": verdict["confidence"],
        "matched_categories": verdict["matched_categories"],
        "reason": verdict["reason"],
        "latency_ms": round(raw.latency_ms, 1),
        "model_version": f"{settings.model_version}/{raw.routing_model}",
    })
