# Proposal C — `main.py` security headers + pre-auth `/v1/*` limiter
# Owner: orchestrator. Why: T5 (unknown-key floods hit PG post-auth-only
# limits) + T6 (no CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy).

## C1. Exact middleware (insert after the CORS block in `create_app`)

```python
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if get_settings().environment == "prod":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/") or request.url.path.startswith("/v1/"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return response
```

Also: gate the local-origin carve-outs (`127.0.0.1/172.17.0.1:3000`) behind
`if settings.environment == "local"` (today they apply in every env once the
list is built — the outer `if` already does this; keep it and never extend).

## C2. Pre-auth `/v1/*` IP limiter (note, not full code)

New dependency on the public gateway (`api/public_gateway/service.py::
api_key_required` chain): `core/rate_limit.limit("gateway:preauth",
max_attempts=120, window_seconds=60)` keyed on `gateway_client_ip` — BEFORE
`authenticate`, fail-CLOSED (503 when Valkey down, same contract as auth
limits). Why fail-closed here but fail-open inside `limits.py`: unknown keys
have no budget identity, so any allowance is unbounded; 120/min/IP is
generous to honest clients and cheap to enforce. On 429, emit
`gateway.denied` with `reason="preauth_flood"` (Agent C audit table absorbs it).
