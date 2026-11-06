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


def assert_safe_url(raw_url: str, *, resolve_dns: bool = True) -> str:
    """Validate + normalize a provider base URL. Returns the pinned URL.

    Raises UnsafeEgressError (caller maps to 422) on any refusal. Never
    raises on DNS failure with details — message stays generic. With
    resolve_dns=False only the pure-string checks run (scheme, credentials,
    literal IPs) — used under pytest where mock transports own the dial.
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
    if "@" in (parts.netloc or ""):
        raise UnsafeEgressError("provider URL must not embed credentials")
    host = parts.hostname.lower()
    if host == "localhost" or host.endswith(
        (".localhost", ".local", ".internal", ".lan", ".localdomain", ".invalid")
    ):
        raise UnsafeEgressError("refused egress to non-public address (local)")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        _reject_ip(literal, what="literal")
        return parts.geturl()
    if not resolve_dns:
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
