"""API-key feature service: owner-scoped CRUD, policy/rules and validation.

All key SQL and validation live here; generation, hashing and context caching
stay in the reusable engine (`services.api_keys.keys`). Raw keys are returned
to the caller exactly once and never persisted. Every mutation drops the
engine's compiled-context cache entry so the gateway cannot serve stale
permissions. (Per-key analytics live in `api/keys/analytics.py`.)
"""

import ipaddress
import logging
import math
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from tollms.api.keys.schemas import (
    ApiKeyCreate,
    ApiKeyUpdate,
    IpRuleIn,
    ModelPermissionIn,
    PolicyIn,
)
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.api_key import (
    ApiKey,
    ApiKeyIpRule,
    ApiKeyModelPermission,
    ApiKeyPolicy,
    IpRuleType,
)
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.api_keys import keys as key_engine
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)

MASK_HEAD = 16  # "tma_sk_live_ab12" — prefix characters shown before the ellipsis


def masked_prefix(key_prefix: str) -> str:
    """Public list identifier: `tma_sk_live_ab12…` (never enough to reconstruct)."""
    return f"{key_prefix[:MASK_HEAD]}…"


# --- owner-scoped reads ------------------------------------------------------


def _key_select():
    # Personal keys only (org_id IS NULL). Org keys are managed exclusively
    # through the organizations API (`api/orgs/keys/service.py`).
    return (
        select(ApiKey)
        .where(ApiKey.is_deleted.is_(False), ApiKey.org_id.is_(None))
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
    db: Session,
    items: list[ModelPermissionIn],
    user_id: uuid.UUID,
    *,
    visible_org_ids: set[uuid.UUID] | frozenset | None = None,
    require_org_id: uuid.UUID | None = None,
) -> list[dict]:
    """Validate scopes exist, are visible to the caller, and are unique per key.

    Personal scope (``visible_org_ids=None``): only personal providers/models
    owned by the caller are visible — org providers (``org_id`` set, even when
    their ``user_id`` equals the caller) are never reachable from personal
    keys. Org scope: providers/models of every org in ``visible_org_ids``
    (the granter's ACTIVE orgs) are additionally visible.

    ``require_org_id`` (org-key issuance only): every listed provider/model
    must additionally belong to the key's own org. A granter in two orgs can
    otherwise stamp another org's model onto this org's key — harmless at the
    gateway (resolution still scopes to the assignee's orgs) but wrong as
    configuration, so issuance rejects it.
    """
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

    visible_orgs = set(visible_org_ids or ())

    def _provider_visible(provider: Provider) -> bool:
        if provider.is_deleted:
            return False
        if provider.org_id is not None:
            return provider.org_id in visible_orgs
        return provider.user_id == user_id

    provider_ids = {item.provider_id for item in items if item.provider_id}
    providers: dict[uuid.UUID, Provider] = {}
    if provider_ids:
        providers = {p.id: p for p in db.scalars(select(Provider).where(Provider.id.in_(provider_ids)))}
        missing = provider_ids - providers.keys()
        if missing:
            raise ValidationError(f"unknown provider: {min(str(value) for value in missing)}")
        for provider in providers.values():
            if not _provider_visible(provider):
                raise ValidationError(f"provider {provider.id} not found")
            if require_org_id is not None and provider.org_id != require_org_id:
                raise ValidationError(f"provider {provider.id} is outside this organization")

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
            if model.is_deleted or owner is None or not _provider_visible(owner):
                raise ValidationError(f"model {model.id} not found")
            if require_org_id is not None and owner.org_id != require_org_id:
                raise ValidationError(f"model {model.id} is outside this organization")

    for item in items:
        if item.provider_id and item.model_id and models[item.model_id].provider_id != item.provider_id:
            raise ValidationError(f"model {item.model_id} does not belong to provider {item.provider_id}")
    return [item.model_dump() for item in items]


# --- mutations ---------------------------------------------------------------

# Validated primitives for one key row. Shared by personal creation below and
# org-key issuance (`api/orgs/service.py`) so raw-key handling, hashing and
# persistence exist exactly once.
class _KeyParts:
    def __init__(self, *, name: str, description: str | None, expires_at,
                 policy_values: dict | None, ip_rules: list[dict], permissions: list[dict]) -> None:
        self.name = name
        self.description = description
        self.expires_at = expires_at
        self.policy_values = policy_values
        self.ip_rules = ip_rules
        self.permissions = permissions


def prepare_key_parts(
    db: Session, data: ApiKeyCreate, user_id: uuid.UUID, *,
    visible_org_ids: set[uuid.UUID] | frozenset | None = None,
    key_org_id: uuid.UUID | None = None,
) -> _KeyParts:
    """Validate a creation payload (personal or org scope) into persistable parts."""
    ip_rules = _validated_ip_rules(data.ip_rules)
    permissions = _validated_model_permissions(db, data.model_permissions, user_id,
                                               visible_org_ids=visible_org_ids,
                                               require_org_id=key_org_id)
    _ensure_future_expires(data.expires_at, field="expires_at")
    policy_values = _validated_policy(data.policy) if data.policy is not None else None
    return _KeyParts(
        name=data.name, description=data.description, expires_at=data.expires_at,
        policy_values=policy_values, ip_rules=ip_rules, permissions=permissions,
    )


def persist_key(
    db: Session, parts: _KeyParts, *, user_id: uuid.UUID,
    org_id: uuid.UUID | None = None, issued_by: uuid.UUID | None = None,
) -> tuple[ApiKey, str]:
    """Insert the key row; returns (row, raw_key) with the raw value shown once.

    Personal keys pass ``org_id=None``; org keys pass the org, the assignee as
    ``user_id`` and the granting caller as ``issued_by``.
    """
    raw_key, key_prefix, key_hash = key_engine.generate_key()
    api_key = ApiKey(
        user_id=user_id,
        org_id=org_id,
        issued_by=issued_by,
        name=parts.name,
        description=parts.description,
        key_prefix=key_prefix,
        key_hash=key_hash,
        expires_at=parts.expires_at,
    )
    if parts.policy_values is not None:
        api_key.policy = ApiKeyPolicy(**parts.policy_values)
    api_key.ip_rules = [ApiKeyIpRule(**rule) for rule in parts.ip_rules]
    api_key.model_permissions = [ApiKeyModelPermission(**perm) for perm in parts.permissions]
    db.add(api_key)
    db.commit()
    logger.info("api key created: %s (%s) org=%s", api_key.id, key_prefix, org_id)
    return api_key, raw_key


def create_key(db: Session, data: ApiKeyCreate, user_id: uuid.UUID) -> tuple[ApiKey, str]:
    """Create a personal key; returns (row, raw_key) shown exactly once."""
    parts = prepare_key_parts(db, data, user_id)
    api_key, raw_key = persist_key(db, parts, user_id=user_id)
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
    emit("key.deleted", key_id=str(key_id), user_id=str(user_id))


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
    emit("key.rotated", key_id=str(key_id), user_id=str(user_id))
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



# --- primary key lifecycle ---------------------------------------------------
# One live primary per personal user (partial UQ
# `uq_api_keys_primary_per_user`). The primary carries empty restrictions
# (unlimited, no policy/IP rules); the model registry appends an allow-list
# row per personal model (see `sync_primary_model`). Explicit user policy/IP
# edits are never touched here, and a disabled/revoked primary is never
# auto-enabled — the sync skips it until the user re-enables the key.

PRIMARY_KEY_NAME = "Primary key"


def find_primary_key(db: Session, user_id: uuid.UUID) -> ApiKey | None:
    """Live personal primary owned by `user_id`, if any."""
    return db.scalar(
        select(ApiKey).where(
            ApiKey.user_id == user_id,
            ApiKey.org_id.is_(None),
            ApiKey.is_primary.is_(True),
            ApiKey.is_deleted.is_(False),
        )
    )


def ensure_primary_key(db: Session, user_id: uuid.UUID, *, commit: bool = True) -> ApiKey:
    """Fetch the live personal primary, creating it (unrestricted) if missing.

    Idempotent under concurrency: creation runs in a savepoint so a lost
    partial-UQ race rolls back only the insert, then re-fetches the winner.
    """
    from sqlalchemy.exc import IntegrityError

    key = find_primary_key(db, user_id)
    if key is not None:
        return key
    _raw, key_prefix, key_hash = key_engine.generate_key()
    candidate = ApiKey(
        user_id=user_id,
        org_id=None,
        name=PRIMARY_KEY_NAME,
        key_prefix=key_prefix,
        key_hash=key_hash,
        is_primary=True,
    )
    try:
        with db.begin_nested():
            db.add(candidate)
            db.flush()
    except IntegrityError:
        pass  # another transaction won the race; refetch below
    key = find_primary_key(db, user_id)
    if key is None:  # pragma: no cover - defensive; UQ guarantees a winner
        raise ValidationError("could not establish a primary API key")
    if commit:
        db.commit()
        db.refresh(key)
    logger.info("api primary key ensured: %s", key.id)
    return key


def sync_primary_model(
    db: Session,
    *,
    user_id: uuid.UUID,
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    commit: bool = True,
) -> ApiKey | None:
    """Append one allow-list row (provider, model, enabled) to the primary.

    Skips silently when the primary is disabled or soft-deleted (never
    auto-enable, never resurrect); skips duplicates via check-exists-first
    plus a savepoint for races. Policy/IP restrictions are never modified.
    """
    from sqlalchemy.exc import IntegrityError

    key = ensure_primary_key(db, user_id, commit=False)
    if not key.enabled or key.is_deleted:
        return key
    exists = db.scalar(
        select(ApiKeyModelPermission.id).where(
            ApiKeyModelPermission.api_key_id == key.id,
            ApiKeyModelPermission.provider_id == provider_id,
            ApiKeyModelPermission.model_id == model_id,
        )
    )
    if exists is not None:
        return key
    try:
        with db.begin_nested():
            db.add(
                ApiKeyModelPermission(
                    api_key_id=key.id,
                    provider_id=provider_id,
                    model_id=model_id,
                    enabled=True,
                )
            )
            db.flush()
    except IntegrityError:
        pass  # concurrent sync won; the row exists now
    key_engine.invalidate_context(key.key_hash)
    if commit:
        db.commit()
    logger.info("api primary key synced model: key=%s model=%s", key.id, model_id)
    return key
