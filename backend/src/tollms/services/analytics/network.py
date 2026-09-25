"""Network analytics for one API key: IPs, geo, devices and clients.

All queries are grouped SQL scoped to the key. Definitions:

* ``unique_ips`` — distinct IPs with traffic in the window.
* ``new_ips`` — IPs whose first-ever appearance for the key falls inside the
  window. The IP query therefore groups the key's whole history (an indexed
  ``api_key_id`` scan) and filters with ``HAVING`` to window-active IPs; this
  is the one intentionally lifetime-scoped query in the analytics API.
* ``blocked_ips`` — IPs matching the key's deny rules, or excluded by a
  non-empty allow-list (``ipaddress`` CIDR math, invalid rules skipped).
* ``allowed_ips`` — window-unique IPs that are not blocked.

Client detection is a regex table over the User-Agent (no new dependency):
``openai-python``, ``anthropic``, ``claude-code``, ``cursor``, ``cline``,
``continue``, ``curl``, ``python-requests``, ``node-fetch``, else ``custom``
(empty UA -> ``unknown``). The ``sdk`` column is the stored browser family
(``SDK``, ``curl``, ``Chrome`` ...), ``unknown`` when absent.
"""

import ipaddress
import logging
import re
from typing import Any, Callable, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog

logger = logging.getLogger(__name__)

_TOP = 10

CLIENT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("claude-code", re.compile(r"claude[-_ ]?code", re.IGNORECASE)),
    ("cursor", re.compile(r"\bcursor\b", re.IGNORECASE)),
    ("cline", re.compile(r"\bcline\b", re.IGNORECASE)),
    ("continue", re.compile(r"\bcontinue\b", re.IGNORECASE)),
    (
        "openai-python",
        re.compile(r"openai[-_/ ]?(python|agents)|OpenAI/Python", re.IGNORECASE),
    ),
    ("anthropic", re.compile(r"anthropic", re.IGNORECASE)),
    ("python-requests", re.compile(r"python-requests|requests/\d", re.IGNORECASE)),
    ("node-fetch", re.compile(r"node-fetch", re.IGNORECASE)),
    ("curl", re.compile(r"^curl/|[\s(]curl/", re.IGNORECASE)),
)


def detect_client(user_agent: str | None) -> str:
    """Client family from the User-Agent (``custom`` for unlisted non-empty UAs)."""
    ua = (user_agent or "").strip()
    if not ua:
        return "unknown"
    for name, pattern in CLIENT_PATTERNS:
        if pattern.search(ua):
            return name
    return "custom"


def _rule_networks(rules: Iterable[str]) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for rule in rules:
        try:
            networks.append(ipaddress.ip_network(str(rule).strip(), strict=False))
        except ValueError:
            logger.warning("analytics network: ignoring invalid IP rule %r", rule)
    return networks


def _matcher(
    allow: list[ipaddress.IPv4Network | ipaddress.IPv6Network],
    deny: list[ipaddress.IPv4Network | ipaddress.IPv6Network],
) -> Callable[[str | None], bool]:
    def blocked(ip: str | None) -> bool:
        if not ip:
            return False
        try:
            address = ipaddress.ip_address(ip.strip())
        except ValueError:
            return False
        if any(address in network for network in deny):
            return True
        return bool(allow) and not any(address in network for network in allow)

    return blocked


def _window_conditions(window: Any, key_id: Any) -> list[Any]:
    return [
        ApiRequestLog.api_key_id == key_id,
        ApiRequestLog.created_at >= window.start,
        ApiRequestLog.created_at < window.end,
    ]


def _ip_rows(db: Session, window: Any, key_id: Any) -> list[Any]:
    window_count = func.count(ApiRequestLog.id).filter(
        ApiRequestLog.created_at >= window.start,
        ApiRequestLog.created_at < window.end,
    )
    return db.execute(
        select(
            ApiRequestLog.ip_address,
            window_count,
            func.min(ApiRequestLog.created_at),
            func.max(ApiRequestLog.created_at),
        )
        .where(ApiRequestLog.api_key_id == key_id, ApiRequestLog.ip_address.is_not(None))
        .group_by(ApiRequestLog.ip_address)
        .having(window_count > 0)
    ).all()


def _location_rows(db: Session, window: Any, key_id: Any) -> list[Any]:
    return db.execute(
        select(
            ApiRequestLog.country,
            ApiRequestLog.city,
            ApiRequestLog.region,
            func.count(ApiRequestLog.id),
        )
        .where(*_window_conditions(window, key_id))
        .group_by(ApiRequestLog.country, ApiRequestLog.city, ApiRequestLog.region)
        .order_by(func.count(ApiRequestLog.id).desc())
        .limit(_TOP)
    ).all()


def _device_rows(db: Session, window: Any, key_id: Any) -> list[Any]:
    return db.execute(
        select(
            ApiRequestLog.device_type,
            ApiRequestLog.platform,
            ApiRequestLog.browser,
            ApiRequestLog.user_agent,
            func.count(ApiRequestLog.id),
        )
        .where(*_window_conditions(window, key_id))
        .group_by(
            ApiRequestLog.device_type,
            ApiRequestLog.platform,
            ApiRequestLog.browser,
            ApiRequestLog.user_agent,
        )
        .order_by(func.count(ApiRequestLog.id).desc())
        .limit(_TOP)
    ).all()


def _client_rows(db: Session, window: Any, key_id: Any) -> tuple[list[dict[str, Any]], int]:
    rows = db.execute(
        select(ApiRequestLog.user_agent, ApiRequestLog.browser, func.count(ApiRequestLog.id))
        .where(*_window_conditions(window, key_id))
        .group_by(ApiRequestLog.user_agent, ApiRequestLog.browser)
    ).all()
    buckets: dict[tuple[str, str], int] = {}
    for user_agent, browser, requests in rows:
        key = (detect_client(user_agent), browser or "unknown")
        buckets[key] = buckets.get(key, 0) + int(requests or 0)
    total = sum(buckets.values())
    shaped = [
        {
            "client": client,
            "sdk": sdk,
            "requests": requests,
            "share": round(requests / total, 4) if total else 0.0,
        }
        for (client, sdk), requests in buckets.items()
    ]
    shaped.sort(key=lambda item: item["requests"], reverse=True)
    return shaped[:_TOP], total


def network(
    db: Session,
    window: Any,
    key_id: Any,
    *,
    allow_rules: Iterable[str] = (),
    deny_rules: Iterable[str] = (),
) -> dict[str, Any]:
    """IP/geo/device/client sections for one key (4 grouped queries)."""
    blocked = _matcher(_rule_networks(allow_rules), _rule_networks(deny_rules))
    ip_rows = _ip_rows(db, window, key_id)
    ips = [
        {
            "ip": row[0],
            "requests": int(row[1] or 0),
            "last_seen_at": row[3],
            "blocked": blocked(row[0]),
        }
        for row in ip_rows
    ]
    blocked_ips = sum(1 for item in ips if item["blocked"])
    new_ips = sum(1 for row in ip_rows if row[2] is not None and row[2] >= window.start)
    clients, total_requests = _client_rows(db, window, key_id)
    ips.sort(key=lambda item: item["requests"], reverse=True)
    return {
        "unique_ips": len(ips),
        "blocked_ips": blocked_ips,
        "allowed_ips": len(ips) - blocked_ips,
        "new_ips": new_ips,
        "ips": ips[:_TOP],
        "locations": [
            {
                "country": row[0],
                "city": row[1],
                "region": row[2],
                "requests": int(row[3] or 0),
            }
            for row in _location_rows(db, window, key_id)
        ],
        "devices": [
            {
                "device_type": row[0],
                "platform": row[1],
                "browser": row[2],
                "user_agent": row[3],
                "requests": int(row[4] or 0),
            }
            for row in _device_rows(db, window, key_id)
        ],
        "clients": clients,
    }
