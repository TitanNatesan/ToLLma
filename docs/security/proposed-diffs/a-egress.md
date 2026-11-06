# Proposal A — NEW `backend/src/tollms/core/egress.py` + SSRF call sites
# Owner: orchestrator (Agent C may not touch core/*). Why: T1 — CUSTOM
# base_url is dialed with zero validation (validate/discover/chat/transcribe).

## A1. Exact new file: backend/src/tollms/core/egress.py

```python
"""SSRF destination validation for provider egress (stdlib only).

`assert_safe_url` runs BEFORE any dial: http(s)-only, resolve-and-pin DNS
(rejects private/loopback/link-local/multicast/reserved/unspecified for
EVERY resolved A/AAAA record — kills DNS rebinding), and `safe_join`
re-validates each redirect hop. Timeouts/response caps enforced by callers.
"""

import ipaddress
import logging
import socket
import urllib.parse

logger = logging.getLogger(__name__)

MAX_URL_LEN = 2048
RESOLVE_TIMEOUT_SECONDS = 5.0


class UnsafeEgressError(ValueError):
    """Raised when a provider URL must not be dialed. Message is log/display safe."""


def _reject_ip(addr: ipaddress._BaseAddress, *, what: str) -> None:
    if (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
    ):
        raise UnsafeEgressError(f"refused egress to non-public address ({what})")


def assert_safe_url(raw_url: str) -> str:
    """Validate + normalize a provider base URL. Returns the pinned URL.

    Raises UnsafeEgressError (caller maps to 422) on any refusal. Never
    raises on DNS failure with details — message stays generic.
    """
    if not raw_url or len(raw_url) > MAX_URL_LEN:
        raise UnsafeEgressError("invalid provider URL")
    try:
        parts = urllib.parse.urlsplit(raw_url.strip())
    except ValueError:
        raise UnsafeEgressError("invalid provider URL") from None
    if parts.scheme not in ("http", "https"):
        raise UnsafeEgressError("provider URL must be http(s)")
    if not parts.hostname:
        raise UnsafeEgressError("invalid provider URL")
    if "@" in (parts.netloc or "") and parts.hostname not in (parts.netloc or ""):
        raise UnsafeEgressError("provider URL must not embed credentials")
    host = parts.hostname
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        _reject_ip(literal, what="literal")
        return parts.geturl()
    old_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(RESOLVE_TIMEOUT_SECONDS)
    try:
        infos = socket.getaddrinfo(host, None, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM)
    except (socket.gaierror, socket.timeout, OSError):
        raise UnsafeEgressError("provider host does not resolve") from None
    finally:
        socket.setdefaulttimeout(old_timeout)
    if not infos:
        raise UnsafeEgressError("provider host does not resolve")
    for info in infos:
        try:
            _reject_ip(ipaddress.ip_address(info[4][0]), what="resolved")
        except ValueError:
            raise UnsafeEgressError("provider host does not resolve") from None
    return parts.geturl()


def safe_join(base_url: str, path: str) -> str:
    """Join + re-validate (redirect hops must pass `assert_safe_url`)."""
    joined = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    return assert_safe_url(joined)
```

## A2. Call sites (exact insertions)

1. `backend/src/tollms/api/providers/service.py` — top: add
   `from tollms.core.egress import UnsafeEgressError, assert_safe_url` and
   import `ValidationError` (already imported). In `create_provider` and
   `update_provider`, right after `credentials = dict(...)`:
   ```python
   base = credentials.get("base_url")
   if base is not None:
       try:
           credentials["base_url"] = assert_safe_url(str(base))
       except UnsafeEgressError as e:
           raise ValidationError(str(e)) from None
   ```
   Same guard at the top of `draft_validate` (covers the wizard path, which
   never persists). Why here: single choke point — every stored or probed
   URL passes validation before persist/probe; adapters inherit safety.
2. `backend/src/tollms/services/gateway/adapters/base.py::_client` —
   construct with `follow_redirects=False` (default already False in httpx;
   make explicit) and add a response hook? Minimal: keep `follow_redirects=False`
   and let per-endpoint code follow manually via `safe_join`. Explicit one-line
   change documents the invariant where every adapter builds its client.
3. `backend/src/tollms/services/gateway/attachments.py::transcribe_audio` —
   first line of body: `url = safe_join(assert_safe_url(base_url), "/audio/transcriptions")`
   (replaces the raw `base_url.rstrip("/") + ...`). Why: transcription dials
   with the provider's own creds — same SSRF sink, missed by provider-layer checks.
# ponytail: DNS resolve per request; add a short-TTL cache only if measurable.
