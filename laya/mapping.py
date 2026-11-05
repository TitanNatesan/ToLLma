"""Decision normalization: model probabilities -> ToLLma verdict envelope.

Mapping only — no content judgment. Every number returned here originates in
the model's answers; thresholds gate probabilities, they never classify text.

verdict space: allow | warn | block (backend contract).
model space:   allow | review | block, review -> warn.
"""

from config import Settings
from engine import InferenceError, RawResult
from questions import ACTION_QID, SEVERITY_QID


def _noul_p(answers: dict, qid: str) -> float:
    try:
        p = float(answers[qid]["noul"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InferenceError(f"missing/invalid noul answer for {qid}") from exc
    if not 0.0 <= p <= 1.0:
        raise InferenceError(f"noul probability out of range for {qid}: {p}")
    return p


def _choice(answers: dict, qid: str) -> tuple[str, float]:
    try:
        ans = answers[qid]
        label = str(ans["choice"])
        conf = float((ans.get("probabilities") or {}).get(label, ans.get("confidence", 0.0)))
    except (KeyError, TypeError, ValueError) as exc:
        raise InferenceError(f"missing/invalid choice answer for {qid}") from exc
    if label not in ("allow", "review", "block"):
        raise InferenceError(f"unexpected action choice: {label!r}")
    return label, max(0.0, min(1.0, conf))


def _severity(answers: dict, qid: str) -> float:
    try:
        return round(max(0.0, min(4.0, float(answers[qid]["score"]))), 2)
    except (KeyError, TypeError, ValueError):
        return 0.0  # severity is advisory; never block normalization


def normalize(raw: RawResult, settings: Settings) -> dict:
    """Map one RawResult to the backend's {verdict, confidence, ...} envelope."""
    probs: dict[str, float] = {}
    for cat in raw.evaluated:
        probs[cat] = _noul_p(raw.answers, f"cat:{cat}")

    if raw.answers:
        action, action_conf = _choice(raw.answers, ACTION_QID)
        severity = _severity(raw.answers, SEVERITY_QID)
    else:  # empty input: nothing to judge, clean by construction
        action, action_conf, severity = "allow", 1.0, 0.0

    matched = sorted(c for c, p in probs.items() if p >= settings.match_threshold)
    top_p = max(probs.values(), default=0.0)

    # A block action without majority confidence is uncertainty, not a verdict.
    strong_block = (action == "block"
                    and action_conf >= settings.action_block_min_conf)
    if strong_block or any(p >= settings.block_threshold for p in probs.values()):
        verdict = "block"
        confidence = max(action_conf if action == "block" else 0.0,
                         max([p for p in probs.values()
                              if p >= settings.block_threshold], default=0.0))
    elif action in ("review", "block") or matched:
        verdict = "warn"
        confidence = max(action_conf if action in ("review", "block") else 0.0,
                         max([probs[c] for c in matched], default=0.0))
    else:
        verdict, confidence = "allow", action_conf

    notes: list[str] = []
    if raw.truncated:
        # Partial content was evaluated: never report a clean bill of health.
        notes.append(f"input truncated to model context ({raw.usage.get('state_tokens', '?')} tokens)")
        if verdict == "allow":
            verdict, confidence = "warn", max(top_p, 0.01)
            notes.append("partial evaluation -> review")
    if raw.unevaluated:
        notes.append("unevaluated: " + ",".join(sorted(set(raw.unevaluated))))

    reason = f"laya {verdict}"
    if matched:
        shown = ",".join(f"{c}={probs[c]:.2f}" for c in matched[:5])
        reason += f": {shown}"
    reason += f" [action={action} severity={severity}/4]"
    if notes:
        reason += " (" + "; ".join(notes) + ")"
    return {
        "verdict": verdict,
        "confidence": round(float(confidence), 4),
        "matched_categories": matched,
        "reason": reason[:500],
        "severity": severity,
        "action": action,
    }
