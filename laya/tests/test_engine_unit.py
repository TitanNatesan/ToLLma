"""Engine unit tests with a fake Router (no torch, no weights)."""

import asyncio

import pytest

from config import Settings
from engine import (InferenceError, ModelEngine, NotReadyError,
                    PayloadTooLargeError)
from questions import ACTION_QID, SEVERITY_QID


def _answers(p_inject=0.05, action="allow"):
    return {
        "cat:prompt_injection": {"type": "noul", "noul": p_inject,
                                 "confidence": 1 - p_inject},
        ACTION_QID: {"type": "choice", "choice": action,
                     "probabilities": {action: 0.9}, "confidence": 0.9},
        SEVERITY_QID: {"type": "score", "score": 0.2,
                       "probabilities": {"0": 1.0}, "confidence": 1.0},
    }


class FakeRouter:
    instances: list = []

    def __init__(self, device=None, max_loaded=1, **kw):
        self.device = device
        self.calls: list = []
        FakeRouter.instances.append(self)

    def preload(self, names):
        self.preloaded = names

    def predict(self, state, questions, model=None):
        self.calls.append((state, questions, model))
        return {"answers": _answers(), "usage": {"truncated": False},
                "routing": {"model": model or "fake"}}

    def unload(self):
        self.unloaded = True


def _settings(**kw) -> Settings:
    base = {"model": "fake-model", "device": "cpu", "max_concurrent": 4,
            "inference_timeout_s": 5.0, "max_text_chars": 100}
    base.update(kw)
    fields = Settings.__dataclass_fields__
    return Settings(**{k: v for k, v in base.items() if k in fields})


@pytest.fixture(autouse=True)
def _clean():
    FakeRouter.instances.clear()
    yield
    FakeRouter.instances.clear()


def test_startup_preloads_once_and_warmup_runs():
    eng = ModelEngine(_settings(), router_factory=FakeRouter)
    eng.startup()
    assert eng.loaded and eng.device_actual == "cpu"
    router = FakeRouter.instances[0]
    assert len(router.calls) == 1  # warmup only
    eng.shutdown()
    assert not eng.loaded and getattr(router, "unloaded", False)


def test_evaluate_reuses_router_and_returns_raw():
    eng = ModelEngine(_settings(), router_factory=FakeRouter)
    eng.startup()
    raw = asyncio.run(eng.evaluate("hello", ["prompt_injection"]))
    assert raw.answers["cat:prompt_injection"]["noul"] == 0.05
    assert raw.evaluated == ["prompt_injection"]
    assert FakeRouter.instances[0].device == "cpu"


def test_evaluate_before_startup_raises_not_ready():
    eng = ModelEngine(_settings(), router_factory=FakeRouter)
    with pytest.raises(NotReadyError):
        asyncio.run(eng.evaluate("hi", []))


def test_oversize_payload_rejected():
    eng = ModelEngine(_settings(), router_factory=FakeRouter)
    eng.startup()
    with pytest.raises(PayloadTooLargeError):
        asyncio.run(eng.evaluate("x" * 101, []))


def test_empty_text_skips_inference():
    eng = ModelEngine(_settings(), router_factory=FakeRouter)
    eng.startup()
    before = len(FakeRouter.instances[0].calls)
    raw = asyncio.run(eng.evaluate("   ", ["pii"]))
    assert raw.answers == {} and len(FakeRouter.instances[0].calls) == before


def test_inference_exception_becomes_inference_error():
    class Boom(FakeRouter):
        def predict(self, state, questions, model=None):
            if state == {"request": "warmup"}:
                return {"answers": _answers(), "usage": {},
                        "routing": {"model": "boom"}}
            raise RuntimeError("weights exploded")

    eng = ModelEngine(_settings(), router_factory=Boom)
    eng.startup()
    with pytest.raises(InferenceError):
        asyncio.run(eng.evaluate("hi", ["pii"]))


def test_inference_timeout_becomes_inference_error():
    import time as _t

    class Slow(FakeRouter):
        def predict(self, state, questions, model=None):
            _t.sleep(0.3)
            return {"answers": _answers(), "usage": {},
                    "routing": {"model": "slow"}}

    eng = ModelEngine(_settings(inference_timeout_s=0.05), router_factory=Slow)
    eng.startup()
    with pytest.raises(InferenceError):
        asyncio.run(eng.evaluate("hi", ["pii"]))


def test_unsupported_device_falls_back_to_cpu():
    eng = ModelEngine(_settings(device="cuda"), router_factory=FakeRouter)
    eng.startup()
    assert eng.device_actual == "cpu"  # no GPU here; must not crash
