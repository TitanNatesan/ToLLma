# Laya (guardrail evaluator)

CPU-only heuristic evaluator for ToLLma Guardrails. No credentials, no model
weights — swap `score()` in `app.py` for a real model and bump MODEL_VERSION.

- `GET /health` → `{status, model_version, uptime_s}` (backend caches 30s)
- `GET /ready` → `{ready, model_version}`
- `POST /evaluate {text, categories[]}` → `{verdict, confidence,
  matched_categories, reason, latency_ms, model_version}` (413 over 64k)

Run: `docker compose up laya` (port 8001). Backend: `LAYA_URL`, `LAYA_TIMEOUT_MS`.
