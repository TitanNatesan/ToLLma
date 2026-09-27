"""API-key feature service: owner-scoped CRUD, policy/rules and analytics.

All key SQL and validation live here; generation, hashing and context caching
stay in the reusable engine (`services.api_keys.keys`). Raw keys are returned
to the caller exactly once and never persisted. Every mutation drops the
engine's compiled-context cache entry so the gateway cannot serve stale
permissions.

Freshness: per-key analytics are Valkey-cached for 60s (same scheme as the
platform/key analytics API — endpoint + user + key + minute-floored range
end), so recently logged gateway traffic can lag the dashboard by up to a
minute. CRUD responses are never cached.
"""

import ipaddress
import hashlib
import json
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from tollms.api.keys.schemas import (
    AnalyticsCountryRow,
    AnalyticsEndpointRow,
    AnalyticsModelRow,
    AnalyticsPoint,
    ApiKeyCreate,
    ApiKeyUpdate,
    IpRuleIn,
    KeyAnalytics,
    ModelPermissionIn,
    PolicyIn,
)
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.api_key import (
    ApiKey,
    ApiKeyIpRule,
    ApiKeyModelPermission,
    ApiKeyPolicy,
    ApiRequestLog,
    IpRuleType,
)
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.api_keys import keys as key_engine
from tollms.services.analytics import presets as preset_vocab
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)

MASK_HEAD = 16  # "tma_sk_live_ab12" — prefix characters shown before the ellipsis
DEFAULT_PRESET = "last_7d"
PRESETS = ("today", "last_7d", "last_30d", "last_90d", "this_month")
TOP_LIMIT = 5


def masked_prefix(key_prefix: str) -> str:
    """Public list identifier: `tma_sk_live_ab12…` (never enough to reconstruct)."""
    return f"{key_prefix[:MASK_HEAD]}…"


# --- owner-scoped reads ------------------------------------------------------


def _key_select():
    return (
        select(ApiKey)
        .where(ApiKey.is_deleted.is_(False))
        .options(
            selectinload(ApiKey.policy),
            selectinload(ApiKey.ip_rules),
            selectinload(ApiKey.model_permissions),
        )
    )


def get_key(db: Session, key_id: uuid.UUID, user_id: uuid.UUID) -> ApiKey:
    """One live key owned by `user_id`; other owners get 404 (no oracle)."""
    key = db.scalar(_key_select().where(ApiKey.id == key_id, ApiKey.user_id == user_id))
    if key is None:
        raise NotFoundError(f"api key {key_id} not found")
    return key


def list_keys(db: Session, user_id: uuid.UUID) -> list[ApiKey]:
    return list(
        db.scalars(
            _key_select().where(ApiKey.user_id == user_id).order_by(ApiKey.created_at.desc())
        )
    )


# --- validation --------------------------------------------------------------


def normalize_cidr(value: str) -> str:
    """Canonical network string; single IPs become /32 or /128 (strict=False)."""
    try:
        return str(ipaddress.ip_network(value.strip(), strict=False))
    except ValueError as exc:
        raise ValidationError(f"invalid IP or CIDR: {value!r}") from exc


def _validated_ip_rules(items: list[IpRuleIn]) -> list[dict]:
    rules: list[dict] = []
    seen: set[tuple] = set()
    allow_cidrs: set[str] = set()
    deny_cidrs: set[str] = set()
    for item in items:
        cidr = normalize_cidr(item.cidr)
        scope = (item.type, cidr)
        if scope in seen:
            raise ValidationError(f"duplicate IP rule: {item.type.value} {cidr}")
        seen.add(scope)
        if item.type == IpRuleType.ALLOW:
            allow_cidrs.add(cidr)
        else:
            deny_cidrs.add(cidr)
        rules.append({"type": item.type, "cidr": cidr})
    overlap = allow_cidrs & deny_cidrs
    if overlap:
        raise ValidationError(
            f"CIDR {sorted(overlap)[0]} cannot appear in both allow and deny rules: "
            "deny rules always win, so the allow entry would never take effect"
        )
    return rules


def _reject_bad_number(value: object, *, field: str) -> None:
    """422 on NaN or negative budgets/limits. Pydantic already enforces this
    over HTTP; this guards direct service callers (fail-closed, same code)."""
    if value is None:
        return
    if isinstance(value, float) and math.isnan(value):
        raise ValidationError(f"{field} must be a valid number")
    if isinstance(value, Decimal) and value.is_nan():
        raise ValidationError(f"{field} must be a valid number")
    if value < 0:  # type: ignore[operator]
        raise ValidationError(f"{field} must be >= 0")


_POLICY_NUMERIC_FIELDS = (
    "max_budget_usd",
    "budget_reset_days",
    "rpm",
    "rph",
    "rpd",
    "tpm",
    "tpd",
    "daily_spend_limit",
    "monthly_spend_limit",
)


def _ensure_future_expires(value: datetime | None, *, field: str) -> None:
    """422 when an expiry is already in the past. Rejected on create AND on
    update (deliberate choice over warn-or-allow: a past expiry is almost
    always a caller bug, and explicit null remains the way to clear it)."""
    if value is None:
        return
    moment = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if moment <= datetime.now(timezone.utc):
        raise ValidationError(f"{field} must be in the future")


def _validated_policy(data: PolicyIn) -> dict:
    """Numeric + expiry guards for a full policy payload (create and upsert)."""
    values = data.model_dump()
    for field in _POLICY_NUMERIC_FIELDS:
        _reject_bad_number(values.get(field), field=f"policy.{field}")
    _ensure_future_expires(values.get("expires_at"), field="policy.expires_at")
    return values


def _validated_model_permissions(
    db: Session, items: list[ModelPermissionIn], user_id: uuid.UUID
) -> list[dict]:
    """Validate scopes exist, belong to the caller, and are unique per key."""
    seen: set[tuple] = set()
    for item in items:
        _reject_bad_number(item.max_budget, field="model_permissions.max_budget")
        _reject_bad_number(item.rpm, field="model_permissions.rpm")
        _reject_bad_number(item.tpm, field="model_permissions.tpm")
        scope = (item.provider_id, item.model_id)
        if scope in seen:
            raise ValidationError("duplicate model permission scope")
        seen.add(scope)
    if not items:
        return []

    provider_ids = {item.provider_id for item in items if item.provider_id}
    providers: dict[uuid.UUID, Provider] = {}
    if provider_ids:
        providers = {p.id: p for p in db.scalars(select(Provider).where(Provider.id.in_(provider_ids)))}
        missing = provider_ids - providers.keys()
        if missing:
            raise ValidationError(f"unknown provider: {min(str(value) for value in missing)}")
        for provider in providers.values():
            if provider.is_deleted or (provider.user_id is not None and provider.user_id != user_id):
                raise ValidationError(f"provider {provider.id} not found")

    model_ids = {item.model_id for item in items if item.model_id}
    models: dict[uuid.UUID, AIModel] = {}
    if model_ids:
        models = {m.id: m for m in db.scalars(select(AIModel).where(AIModel.id.in_(model_ids)))}
        missing = model_ids - models.keys()
        if missing:
            raise ValidationError(f"unknown model: {min(str(value) for value in missing)}")
        owner_ids = {m.provider_id for m in models.values()} - providers.keys()
        owners = (
            {p.id: p for p in db.scalars(select(Provider).where(Provider.id.in_(owner_ids)))}
            if owner_ids
            else {}
        )
        for model in models.values():
            owner = owners.get(model.provider_id) or providers.get(model.provider_id)
            if (
                model.is_deleted
                or owner is None
                or owner.is_deleted
                or (owner.user_id is not None and owner.user_id != user_id)
            ):
                raise ValidationError(f"model {model.id} not found")

    for item in items:
        if item.provider_id and item.model_id and models[item.model_id].provider_id != item.provider_id:
            raise ValidationError(f"model {item.model_id} does not belong to provider {item.provider_id}")
    return [item.model_dump() for item in items]


# --- mutations ---------------------------------------------------------------


def create_key(db: Session, data: ApiKeyCreate, user_id: uuid.UUID) -> tuple[ApiKey, str]:
    """Create a key; returns (row, raw_key) with the raw value shown exactly once."""
    ip_rules = _validated_ip_rules(data.ip_rules)
    permissions = _validated_model_permissions(db, data.model_permissions, user_id)
    _ensure_future_expires(data.expires_at, field="expires_at")
    raw_key, key_prefix, key_hash = key_engine.generate_key()
    api_key = ApiKey(
        user_id=user_id,
        name=data.name,
        description=data.description,
        key_prefix=key_prefix,
        key_hash=key_hash,
        expires_at=data.expires_at,
    )
    if data.policy is not None:
        api_key.policy = ApiKeyPolicy(**_validated_policy(data.policy))
    api_key.ip_rules = [ApiKeyIpRule(**rule) for rule in ip_rules]
    api_key.model_permissions = [ApiKeyModelPermission(**perm) for perm in permissions]
    db.add(api_key)
    db.commit()
    logger.info("api key created: %s (%s)", api_key.id, key_prefix)
    return get_key(db, api_key.id, user_id), raw_key


def update_key(db: Session, key_id: uuid.UUID, data: ApiKeyUpdate, user_id: uuid.UUID) -> ApiKey:
    """PATCH semantics: omitted fields untouched, explicit null clears nullable ones."""
    key = get_key(db, key_id, user_id)
    key_hash = key.key_hash
    fields = data.model_dump(exclude_unset=True)
    if fields.get("name") is not None:
        key.name = fields["name"]
    if "description" in fields:
        key.description = fields["description"]
    if fields.get("enabled") is not None:
        key.enabled = fields["enabled"]
    if "expires_at" in fields:
        _ensure_future_expires(fields["expires_at"], field="expires_at")
        key.expires_at = fields["expires_at"]
    db.commit()
    key_engine.invalidate_context(key_hash)
    logger.info("api key updated: %s", key_id)
    return get_key(db, key_id, user_id)


def delete_key(db: Session, key_id: uuid.UUID, user_id: uuid.UUID) -> None:
    key = get_key(db, key_id, user_id)
    key_hash = key.key_hash
    key.is_deleted = True
    key.deleted_at = datetime.now(timezone.utc)
    key.deleted_by = user_id
    db.commit()
    key_engine.invalidate_context(key_hash)
    # Tombstone second: the hash stays dead even if a context was re-cached
    # in the race window (the deletion-request flow relies on this per key).
    key_engine.write_tombstone(key_hash)
    logger.info("api key deleted: %s", key_id)


def rotate_key(db: Session, key_id: uuid.UUID, user_id: uuid.UUID) -> tuple[ApiKey, str]:
    """Replace the stored hash/prefix; the previous raw key stops authenticating."""
    key = get_key(db, key_id, user_id)
    old_hash = key.key_hash
    raw_key, key_prefix, key_hash = key_engine.generate_key()
    key.key_hash = key_hash
    key.key_prefix = key_prefix
    key.rotation_count += 1
    db.commit()
    key_engine.invalidate_context(old_hash)
    # The previous hash must never authenticate again, even via a stale cache.
    key_engine.write_tombstone(old_hash)
    rotated = get_key(db, key_id, user_id)
    logger.info("api key rotated: %s (rotation %d)", key_id, rotated.rotation_count)
    return rotated, raw_key


def put_policy(db: Session, key_id: uuid.UUID, data: PolicyIn, user_id: uuid.UUID) -> ApiKey:
    """Full-replace upsert: absent fields become NULL (unlimited)."""
    key = get_key(db, key_id, user_id)
    key_hash = key.key_hash
    values = _validated_policy(data)
    if key.policy is None:
        key.policy = ApiKeyPolicy(**values)
    else:
        for field, value in values.items():
            setattr(key.policy, field, value)
    db.commit()
    key_engine.invalidate_context(key_hash)
    logger.info("api key policy updated: %s", key_id)
    return get_key(db, key_id, user_id)


def put_ip_rules(db: Session, key_id: uuid.UUID, items: list[IpRuleIn], user_id: uuid.UUID) -> ApiKey:
    """Replace every IP rule for the key (empty list = no restriction)."""
    key = get_key(db, key_id, user_id)
    key_hash = key.key_hash
    rules = _validated_ip_rules(items)
    key.ip_rules.clear()
    db.flush()
    key.ip_rules.extend(ApiKeyIpRule(**rule) for rule in rules)
    db.commit()
    key_engine.invalidate_context(key_hash)
    logger.info("api key ip rules replaced: %s (%d rules)", key_id, len(rules))
    return get_key(db, key_id, user_id)


def put_model_permissions(
    db: Session, key_id: uuid.UUID, items: list[ModelPermissionIn], user_id: uuid.UUID
) -> ApiKey:
    """Replace every model permission for the key (empty list = unrestricted)."""
    key = get_key(db, key_id, user_id)
    key_hash = key.key_hash
    permissions = _validated_model_permissions(db, items, user_id)
    key.model_permissions.clear()
    db.flush()
    key.model_permissions.extend(ApiKeyModelPermission(**perm) for perm in permissions)
    db.commit()
    key_engine.invalidate_context(key_hash)
    logger.info("api key model permissions replaced: %s (%d rows)", key_id, len(permissions))
    return get_key(db, key_id, user_id)


# --- analytics ---------------------------------------------------------------


def _preset_window(preset: str, now: datetime | None = None) -> tuple[datetime, datetime, str]:
    """(start, end, bucket granularity) for a supported preset; UTC walls.

    Legacy aliases from the other analytics surfaces are accepted via the
    shared preset vocabulary; unknown presets (and ``custom``, which takes
    no date bounds here) still raise (HTTP 422).
    """
    now = now or datetime.now(timezone.utc)
    preset = preset_vocab.normalize(preset, family="keys")
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if preset == "today":
        return midnight, now, "hour"
    if preset == "last_7d":
        return midnight - timedelta(days=6), now, "day"
    if preset == "last_30d":
        return midnight - timedelta(days=29), now, "day"
    if preset == "last_90d":
        return midnight - timedelta(days=89), now, "day"
    if preset == "this_month":
        return midnight.replace(day=1), now, "day"
    raise ValidationError(f"unknown analytics preset: {preset!r}; expected one of {', '.join(PRESETS)}")


def _log_scope(key: ApiKey, user_id: uuid.UUID, start: datetime, end: datetime) -> tuple:
    return (
        ApiRequestLog.api_key_id == key.id,
        ApiRequestLog.user_id == user_id,
        ApiRequestLog.created_at >= start,
        ApiRequestLog.created_at < end,
    )


def _series(db: Session, scope: tuple, granularity: str) -> list[AnalyticsPoint]:
    bucket = func.date_trunc(granularity, ApiRequestLog.created_at)
    rows = db.execute(
        select(
            bucket,
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        )
        .where(*scope)
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        AnalyticsPoint(
            bucket=row[0],
            requests=int(row[1]),
            tokens=int(row[2]),
            cost=Decimal(str(row[3])),
            errors=int(row[4]),
        )
        for row in rows
    ]


def _top_models(db: Session, scope: tuple) -> list[AnalyticsModelRow]:
    model = func.coalesce(ApiRequestLog.model, "unknown")
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    requests = func.count(ApiRequestLog.id)
    rows = db.execute(
        select(model, requests, func.coalesce(func.sum(ApiRequestLog.total_tokens), 0), spend)
        .where(*scope)
        .group_by(model)
        .order_by(spend.desc(), requests.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [
        AnalyticsModelRow(model=str(row[0]), requests=int(row[1]), tokens=int(row[2]), cost=Decimal(str(row[3])))
        for row in rows
    ]


def _top_endpoints(db: Session, scope: tuple) -> list[AnalyticsEndpointRow]:
    requests = func.count(ApiRequestLog.id)
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    rows = db.execute(
        select(ApiRequestLog.endpoint, requests, spend)
        .where(*scope)
        .group_by(ApiRequestLog.endpoint)
        .order_by(requests.desc(), spend.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [
        AnalyticsEndpointRow(endpoint=str(row[0]), requests=int(row[1]), cost=Decimal(str(row[2])))
        for row in rows
    ]


def _top_countries(db: Session, scope: tuple) -> list[AnalyticsCountryRow]:
    requests = func.count(ApiRequestLog.id)
    rows = db.execute(
        select(ApiRequestLog.country, requests)
        .where(*scope, ApiRequestLog.country.is_not(None))
        .group_by(ApiRequestLog.country)
        .order_by(requests.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [AnalyticsCountryRow(country=str(row[0]), requests=int(row[1])) for row in rows]


def _analytics_digest(preset: str, end: datetime, key_id: uuid.UUID) -> str:
    """Stable cache identity: endpoint + canonical preset + minute-floored
    range end (preset windows end at ``now``) + key."""
    parts = [
        "key-analytics",
        preset,
        end.replace(second=0, microsecond=0).isoformat(),
        json.dumps({"key_id": str(key_id)}, sort_keys=True),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def get_analytics(
    db: Session, key_id: uuid.UUID, user_id: uuid.UUID, preset: str = DEFAULT_PRESET
) -> KeyAnalytics:
    """Grouped per-key roll-up; every query is scoped to the key's owner.

    Valkey-cached for 60s (best-effort: failures fall through to PostgreSQL).
    """
    key = get_key(db, key_id, user_id)
    start, end, granularity = _preset_window(preset)
    canonical = preset_vocab.normalize(preset, family="keys")
    cache_key = cache_keys.analytics(user_id, _analytics_digest(canonical, end, key_id))
    hit = cache_get_sync(cache_key)
    if isinstance(hit, dict):
        try:
            return KeyAnalytics(**hit)
        except Exception:  # noqa: BLE001 - corrupt entry rebuilds below
            logger.warning("keys analytics: corrupt cache entry for key %s", key_id)
    result = _build_analytics(db, key, user_id, start, end, granularity, canonical)
    cache_set_sync(cache_key, result.model_dump(mode="json"), ttl=cache_ttl.ANALYTICS)
    return result


def _build_analytics(
    db: Session,
    key,  # ApiKey row (ownership already checked)
    user_id: uuid.UUID,
    start: datetime,
    end: datetime,
    granularity: str,
    preset: str,
) -> KeyAnalytics:
    """Grouped per-key roll-up; every query is scoped to the key's owner."""
    scope = _log_scope(key, user_id, start, end)

    requests, tokens, cost, avg_latency, p95_latency, errors = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.avg(ApiRequestLog.latency_ms),
            func.percentile_cont(0.95).within_group(ApiRequestLog.latency_ms),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        ).where(*scope)
    ).one()

    request_count = int(requests or 0)
    return KeyAnalytics(
        range=preset,
        range_start=start,
        range_end=end,
        requests=request_count,
        tokens=int(tokens or 0),
        cost=Decimal(str(cost)),
        avg_latency_ms=float(avg_latency) if avg_latency is not None else None,
        p95_latency_ms=float(p95_latency) if p95_latency is not None else None,
        error_rate=round(int(errors or 0) / request_count, 4) if request_count else 0.0,
        series=_series(db, scope, granularity),
        top_models=_top_models(db, scope),
        top_endpoints=_top_endpoints(db, scope),
        top_countries=_top_countries(db, scope),
    )
