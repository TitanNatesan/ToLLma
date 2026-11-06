# Proposal D — `core/config.py` required `JWT_SECRET` (no silent fallback)
# Owner: orchestrator. Why: T7 — `jwt_secret or secret_key` means one leaked
# value compromises sessions AND the credential KEK; silent fallback hides it.

## Exact change

```python
# JWT authentication (REQUIRED: no fallback — sessions and the credential
# KEK must use independent secrets).
jwt_secret: str
```

and delete the `jwt_signing_key` fallback property, replacing its two users
(`core/passwords.py::_encode/_decode`) with direct `get_settings().jwt_secret`:

```python
def _encode(payload: dict) -> str:
    settings = get_settings()
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
```

## Migration note (ops, not code)

Deploy in two steps: (1) set `JWT_SECRET=<current SECRET_KEY value>` in env
— sessions keep verifying, zero logout; (2) rotate `JWT_SECRET` to a fresh
value at a low-traffic window (forces global re-login once, then sessions
and KEK are independent). Add `kid` header + rotation map only if a second
rotation is ever needed — YAGNI until then.
