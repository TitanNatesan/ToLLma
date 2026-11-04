# Laya (AI guardrail evaluator)

Model-driven guardrail evaluation for ToLLma. The Laya checkpoint makes every
content-safety decision via typed decisions (`noul` per category, `choice`
for the overall action, `score` for severity). Python only validates input,
invokes the model, and normalizes probabilities — there is no regex,
keyword-list, or heuristic content classifier in this service.

- `GET /health` → `{status, model_loaded, model_version, checkpoint, device,
  uptime_s, ...}` (backend caches 30s; never runs inference)
- `GET /ready` → `{ready, model_loaded, model_version}` (true only after the
  checkpoint loads AND warmup inference succeeds)
- `POST /evaluate {text, categories[]}` → `{verdict, confidence,
  matched_categories, reason, latency_ms, model_version}`
  - `413` on oversize input (> `LAYA_MAX_TEXT_CHARS`, default 64k)
  - `503` when the model is not ready or inference fails — failures never
    become `allow`; the backend's `failure_action` decides
  - `invalid_structure` and unknown categories are reported as unevaluated,
    never matched

## Run

`docker compose up laya` (port 8001). Backend: `LAYA_URL`, `LAYA_TIMEOUT_MS`.

First start downloads the checkpoint (~0.8–1.7 GB) into `HF_HUB_CACHE`
(`/app/.cache`). To persist across restarts, mount a named volume at
`/app/.cache` (compose change is the deployer's call — the stock
`docker-compose.yml` is intentionally untouched).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LAYA_MODEL` | `typed-decisions` | Checkpoint pinned for every call (`english`/`multilingual`/`typed-decisions`) |
| `LAYA_DEVICE` | `cpu` | `cpu`/`cuda`/`mps`/`xpu`; unavailable devices fall back to CPU with a warning |
| `LAYA_MAX_CONCURRENT` | `4` | Inference semaphore (CPU-bound: keep low) |
| `LAYA_INFERENCE_TIMEOUT` | `25` | Seconds per call; timeout → 503 (stays under the backend 30s cap) |
| `LAYA_MAX_TEXT_CHARS` | `65536` | Oversize → 413 |
| `LAYA_MATCH_THRESHOLD` | `0.4` | Category matches at P(true) ≥ this (sweep-tuned, see `eval/`) |
| `LAYA_BLOCK_THRESHOLD` | `0.7` | Block at P(true) ≥ this (or `block` action) |
| `LAYA_ACTION_BLOCK_MIN_CONF` | `0.5` | `block` action below this confidence becomes review |
| `LAYA_THREADS` | `min(4, ncpu)` | Cap torch intra-op threads (CPU); 4 beat 16 on test hardware |

Backend timeout (`LAYA_TIMEOUT_MS`, default 5000) must cover P95 inference
(see `eval/EVAL_REPORT.md`); raise it when serving on CPU.

## Tests & evaluation

- Unit/contract (mocked, no weights): `python -m pytest tests/ -q`
- Real-model eval: `LAYA_MODEL=typed-decisions python eval/run_eval.py`
  (downloads the checkpoint on first run; writes `eval/EVAL_REPORT.md`)

## Accuracy note

Upstream held-out guardrail accuracy for the fine-tuned checkpoint is ~0.76
and moderation is weaker — benchmark on your own policies before enabling
automatic blocking in production. The `review → warn` path exists for exactly
this reason.
