"""Model lifecycle + inference. The Laya checkpoint is the sole content judge.

Python here only: loads the model once, forwards typed questions, parses
probabilities, enforces timeouts/concurrency. No content classification.
"""

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

from config import Settings
from questions import build_questions

logger = logging.getLogger(__name__)


class NotReadyError(RuntimeError):
    """Model has not finished loading (startup failed or still warming up)."""


class InferenceError(RuntimeError):
    """Model invocation failed or timed out — never mapped to `allow`."""


class PayloadTooLargeError(ValueError):
    """Input exceeded MAX_TEXT_CHARS (HTTP 413, existing contract)."""


@dataclass
class RawResult:
    answers: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    evaluated: list[str] = field(default_factory=list)
    unevaluated: list[str] = field(default_factory=list)
    routing_model: str = ""
    latency_ms: float = 0.0

    @property
    def truncated(self) -> bool:
        return bool(self.usage.get("truncated"))


def _resolve_device(requested: str) -> str:
    """Use the requested device when available, else fall back to CPU loudly."""
    want = (requested or "cpu").strip().lower()
    if want == "cpu":
        return "cpu"
    try:
        import torch

        available = {
            "cuda": torch.cuda.is_available(),
            "mps": getattr(torch.backends, "mps", None) is not None
            and torch.backends.mps.is_available(),
            "xpu": hasattr(torch, "xpu") and torch.xpu.is_available(),
        }
        if want in available and available[want]:
            return want
    except Exception:  # torch missing/broken -> CPU path raises its own error
        pass
    logger.warning("laya device %r unavailable, falling back to cpu", requested)
    return "cpu"


class ModelEngine:
    """Owns one Router for the process lifetime. Created once at startup."""

    def __init__(self, settings: Settings, router_factory=None) -> None:
        self.settings = settings
        self._factory = router_factory  # injected fake in unit tests
        self._router: Any = None
        self._lock = asyncio.Semaphore(settings.max_concurrent)
        self.loaded = False
        self.device_actual = "cpu"
        self.checkpoint = settings.model
        self.load_ms = 0.0
        self.load_error: str | None = None

    def startup(self) -> None:
        """Build the checkpoint synchronously (FastAPI lifespan, one thread)."""
        started = time.monotonic()
        try:
            from laya import Router  # local import: unit tests never touch torch

            factory = self._factory or Router
            threads = self.settings.torch_threads
            if threads:
                try:
                    import torch

                    torch.set_num_threads(
                        max(1, min(threads, os.cpu_count() or threads)))
                except Exception:
                    logger.warning("laya: could not set torch threads", exc_info=True)
            self.device_actual = _resolve_device(self.settings.device)
            router = factory(device=self.device_actual, max_loaded=1)
            names = [self.settings.model]
            if self._factory is None:
                router.preload(names)  # real Router: load once, reuse forever
            self.checkpoint = self.settings.model
            self._router = router
            # Warmup: proves inference works before /ready goes true.
            warm = router.predict(
                {"request": "warmup"},
                {"ok": {"type": "noul",
                        "instructions": "Is `request` a greeting?"}},
                model=self.settings.model,
            )
            if not isinstance(warm, dict) or "answers" not in warm:
                raise RuntimeError(f"unexpected warmup payload: {type(warm)}")
            self.loaded = True
        except Exception as exc:
            self.load_error = f"{type(exc).__name__}: {exc}"
            logger.error("laya model startup failed: %s", self.load_error)
            raise
        finally:
            self.load_ms = (time.monotonic() - started) * 1000.0

    def shutdown(self) -> None:
        router, self._router = self._router, None
        self.loaded = False
        try:
            if router is not None and hasattr(router, "unload"):
                router.unload()
        except Exception:
            logger.warning("laya unload failed", exc_info=True)

    async def evaluate(self, text: str, categories: list[str]) -> RawResult:
        """Run one typed-decision call. Raises NotReady/Inference/Payload errors."""
        if self._router is None or not self.loaded:
            raise NotReadyError(self.load_error or "model not loaded")
        body = text or ""
        if len(body) > self.settings.max_text_chars:
            raise PayloadTooLargeError(
                f"text exceeds {self.settings.max_text_chars} chars")
        if not body.strip():
            return RawResult(answers={}, evaluated=[], unevaluated=list(categories or []),
                             routing_model=self.checkpoint)
        questions, evaluated, unevaluated = build_questions(categories or [])
        state = {"request": body}
        started = time.monotonic()
        async with self._lock:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(
                        self._router.predict, state, questions,
                        model=self.settings.model),
                    timeout=self.settings.inference_timeout_s,
                )
            except asyncio.TimeoutError as exc:
                raise InferenceError(
                    f"inference exceeded {self.settings.inference_timeout_s}s") from exc
            except Exception as exc:
                raise InferenceError(f"{type(exc).__name__}: {exc}") from exc
        if not isinstance(result, dict) or "answers" not in result:
            raise InferenceError("malformed prediction payload")
        latency_ms = (time.monotonic() - started) * 1000.0
        usage = result.get("usage") or {}
        routing = result.get("routing") or {}
        return RawResult(
            answers=result.get("answers") or {},
            usage=usage if isinstance(usage, dict) else {},
            evaluated=evaluated,
            unevaluated=unevaluated,
            routing_model=str(routing.get("model", self.checkpoint)),
            latency_ms=latency_ms,
        )
