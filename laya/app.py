"""Laya: standalone guardrail evaluation service (CPU-only heuristics, v1).

Separately deployable; the backend calls POST /evaluate over HTTP and never
sends credentials here (there are none). Swap path: replace `score()` with a
real model behind the same envelope and bump MODEL_VERSION — the backend keys
versioning off the `model_version` field, never off rule internals.
"""

import asyncio
import logging
import re
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MODEL_VERSION = (Path(__file__).parent / "MODEL_VERSION").read_text().strip()
STARTED_AT = time.monotonic()

MAX_TEXT_CHARS = 64 * 1024
SEMAPHORE = asyncio.Semaphore(20)

_TOXIC = frozenset({
    "kill you", "hurt you", "bomb", "malware", "ransomware", "phishing",
    "credit card dump", "ssn list",
})
_INJECTION_RES = [
    re.compile(r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions"),
    re.compile(r"(?i)jailbreak|DAN\s+mode|do anything now"),
    re.compile(r"(?i)reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)"),
]
_SECRET_RES = [
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{8,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
]
_PII_RES = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
]

app = FastAPI(title="Laya", version=MODEL_VERSION)


class EvaluateIn(BaseModel):
    text: str = ""
    categories: list[str] = Field(default_factory=list)


@app.get("/health")
def health() -> dict:
    """Liveness + version. The backend caches this for 30s."""
    return {"status": "ok", "model_version": MODEL_VERSION,
            "uptime_s": round(time.monotonic() - STARTED_AT, 1)}


@app.get("/ready")
def ready() -> dict:
    return {"ready": True, "model_version": MODEL_VERSION}


@app.post("/evaluate")
async def evaluate(data: EvaluateIn, request: Request) -> JSONResponse:
    if len(data.text or "") > MAX_TEXT_CHARS:
        return JSONResponse(status_code=413, content={"error": "payload too large"})
    started = time.monotonic()
    async with SEMAPHORE:
        verdict, confidence, matched = score(data.text or "", data.categories)
    reason = f"laya {verdict}: {', '.join(matched[:5])}" if matched else ""
    return JSONResponse({
        "verdict": verdict, "confidence": confidence,
        "matched_categories": matched, "reason": reason,
        "latency_ms": (time.monotonic() - started) * 1000,
        "model_version": MODEL_VERSION,
    })


def score(text: str, categories: list[str]) -> tuple[str, float, list[str]]:
    """Heuristic verdict. Pure function (testable without the app)."""
    lowered = text.lower()
    matched: list[str] = []
    if any(t in lowered for t in _TOXIC):
        matched.append("harmful_content")
    if any(r.search(text) for r in _INJECTION_RES):
        matched.append("prompt_injection")
    if any(r.search(text) for r in _SECRET_RES):
        matched.append("secret_leakage")
    if any(r.search(text) for r in _PII_RES):
        matched.append("pii")
    if categories:
        matched = [c for c in matched if c in set(categories)]
    if not matched:
        return "allow", 0.9, []
    if "harmful_content" in matched or "secret_leakage" in matched:
        return "block", 0.8, matched
    return "warn", 0.7, matched
