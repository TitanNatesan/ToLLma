# Proposal B — `core/crypto.py` KEK versioning (+ `providers.kek_version`)
# Owner: orchestrator. Why: T2 — one SECRET_KEY compromise or rotation bricks
# every stored credential; no rotation API possible today.

## B1. Exact migration (orchestrator generates via alembic revision --autogenerate after model edit)

Model edit in `backend/src/tollms/models/provider.py`: add
```python
kek_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
```
plus partial index `Index("ix_providers_kek_prev", "id", postgresql_where=text("kek_version = 0"))`
so the "rows still on previous KEK" count is indexed. Additive only.

## B2. Exact `core/crypto.py` replacement logic

```python
ALGORITHM = "fernet"

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from tollms.core.config import get_settings


def _kek(version: int) -> bytes:
    """KEK bytes for one version. v1 = legacy SECRET_KEY digest (back-compat)."""
    if version <= 1:
        raw = get_settings().secret_key
    else:
        raw = os.environ.get("KEK_CURRENT", "")
        if not raw:
            raise ValueError("KEK_CURRENT is required for kek_version > 1")
    return base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())


def _fernet(version: int = 1) -> Fernet:
    return Fernet(_kek(version))


def encrypt(plaintext: str, *, kek_version: int = 1) -> str:
    return _fernet(kek_version).encrypt(plaintext.encode()).decode()


def decrypt(token: str, *, kek_versions: tuple[int, ...] = (1,)) -> str:
    """Try current first, then previous. Raises ValueError when none open."""
    last: Exception | None = None
    for version in kek_versions:
        try:
            return _fernet(version).decrypt(token.encode()).decode()
        except (InvalidToken, ValueError) as e:
            last = e
    raise ValueError("cannot decrypt credentials") from last
```

Call-site updates: `api/providers/service.py::create/update_provider` pass
`kek_version=CURRENT_KEK_VERSION` and stamp `provider.kek_version`; every
`decrypted_credentials` call passes `kek_versions=(current, previous)` while
any row has `kek_version == previous`, else `(current,)`. Rotation endpoint
(`api/security`, Agent C Wave 3): batch re-encrypt `kek_version=previous`
rows with CURRENT, then drop KEK_PREVIOUS env. `GET /kek/status` flips
`rotation_supported=true` once this lands.

## B3. Why this shape

Try-current-then-previous = zero-downtime rotation, no re-login, no mass
decrypt outage. v1 pinned to SECRET_KEY digest = existing rows open without
a migration-time re-encrypt. Env-held KEKs (never DB) keep the envelope clean.
