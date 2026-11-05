"""Dump raw model answers for given case ids (miss analysis, not a test)."""

import asyncio
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from config import Settings  # noqa: E402
from engine import ModelEngine  # noqa: E402
from questions import ACTION_QID, SEVERITY_QID  # noqa: E402


def main(ids: list[str]) -> None:
    settings = Settings()
    engine = ModelEngine(settings)
    engine.startup()
    cases = [json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines()
             if l.strip()]
    if ids == ["ALL"]:
        ids = [c["id"] for c in cases]
        dump: dict = {}
    else:
        dump = None
    for case in cases:
        if case["id"] not in ids:
            continue
        raw = asyncio.run(engine.evaluate(case["text"], case["categories"]))
        if dump is not None:
            dump[case["id"]] = {"answers": raw.answers, "usage": raw.usage,
                                "evaluated": raw.evaluated,
                                "unevaluated": raw.unevaluated,
                                "routing_model": raw.routing_model}
            continue
        print(f"=== {case['id']} [{case['group']}] {case['text'][:80]}")
        for qid, ans in raw.answers.items():
            if qid.startswith("cat:"):
                print(f"  {qid[4:]:20} noul={ans.get('noul')} "
                      f"conf={ans.get('confidence')}")
            elif qid == ACTION_QID:
                print(f"  action={ans.get('choice')} probs={ans.get('probabilities')}")
            elif qid == SEVERITY_QID:
                print(f"  severity={ans.get('score')} probs={ans.get('probabilities')}")
    if dump is not None:
        (HERE / "raw_td.json").write_text(json.dumps(dump))
        print(f"dumped {len(dump)} cases to raw_td.json")
    engine.shutdown()


if __name__ == "__main__":
    main(sys.argv[1:])
