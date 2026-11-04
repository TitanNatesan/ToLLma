"""Offline threshold sweep over dumped raw answers (no inference).

Replays mapping.normalize across a threshold grid and reports correctness +
violation-positive F1 per combo. No model calls; safe to run anywhere.
"""

import itertools
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from config import Settings  # noqa: E402
from engine import RawResult  # noqa: E402
from mapping import normalize  # noqa: E402


def main() -> None:
    raw = json.loads((HERE / "raw_td.json").read_text())
    cases = [json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines()
             if l.strip()]
    fields = Settings.__dataclass_fields__
    base = {k: v for k, v in Settings().__dict__.items()}

    def settings_for(match, block, abmin):
        kw = dict(base, match_threshold=match, block_threshold=block,
                  action_block_min_conf=abmin)
        return Settings(**{k: v for k, v in kw.items() if k in fields})

    def to_raw(cid):
        d = raw[cid]
        return RawResult(answers=d["answers"], usage=d["usage"],
                         evaluated=d["evaluated"], unevaluated=d["unevaluated"],
                         routing_model=d["routing_model"])

    print("match block abmin | correct F1 (TP FP FN TN)")
    best = None
    for match, block, abmin in itertools.product(
            [0.3, 0.35, 0.4, 0.45, 0.5], [0.6, 0.7, 0.8], [0.4, 0.5, 0.6]):
        s = settings_for(match, block, abmin)
        n_ok = tp = fp = fn = tn = 0
        for case in cases:
            try:
                v = normalize(to_raw(case["id"]), s)["verdict"]
            except Exception:
                v = "ERROR"
            ok = v in case["expect"]
            n_ok += ok
            violent = v in ("warn", "block", "ERROR")
            target = "allow" not in case["expect"]
            if violent and target:
                tp += 1
            elif violent:
                fp += 1
            elif target:
                fn += 1
            else:
                tn += 1
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        # Safety-first ranking: fewest misses on violation cases, then F1.
        key = (fn, -(n_ok), -f1)
        if best is None or key < best[0]:
            best = (key, match, block, abmin, n_ok, f1, tp, fp, fn, tn)
        print(f"{match:.2f}  {block:.2f}  {abmin:.2f}  | "
              f"{n_ok:2}/49 F1={f1:.3f} (TP={tp} FP={fp} FN={fn} TN={tn})")
    _, m, b, a, n_ok, f1, tp, fp, fn, tn = best
    print(f"\nBEST fn-first: match={m} block={b} abmin={a} "
          f"correct={n_ok}/49 F1={f1:.3f} TP={tp} FP={fp} FN={fn} TN={tn}")


if __name__ == "__main__":
    main()
