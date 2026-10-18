"""API key engine: generate, hash, authenticate (O(1)), compile policies.

Raw keys are shown once and never stored — only SHA-256 hashes. Authentication
is a single indexed lookup (unique `key_hash`) with a short-lived Valkey cache
of the compiled key context, so per-request work stays O(1) and join-free.
"""

import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from tollms.models.api_key import ApiKey, ApiKeyModelPermission, IpRuleType
from tollms.models.user import User

logger = logging.getLogger(__name__)

KEY_PREFIX = "tma_sk_live_"
KEY_BYTES = 24  # 48 hex chars of entropy after the prefix
# Cache compiled contexts briefly: revocation/rotation invalidate explicitly.
CONTEXT_TTL_SECONDS = 30
# Tombstones outlive the context cache so a deleted/rotated hash can never be
# resurrected by a stale (or race-re-cached) context entry.
TOMBSTONE_TTL_SECONDS = CONTEXT_TTL_SECONDS + 60
_CONTEXT_CACHE_SECTION = "apikey"


def generate_key() -> tuple[str, str, str]:
    """Return (raw_key, public_prefix, sha256_hash). The raw key is shown once."""
    raw = f"{KEY_PREFIX}{secrets.token_hex(KEY_BYTES)}"
    return raw, raw[: len(KEY_PREFIX) + 8], hash_key(raw)


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.strip().encode("utf-8")).hexdigest()


def parse_bearer(authorization: str | None, x_api_key: str | None = None) -> str | None:
    """Extract a raw key from `Authorization: Bearer …` or `x-api-key`."""
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


@dataclass(frozen=True)
class ModelPermission:
    provider_id: uuid.UUID | None
    model_id: uuid.UUID | None
    enabled: bool
    max_budget: Decimal | None = None
    rpm: int | None = None
    tpm: int | None = None


@dataclass(frozen=True)
class KeyPolicy:
    max_budget_usd: Decimal | None = None
    budget_reset_days: int | None = None
    expires_at: datetime | None = None
    rpm: int | None = None
    rph: int | None = None
    rpd: int | None = None
    tpm: int | None = None
    tpd: int | None = None
    daily_spend_limit: Decimal | None = None
    monthly_spend_limit: Decimal | None = None


@dataclass(frozen=True)
class KeyContext:
    """Everything the gateway needs, compiled once per request (or cache hit)."""

    key_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    key_prefix: str
    enabled: bool
    expires_at: datetime | None
    policy: KeyPolicy
    # Owning org for org-scoped keys; None for personal keys. The assignee
    # (`user_id`) must hold ACTIVE membership in this org (enforced in
    # `authenticate` as a backstop even if revocation rows lag).
    org_id: uuid.UUID | None = None
    # Empty tuple = no restriction (all models allowed).
    model_permissions: tuple[ModelPermission, ...] = field(default_factory=tuple)
    allow_rules: tuple[str, ...] = field(default_factory=tuple)
    deny_rules: tuple[str, ...] = field(default_factory=tuple)
    # Owner-status verdict, snapshotted at compile time and cached with the
    # context (no extra PG hit per request). Key mutations and the
    # deletion/purge flow invalidate contexts, so a verdict can lag at most
    # CONTEXT_TTL_SECONDS after an owner-status change.
    owner_is_active: bool = True
    owner_is_deleted: bool = False
    owner_pending_deletion: bool = False

    @property
    def restricted_models(self) -> bool:
        return bool(self.model_permissions)

    def model_allowed(self, provider_id: uuid.UUID, model_id: uuid.UUID) -> bool:
        """Allow-list semantics: any enabled matching row permits the model.

        A row matches when both its provider and model ids are NULL/equal.
        Keys without permission rows are unrestricted.
        """
        if not self.model_permissions:
            return True
        for perm in self.model_permissions:
            if not perm.enabled:
                continue
            if perm.provider_id is not None and perm.provider_id != provider_id:
                continue
            if perm.model_id is not None and perm.model_id != model_id:
                continue
            return True
        return False

    def model_override(self, provider_id: uuid.UUID, model_id: uuid.UUID) -> ModelPermission | None:
        for perm in self.model_permissions:
            if not perm.enabled:
                continue
            if perm.provider_id is not None and perm.provider_id != provider_id:
                continue
            if perm.model_id is not None and perm.model_id != model_id:
                continue
            return perm
        return None

    def is_expired(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        for moment in (self.expires_at, self.policy.expires_at):
            if moment is not None and moment <= now:
                return True
        return False


def _cache_key(key_hash: str) -> str:
    from tollms.services.cache import keys as cache_keys

    return cache_keys._key(_CONTEXT_CACHE_SECTION, key_hash)  # noqa: SLF001 (registry-owned)


def invalidate_context(key_hash: str) -> None:
    from tollms.services.cache.manager import cache_delete_sync

    cache_delete_sync(_cache_key(key_hash))


def _tombstone_key(key_hash: str) -> str:
    from tollms.services.cache import keys as cache_keys

    return cache_keys.key_tombstone(key_hash)


def write_tombstone(key_hash: str) -> None:
    """Mark a deleted/rotated hash as revoked (``{"revoked_at": ts}``).

    Fail-open by design: the DB soft-delete (or hash replacement) plus the
    context invalidation already ran, so a lost tombstone only narrows — never
    removes — the race protection. Log and proceed; never raise, never log
    key material.
    """
    from tollms.services.cache.manager import cache_set_sync

    try:
        written = cache_set_sync(
            _tombstone_key(key_hash),
            {"revoked_at": datetime.now(timezone.utc).isoformat()},
            ttl=TOMBSTONE_TTL_SECONDS,
        )
    except Exception:
        logger.warning("api key tombstone write failed", exc_info=True)
    else:
        if not written:
            logger.warning("api key tombstone write failed")


def _is_tombstoned(key_hash: str) -> bool:
    """True when a revocation marker exists for this hash.

    Documented fail-closed choice: ``cache_get_sync`` returns None both when
    the tombstone is genuinely absent and when Valkey is unreachable/disabled
    — and that ambiguity is safe, because the compiled-context cache shares
    the same Valkey path. When Valkey is down, the context lookup below also
    bypasses straight to PostgreSQL, which stays authoritative (soft-deleted
    keys are filtered, rotated hashes no longer match), so a dead key can
    never authenticate. A present tombstone always wins (401) whenever Valkey
    is readable, closing the invalidate-then-recache race.
    """
    from tollms.services.cache.manager import cache_get_sync

    try:
        return cache_get_sync(_tombstone_key(key_hash)) is not None
    except Exception:
        logger.warning("api key tombstone read failed", exc_info=True)
        return False


def compile_context(key: ApiKey, owner: User | None = None) -> KeyContext:
    """Compile everything the gateway needs for one key.

    `owner` is the key's owner row. authenticate() always passes it and treats
    a missing owner as unknown; None here only serves direct callers that
    cannot load it, and keeps the permissive historical verdict for them.
    The owner-status verdict is snapshotted into the context so the cached
    entry carries it with no extra PG hit per request.
    """
    pending = owner.deletion_scheduled_for is not None if owner is not None else False
    policy = key.policy
    return KeyContext(
        key_id=key.id,
        user_id=key.user_id,
        name=key.name,
        key_prefix=key.key_prefix,
        enabled=key.enabled,
        expires_at=key.expires_at,
        org_id=key.org_id,
        policy=KeyPolicy(
            max_budget_usd=policy.max_budget_usd if policy else None,
            budget_reset_days=policy.budget_reset_days if policy else None,
            expires_at=policy.expires_at if policy else None,
            rpm=policy.rpm if policy else None,
            rph=policy.rph if policy else None,
            rpd=policy.rpd if policy else None,
            tpm=policy.tpm if policy else None,
            tpd=policy.tpd if policy else None,
            daily_spend_limit=policy.daily_spend_limit if policy else None,
            monthly_spend_limit=policy.monthly_spend_limit if policy else None,
        ),
        model_permissions=tuple(
            ModelPermission(
                provider_id=p.provider_id,
                model_id=p.model_id,
                enabled=p.enabled,
                max_budget=p.max_budget,
                rpm=p.rpm,
                tpm=p.tpm,
            )
            for p in key.model_permissions
        ),
        allow_rules=tuple(r.cidr for r in key.ip_rules if r.type == IpRuleType.ALLOW),
        deny_rules=tuple(r.cidr for r in key.ip_rules if r.type == IpRuleType.DENY),
        owner_is_active=owner.is_active if owner is not None else True,
        owner_is_deleted=owner.is_deleted if owner is not None else False,
        owner_pending_deletion=pending,
    )


def _context_to_cache(ctx: KeyContext) -> dict:
    return {
        "key_id": str(ctx.key_id),
        "user_id": str(ctx.user_id),
        "name": ctx.name,
        "key_prefix": ctx.key_prefix,
        "enabled": ctx.enabled,
        "expires_at": ctx.expires_at.isoformat() if ctx.expires_at else None,
        "org_id": str(ctx.org_id) if ctx.org_id else None,
        "policy": {
            "max_budget_usd": str(ctx.policy.max_budget_usd) if ctx.policy.max_budget_usd is not None else None,
            "budget_reset_days": ctx.policy.budget_reset_days,
            "expires_at": ctx.policy.expires_at.isoformat() if ctx.policy.expires_at else None,
            "rpm": ctx.policy.rpm,
            "rph": ctx.policy.rph,
            "rpd": ctx.policy.rpd,
            "tpm": ctx.policy.tpm,
            "tpd": ctx.policy.tpd,
            "daily_spend_limit": str(ctx.policy.daily_spend_limit) if ctx.policy.daily_spend_limit is not None else None,
            "monthly_spend_limit": str(ctx.policy.monthly_spend_limit) if ctx.policy.monthly_spend_limit is not None else None,
        },
        "model_permissions": [
            {
                "provider_id": str(p.provider_id) if p.provider_id else None,
                "model_id": str(p.model_id) if p.model_id else None,
                "enabled": p.enabled,
                "max_budget": str(p.max_budget) if p.max_budget is not None else None,
                "rpm": p.rpm,
                "tpm": p.tpm,
            }
            for p in ctx.model_permissions
        ],
        "allow_rules": list(ctx.allow_rules),
        "deny_rules": list(ctx.deny_rules),
        "owner_is_active": ctx.owner_is_active,
        "owner_is_deleted": ctx.owner_is_deleted,
        "owner_pending_deletion": ctx.owner_pending_deletion,
    }


def _context_from_cache(data: dict) -> KeyContext:
    def _dt(value: str | None) -> datetime | None:
        return datetime.fromisoformat(value) if value else None

    def _dec(value: str | None) -> Decimal | None:
        return Decimal(value) if value is not None else None

    policy = data.get("policy") or {}
    org_raw = data.get("org_id")
    try:
        org_id = uuid.UUID(org_raw) if org_raw else None
    except (ValueError, TypeError, AttributeError):
        org_id = None
    return KeyContext(
        key_id=uuid.UUID(data["key_id"]),
        user_id=uuid.UUID(data["user_id"]),
        name=data.get("name", ""),
        key_prefix=data.get("key_prefix", ""),
        enabled=bool(data.get("enabled", True)),
        expires_at=_dt(data.get("expires_at")),
        org_id=org_id,
        policy=KeyPolicy(
            max_budget_usd=_dec(policy.get("max_budget_usd")),
            budget_reset_days=policy.get("budget_reset_days"),
            expires_at=_dt(policy.get("expires_at")),
            rpm=policy.get("rpm"),
            rph=policy.get("rph"),
            rpd=policy.get("rpd"),
            tpm=policy.get("tpm"),
            tpd=policy.get("tpd"),
            daily_spend_limit=_dec(policy.get("daily_spend_limit")),
            monthly_spend_limit=_dec(policy.get("monthly_spend_limit")),
        ),
        model_permissions=tuple(
            ModelPermission(
                provider_id=uuid.UUID(p["provider_id"]) if p.get("provider_id") else None,
                model_id=uuid.UUID(p["model_id"]) if p.get("model_id") else None,
                enabled=bool(p.get("enabled", True)),
                max_budget=_dec(p.get("max_budget")),
                rpm=p.get("rpm"),
                tpm=p.get("tpm"),
            )
            for p in data.get("model_permissions") or []
        ),
        allow_rules=tuple(data.get("allow_rules") or ()),
        deny_rules=tuple(data.get("deny_rules") or ()),
        # .get defaults keep entries cached by older releases decodable.
        owner_is_active=bool(data.get("owner_is_active", True)),
        owner_is_deleted=bool(data.get("owner_is_deleted", False)),
        owner_pending_deletion=bool(data.get("owner_pending_deletion", False)),
    )


def _assignee_active(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """True when `user_id` holds ACTIVE, live membership in `org_id`.

    Local Membership query (never an `api.*` import: engines stay below the
    feature layer). Cached contexts can lag key revocation, but membership
    state is read live on every authentication.
    """
    from tollms.models.organization import Membership, MembershipState

    return (
        db.scalar(
            select(Membership.id).where(
                Membership.org_id == org_id,
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        )
        is not None
    )


def authenticate(db: Session, raw_key: str) -> KeyContext | None:
    """Resolve a raw key to its context. O(1): hash lookup + short Valkey cache.

    Returns None for unknown keys — including revoked (tombstoned) hashes and
    keys whose owner row is gone (purged owners have no key rows, so this is
    the 401 path as before). Disabled/expired keys, and keys whose owner is
    inactive, deleted, or pending deletion, return their context so callers
    can distinguish 401 (unknown) from 403 (revoked/expired/owner-blocked).

    Org keys additionally require the assignee to hold ACTIVE membership in
    the key's org at call time (404-style denial: None, never a distinct
    error). This backstop holds even if key-revocation rows lag behind a
    membership change, because membership state — not key rows — is checked.
    """
    if not raw_key:
        return None
    key_hash = hash_key(raw_key)

    from tollms.services.cache.manager import cache_get_sync, cache_set_sync

    # Tombstone first: a deleted/rotated hash stays dead even when a stale
    # compiled context is still cached (or gets re-cached in the race window).
    if _is_tombstoned(key_hash):
        return None

    cached = cache_get_sync(_cache_key(key_hash))
    if isinstance(cached, dict):
        try:
            ctx = _context_from_cache(cached)
        except Exception:
            logger.warning("api key context cache decode failed", exc_info=True)
        else:
            if ctx.org_id is not None and not _assignee_active(db, ctx.org_id, ctx.user_id):
                # Membership lapsed after this context was cached: deny as
                # unknown (never serve a stale org grant).
                return None
            return ctx

    key = db.scalar(
        select(ApiKey)
        .where(ApiKey.key_hash == key_hash, ApiKey.is_deleted.is_(False))
        .options(
            selectinload(ApiKey.policy),
            selectinload(ApiKey.ip_rules),
            selectinload(ApiKey.model_permissions),
        )
    )
    if key is None:
        return None
    owner = db.get(User, key.user_id)
    if owner is None:
        # Defensive: FK CASCADE deletes keys with a purged owner, so a missing
        # owner means the row vanished out of band — 401 unknown either way.
        return None
    if key.org_id is not None and not _assignee_active(db, key.org_id, key.user_id):
        # Org key whose assignee lost ACTIVE membership (removed/suspended):
        # deny as unknown so no existence oracle leaks the key's org scope.
        return None
    ctx = compile_context(key, owner)
    try:
        cache_set_sync(_cache_key(key_hash), _context_to_cache(ctx), ttl=CONTEXT_TTL_SECONDS)
    except Exception:
        logger.warning("api key context cache write failed", exc_info=True)
    return ctx


def is_tombstoned(key_hash: str) -> bool:
    """Public read of the revocation marker (known-id checks; raw auth uses `authenticate`)."""
    return _is_tombstoned(key_hash)
