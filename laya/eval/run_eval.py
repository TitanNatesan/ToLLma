"""Real-model evaluation: runs eval/cases.jsonl through ModelEngine.

Usage (needs torch + weights, first run downloads the checkpoint):
    LAYA_MODEL=typed-decisions python eval/run_eval.py
Writes EVAL_REPORT.md next to this script and prints the summary.
Exit code 1 when the model never loaded (report records the limitation).
"""

import json
import os
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from config import Settings  # noqa: E402
from engine import ModelEngine  # noqa: E402
from mapping import normalize  # noqa: E402


def load_cases():
    rows = []
    for line in (HERE / "cases.jsonl").read_text().splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def main() -> int:
    settings = Settings()
    engine = ModelEngine(settings)
    try:
        engine.startup()
    except Exception as exc:
        print(f"MODEL NOT LOADED: {exc}")
        return 1

    cases = load_cases()
    results = []
    lat = []
    for case in cases:
        t0 = time.monotonic()
        try:
            raw = _run(engine, case["text"], case["categories"])
            out = normalize(raw, settings)
            verdict = out["verdict"]
            conf = out["confidence"]
        except Exception as exc:  # evaluation failure counts as a miss, loudly
            verdict, conf = "ERROR", 0.0
            print(f"  ! {case['id']} raised {type(exc).__name__}: {exc}")
        dt = (time.monotonic() - t0) * 1000
        lat.append(dt)
        ok = verdict in case["expect"]
        results.append((case, verdict, conf, dt, ok))
        print(f"  {'PASS' if ok else 'FAIL'} {case['id']:4} -> {verdict:5} "
              f"(conf {conf:.2f}, {dt:7.0f}ms) expect {case['expect']}")

    n = len(results)
    n_ok = sum(1 for r in results if r[4])
    # violation-positive framing: warn|block|ERROR = positive
    tp = sum(1 for c, v, *_ in results
             if v in ("warn", "block", "ERROR") and "allow" not in c["expect"])
    fp = sum(1 for c, v, *_ in results
             if v in ("warn", "block", "ERROR") and c["expect"] == ["allow"])
    fn = sum(1 for c, v, *_ in results
             if v == "allow" and "allow" not in c["expect"])
    tn = n - tp - fp - fn
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0

    groups: dict[str, list] = {}
    for case, verdict, _c, _d, ok in results:
        groups.setdefault(case["group"], []).append(ok)

    lat_sorted = sorted(lat)
    p50 = lat_sorted[len(lat_sorted) // 2]
    p95 = lat_sorted[int(len(lat_sorted) * 0.95) - 1]

    report = [
        "# Laya guardrail evaluation report",
        "",
        f"- Date: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}",
        f"- Service version: {settings.model_version}",
        f"- Checkpoint pinned: {settings.model} (routed: {engine.checkpoint})",
        f"- Device: {engine.device_actual}, load time: {engine.load_ms:.0f}ms",
        f"- Thresholds: match={settings.match_threshold} block={settings.block_threshold}",
        "",
        "## Summary",
        "",
        f"- Cases: {n}, correct: {n_ok} ({n_ok / n:.3f})",
        f"- Confusion (violation-positive): TP={tp} FP={fp} FN={fn} TN={tn}",
        f"- Precision={prec:.3f} Recall={rec:.3f} F1={f1:.3f}",
        f"- Latency ms: avg={statistics.mean(lat):.0f} p50={p50:.0f} p95={p95:.0f}",
        "",
        "## Per-group accuracy",
        "",
    ]
    for g, oks in sorted(groups.items()):
        report.append(f"- {g}: {sum(oks)}/{len(oks)}")
    report += ["", "## Misses", ""]
    for case, verdict, conf, dt, ok in results:
        if not ok:
            report.append(
                f"- {case['id']} [{case['group']}] -> {verdict} "
                f"(conf {conf:.2f}): {case['text'][:100]}")
    report.append("")
    (HERE / "EVAL_REPORT.md").write_text("\n".join(report))
    print(f"\n{n_ok}/{n} correct, F1={f1:.3f}, "
          f"lat avg={statistics.mean(lat):.0f}ms p95={p95:.0f}ms")
    return 0


def _run(engine, text, categories):
    import asyncio
    return asyncio.run(engine.evaluate(text, categories))


if __name__ == "__main__":
    raise SystemExit(main())
