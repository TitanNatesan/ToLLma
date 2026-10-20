"""Public-gateway request log + per-key analytics (metadata only, no content).

`log_request` persists one `api_request_logs` row per public request: tokens,
costs, status, latency, client metadata and geo. User agents are parsed with
regexes (no extra dependency); geo comes from a MaxMind-style database when
`GEOIP_DB_PATH` is configured, otherwise country/city/region stay NULL —
private/loopback addresses are labelled `country="local"`, never fabricated.

`key_analytics` runs grouped SQL aggregations (no N+1) for one key owned by
`user_id`. Presets resolve locally (services must not import from `api/`);
day buckets are UTC.
"""

import ipaddress
import logging
import os
import re
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterator
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.services.analytics import presets as preset_vocab
from tollms.services.request_logs import touch_key_last_used

logger = logging.getLogger(__name__)

__all__ = ["ApiLogEntry", "key_analytics", "log_request", "parse_client_meta"]

_TOP_LIMIT = 10
_PRESETS = ("today", "last_7d", "last_30d", "last_90d", "this_month")

# --- user-agent parsing (regex only: no new dependency) ----------------------

_CURL_RE = re.compile(r"^curl/", re.IGNORECASE)
_SDK_RE = re.compile(
    r"(python|httpx|requests/|openai|anthropic|langchain|okhttp|node-fetch|axios|"
    r"go-http-client|java/|aiohttp|urllib|postmanruntime)",
    re.IGNORECASE,
)
_EDGE_RE = re.compile(r"(Edg/|EdgA/|Edge/)", re.IGNORECASE)
_CHROME_RE = re.compile(r"(Chrome/|CriOS/)", re.IGNORECASE)
_FIREFOX_RE = re.compile(r"(Firefox/|FxiOS/)", re.IGNORECASE)
_SAFARI_RE = re.compile(r"Safari/", re.IGNORECASE)
_TABLET_RE = re.compile(r"(iPad|Tablet|Android(?!.*Mobile))", re.IGNORECASE)
_MOBILE_RE = re.compile(r"(Mobile|iPhone|iPod|Windows Phone|Android)", re.IGNORECASE)
_IOS_RE = re.compile(r"(iPhone|iPad|iPod)", re.IGNORECASE)
_WINDOWS_RE = re.compile(r"Windows", re.IGNORECASE)
_MAC_RE = re.compile(r"(Macintosh|Mac OS X)", re.IGNORECASE)
_LINUX_RE = re.compile(r"Linux", re.IGNORECASE)


def _ua_fields(user_agent: str | None) -> tuple[str | None, str | None, str | None]:
    """(device_type, platform, browser). None when the UA is absent/unknown."""
    if not user_agent or not user_agent.strip():
        return None, None, None
    ua = user_agent.strip()

    if _TABLET_RE.search(ua):
        device = "tablet"
    elif _MOBILE_RE.search(ua):
        device = "mobile"
    else:
        device = "desktop"

    if _IOS_RE.search(ua):
        platform = "iOS"
    elif "Android" in ua:
        platform = "Android"
    elif _WINDOWS_RE.search(ua):
        platform = "Windows"
    elif _MAC_RE.search(ua):
        platform = "macOS"
    elif _LINUX_RE.search(ua):
        platform = "Linux"
    else:
        platform = None

    if _CURL_RE.search(ua):
        browser = "curl"
    elif _SDK_RE.search(ua):
        browser = "SDK"
    elif _EDGE_RE.search(ua):  # Edge embeds both Chrome/ and Safari/ tokens
        browser = "Edge"
    elif _CHROME_RE.search(ua):
        browser = "Chrome"
    elif _FIREFOX_RE.search(ua):
        browser = "Firefox"
    elif _SAFARI_RE.search(ua):
        browser = "Safari"
    else:
        browser = None
    return device, platform, browser


# --- geo (optional MaxMind database; never fabricated) -----------------------

_geo_lock = threading.Lock()
_geo_reader: Any = None
_geo_reader_path: str | None = None


def _open_geo_reader(path: str) -> Any:
    try:
        from geoip2.database import Reader  # type: ignore[import-not-found]

        return Reader(path)
    except Exception:
        pass
    try:
        import maxminddb  # type: ignore[import-not-found]

        return maxminddb.open_database(path)
    except Exception:
        logger.warning("api_logs: GEOIP_DB_PATH set but no MaxMind reader available; geo stays NULL")
        return None


def _geo_reader_for(path: str) -> Any:
    global _geo_reader, _geo_reader_path
    with _geo_lock:
        if _geo_reader is not None and _geo_reader_path == path:
            return _geo_reader
        _geo_reader = _open_geo_reader(path)
        _geo_reader_path = path
        return _geo_reader


def _geo_record_fields(record: Any) -> tuple[str | None, str | None, str | None]:
    if record is None:
        return None, None, None
    if isinstance(record, dict):  # maxminddb raw mapping
        country = (record.get("country") or {}).get("iso_code")
        city = ((record.get("city") or {}).get("names") or {}).get("en")
        subdivisions = record.get("subdivisions") or []
        region = ((subdivisions[0] or {}).get("names") or {}).get("en") if subdivisions else None
        return country, city, region
    country = getattr(getattr(record, "country", None), "iso_code", None)  # geoip2 model
    city_obj = getattr(record, "city", None)
    city = getattr(city_obj, "name", None) if city_obj is not None else None
    subdivisions = getattr(record, "subdivisions", None) or []
    if subdivisions:
        names = getattr(subdivisions[0], "names", None) or {}
        region = names.get("en") if isinstance(names, dict) else getattr(subdivisions[0], "name", None)
    else:
        region = None
    return country, city, region


def _is_local(addr: Any) -> bool:
    return bool(
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_unspecified
        or addr.is_reserved
        or addr.is_multicast
    )


def _geo_for_ip(ip: str | None) -> tuple[str | None, str | None, str | None]:
    """(country, city, region). `local` for private/loopback, NULL without a geo DB."""
    if not ip:
        return None, None, None
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return None, None, None
    if _is_local(addr):
        return "local", None, None
    path = os.environ.get("GEOIP_DB_PATH")
    if not path:
        return None, None, None
    if not os.path.exists(path):
        logger.warning("api_logs: GEOIP_DB_PATH does not exist: %s", path)
        return None, None, None
    try:
        reader = _geo_reader_for(path)
        if reader is None:
            return None, None, None
        return _geo_record_fields(reader.get(str(addr)))
    except Exception:
        logger.warning("api_logs: geo lookup failed; geo stays NULL", exc_info=True)
        return None, None, None


def parse_client_meta(user_agent: str | None, ip: str | None) -> dict:
    """Device/platform/browser from the UA; country/city/region from the IP."""
    device, platform, browser = _ua_fields(user_agent)
    country, city, region = _geo_for_ip(ip)
    return {
        "device_type": device,
        "platform": platform,
        "browser": browser,
        "country": country,
        "city": city,
        "region": region,
    }


# --- request logging ---------------------------------------------------------


@dataclass
class ApiLogEntry:
    """Plain-data input for one `api_request_logs` row (no payloads, ever)."""

    request_id: str
    api_key_id: uuid.UUID | None
    user_id: uuid.UUID | None
    provider: str | None
    model: str | None
    endpoint: str
    status: str = "success"
    error_code: str | None = None
    latency_ms: float | None = None
    cost: Decimal | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    is_streaming: bool = False
    # Server-derived org attribution: the resolving key's org (None = personal).
    org_id: uuid.UUID | None = None


def _derive_total(entry: ApiLogEntry) -> int | None:
    if entry.input_tokens is None and entry.output_tokens is None:
        return None
    return (entry.input_tokens or 0) + (entry.output_tokens or 0)


@contextmanager
def _savepoint(db: Session) -> Iterator[None]:
    """Isolate the insert so a logging failure cannot poison the caller's tx."""
    nested = db.begin_nested()
    try:
        yield
        nested.commit()
    except Exception:
        nested.rollback()
        raise


def log_request(db: Session, entry: ApiLogEntry) -> None:
    """Insert one request-log row. Never raises and never stores content."""
    try:
        meta = parse_client_meta(entry.user_agent, entry.ip_address)
        row = ApiRequestLog(
            request_id=entry.request_id,
            api_key_id=entry.api_key_id,
            user_id=entry.user_id,
            org_id=entry.org_id,
            provider=entry.provider,
            model=entry.model,
            endpoint=entry.endpoint,
            status=entry.status,
            error_code=entry.error_code,
            latency_ms=entry.latency_ms,
            cost=entry.cost,
            input_tokens=entry.input_tokens,
            output_tokens=entry.output_tokens,
            cache_read_tokens=entry.cache_read_tokens,
            cache_write_tokens=entry.cache_write_tokens,
            reasoning_tokens=entry.reasoning_tokens,
            total_tokens=entry.total_tokens if entry.total_tokens is not None else _derive_total(entry),
            ip_address=entry.ip_address,
            user_agent=entry.user_agent,
            device_type=meta["device_type"],
            platform=meta["platform"],
            browser=meta["browser"],
            country=meta["country"],
            city=meta["city"],
            region=meta["region"],
            is_streaming=entry.is_streaming,
        )
        with _savepoint(db):
            db.add(row)
            db.flush()
            # last_used_at = most recent SUCCESSFULLY COMPLETED request only:
            # failed/cancelled rows (NULL tokens/cost) leave the stamp alone.
            # Inside the same savepoint = same commit as the log row; the helper
            # never raises so a stale key can never lose the usage row.
            if entry.status == "success":
                touch_key_last_used(db, entry.api_key_id)
        # The public gateway performs no other writes; commit here so the log
        # row survives the request-session teardown (callers never commit).
        db.commit()
    except Exception:
        logger.warning(
            "api_logs: request log write failed (request_id=%s)", entry.request_id, exc_info=True
        )
        try:
            db.rollback()
        except Exception:
            logger.warning("api_logs: rollback after failed log write failed", exc_info=True)


# --- per-key analytics -------------------------------------------------------


@dataclass(frozen=True)
class _Range:
    preset: str
    timezone: str
    start: datetime
    end: datetime


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        logger.warning("api_logs: unknown timezone %r, falling back to UTC", name)
        return ZoneInfo("UTC")


def _resolve_range(preset: str, timezone_name: str, now: datetime | None = None) -> _Range:
    """Local preset resolver (shared vocabulary; unknown presets -> this_month)."""
    zone = _zone(timezone_name)
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(zone).date()

    def midnight(day) -> datetime:
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)

    preset = preset_vocab.normalize(preset, family="gateway_keys")
    if preset == "today":
        start, end = midnight(today), now
    elif preset == "last_7d":
        start, end = midnight(today - timedelta(days=6)), now
    elif preset == "last_30d":
        start, end = midnight(today - timedelta(days=29)), now
    elif preset == "last_90d":
        start, end = midnight(today - timedelta(days=89)), now
    else:  # this_month
        start, end = midnight(today.replace(day=1)), now
    return _Range(preset=preset, timezone=timezone_name, start=start, end=end)


def _scope(key_id: uuid.UUID, rng: _Range):
    return (
        ApiRequestLog.api_key_id == key_id,
        ApiRequestLog.created_at >= rng.start,
        ApiRequestLog.created_at < rng.end,
    )


def _money(value: Any) -> str:
    return str(Decimal(value or 0))


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def key_analytics(
    db: Session,
    key_id: uuid.UUID,
    user_id: uuid.UUID,
    preset: str,
    timezone: str = "UTC",
) -> dict:
    """Grouped aggregates for one owned key. Raises NotFoundError for foreign keys."""
    owned = db.scalar(
        select(ApiKey.id).where(
            ApiKey.id == key_id,
            ApiKey.user_id == user_id,
            ApiKey.is_deleted.is_(False),
        )
    )
    if owned is None:
        raise NotFoundError("API key not found")

    rng = _resolve_range(preset, timezone)
    scope = _scope(key_id, rng)

    totals_row = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.avg(ApiRequestLog.latency_ms),
            func.percentile_cont(0.95).within_group(ApiRequestLog.latency_ms),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "failed"),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "cancelled"),
        ).where(*scope)
    ).one()
    requests = int(totals_row[0] or 0)
    failed = int(totals_row[5] or 0)
    cancelled = int(totals_row[6] or 0)
    errors = failed + cancelled

    bucket = func.date_trunc("day", func.timezone("UTC", ApiRequestLog.created_at))
    series_rows = db.execute(
        select(
            bucket,
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.avg(ApiRequestLog.latency_ms),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        )
        .where(*scope)
        .group_by(bucket)
        .order_by(bucket)
    ).all()

    model_rows = db.execute(
        select(
            ApiRequestLog.model,
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        )
        .where(*scope)
        .group_by(ApiRequestLog.model)
        .order_by(
            func.count(ApiRequestLog.id).desc(),
            func.coalesce(func.sum(ApiRequestLog.cost), 0).desc(),
        )
        .limit(_TOP_LIMIT)
    ).all()

    endpoint_rows = db.execute(
        select(
            ApiRequestLog.endpoint,
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        )
        .where(*scope)
        .group_by(ApiRequestLog.endpoint)
        .order_by(
            func.count(ApiRequestLog.id).desc(),
            func.coalesce(func.sum(ApiRequestLog.cost), 0).desc(),
        )
        .limit(_TOP_LIMIT)
    ).all()

    country_rows = db.execute(
        select(
            ApiRequestLog.country,
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        )
        .where(*scope)
        .group_by(ApiRequestLog.country)
        .order_by(
            func.count(ApiRequestLog.id).desc(),
            func.coalesce(func.sum(ApiRequestLog.cost), 0).desc(),
        )
        .limit(_TOP_LIMIT)
    ).all()

    return {
        "key_id": str(key_id),
        "range": {
            "preset": rng.preset,
            "timezone": rng.timezone,
            "start": rng.start.isoformat(),
            "end": rng.end.isoformat(),
        },
        "totals": {
            "requests": requests,
            "tokens": int(totals_row[1] or 0),
            "cost": _money(totals_row[2]),
            "avg_latency_ms": _f(totals_row[3]),
            "p95_latency_ms": _f(totals_row[4]),
            "failed": failed,
            "cancelled": cancelled,
            "error_rate": round(errors / requests, 4) if requests else 0.0,
        },
        "series": [
            {
                "date": row[0].date().isoformat(),
                "requests": int(row[1] or 0),
                "tokens": int(row[2] or 0),
                "cost": _money(row[3]),
                "avg_latency_ms": _f(row[4]),
                "errors": int(row[5] or 0),
            }
            for row in series_rows
        ],
        "top_models": [
            {
                "model": row[0] or "unknown",
                "requests": int(row[1] or 0),
                "tokens": int(row[2] or 0),
                "cost": _money(row[3]),
            }
            for row in model_rows
        ],
        "top_endpoints": [
            {
                "endpoint": row[0],
                "requests": int(row[1] or 0),
                "errors": int(row[2] or 0),
                "cost": _money(row[3]),
            }
            for row in endpoint_rows
        ],
        "top_countries": [
            {
                "country": row[0] or "unknown",
                "requests": int(row[1] or 0),
                "tokens": int(row[2] or 0),
                "cost": _money(row[3]),
            }
            for row in country_rows
        ],
    }
