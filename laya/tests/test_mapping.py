"""Decision normalization over fabricated model answers (no checkpoint needed)."""

import pytest

from config import Settings
from engine import InferenceError, RawResult
from mapping import normalize
from questions import ACTION_QID, SEVERITY_QID


def _raw(cats: dict[str, float], action="allow", action_p=0.9,
         severity=1.0, truncated=False, unevaluated=()) -> RawResult:
    answers = {f"cat:{c}": {"type": "noul", "noul": p,
                             "confidence": max(p, 1 - p)}
               for c, p in cats.items()}
    answers[ACTION_QID] = {"type": "choice", "choice": action,
                           "probabilities": {action: action_p},
                           "confidence": action_p}
    answers[SEVERITY_QID] = {"type": "score", "score": severity,
                             "probabilities": {"1": 1.0}, "confidence": 1.0}
    usage = {"truncated": truncated, "state_tokens": 10} if truncated else {}
    return RawResult(answers=answers, usage=usage, evaluated=list(cats),
                     unevaluated=list(unevaluated), routing_model="m")


def _settings(**kw) -> Settings:
    base = {"model": "m", "device": "cpu", "match_threshold": 0.5,
            "block_threshold": 0.7}
    base.update(kw)
    return Settings(**{k: v for k, v in base.items()
                       if k in Settings.__dataclass_fields__})


def test_clean_request_allows():
    out = normalize(_raw({"prompt_injection": 0.05}), _settings())
    assert out["verdict"] == "allow"
    assert out["matched_categories"] == []
    assert 0.0 <= out["confidence"] <= 1.0


def test_high_category_probability_blocks():
    out = normalize(_raw({"prompt_injection": 0.94}), _settings())
    assert out["verdict"] == "block"
    assert out["matched_categories"] == ["prompt_injection"]
    assert out["confidence"] == pytest.approx(0.94)


def test_mid_probability_warns():
    out = normalize(_raw({"pii": 0.6}), _settings())
    assert out["verdict"] == "warn"
    assert out["matched_categories"] == ["pii"]


def test_review_action_warns_without_category_match():
    out = normalize(_raw({"pii": 0.2}, action="review", action_p=0.66), _settings())
    assert out["verdict"] == "warn"
    assert out["matched_categories"] == []


def test_block_action_blocks_without_category_match():
    out = normalize(_raw({"pii": 0.1}, action="block", action_p=0.8), _settings())
    assert out["verdict"] == "block"


def test_weak_block_plurality_without_majority_becomes_warn():
    out = normalize(_raw({"pii": 0.1}, action="block", action_p=0.40), _settings())
    assert out["verdict"] == "warn"


def test_only_requested_categories_can_match():
    raw = _raw({"prompt_injection": 0.99})
    raw.answers["cat:secret_leakage"] = {"type": "noul", "noul": 0.99,
                                         "confidence": 0.99}
    out = normalize(raw, _settings())  # secret_leakage not in evaluated
    assert out["matched_categories"] == ["prompt_injection"]


def test_truncated_clean_input_never_reports_allow():
    out = normalize(_raw({"pii": 0.05}, truncated=True), _settings())
    assert out["verdict"] == "warn"
    assert "truncat" in out["reason"]


def test_unevaluated_categories_surface_in_reason():
    out = normalize(_raw({}, unevaluated=["invalid_structure"]), _settings())
    assert out["verdict"] == "allow"
    assert "invalid_structure" in out["reason"]


def test_empty_input_allows():
    raw = RawResult(answers={}, evaluated=[], unevaluated=[])
    out = normalize(raw, _settings())
    assert out["verdict"] == "allow"


def test_invalid_model_payload_raises_instead_of_allowing():
    raw = _raw({"pii": 0.9})
    del raw.answers["cat:pii"]
    with pytest.raises(InferenceError):
        normalize(raw, _settings())
    raw2 = _raw({})
    raw2.answers[ACTION_QID]["choice"] = "nonsense"
    with pytest.raises(InferenceError):
        normalize(raw2, _settings())
