"""Provider registry: CRUD + credential encryption/masking + validation + discovery."""

import inspect
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.crypto import decrypt, encrypt, mask
from tollms.core.exceptions import ApplicationException, ErrorCode, NotFoundError, ValidationError
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked
from tollms.services.cache.manager import cache_invalidate_sync, get_manager
from tollms.services.gateway.factory import build_adapter
from tollms.services.observability.events import emit
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider, ProviderType
from tollms.api.providers.schemas import DiscoveredModelInfo, DiscoveryResult, ProviderCreate, ProviderUpdate

logger = logging.getLogger(__name__)

VALIDATION_MESSAGE_MAX_LENGTH = 500

_SK_RE = re.compile(r"sk-[A-Za-z0-9_-]{8,}")
_BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/=]+", re.IGNORECASE)
_API_KEY_VALUE_RE = re.compile(r"(api[_-]?key\s*[:=]\s*['\"]?)[^\s'\";,]+", re.IGNORECASE)
_URL_USERINFO_RE = re.compile(r"(https?://)[^/\s:@]+:[^/\s@]+@")


def sanitize_validation_message(message: str | None) -> str | None:
    """Scrub secret material from a validation message before persisting.

    Probe errors can echo credentials (rejected keys, bearer tokens, URLs
    carrying userinfo), and the message is surfaced on the admin providers
    endpoint — so redact key-like tokens and URL userinfo, then truncate.
    Only the text is rewritten; the valid/invalid status is untouched.
    """
    if not message:
        return message
    scrubbed = _SK_RE.sub("[redacted]", message)
    scrubbed = _BEARER_RE.sub("Bearer [redacted]", scrubbed)
    scrubbed = _API_KEY_VALUE_RE.sub(r"\1[redacted]", scrubbed)
    scrubbed = _URL_USERINFO_RE.sub(r"\1[redacted]@", scrubbed)
    return scrubbed[:VALIDATION_MESSAGE_MAX_LENGTH]


def masked_credentials(provider: Provider) -> dict[str, str]:
    try:
        creds = json.loads(decrypt(provider.credentials_encrypted))
    except ValueError:
        logger.exception("stored credentials undecryptable for provider %s", provider.id)
        return {}
    return {k: (mask(str(v)) if k != "base_url" and "url" not in k else str(v)) for k, v in creds.items()}


def decrypted_credentials(provider: Provider) -> dict:
    return json.loads(decrypt(provider.credentials_encrypted))


def _invalidate_provider_cache(provider_id: uuid.UUID) -> None:
    """Drop cached validation/discovery/model state. Secrets are never cached."""
    cache_invalidate_sync(
        cache_keys.provider(provider_id),
        cache_keys.provider_models(provider_id),
        cache_keys.provider_validation(provider_id),
    )


def get_provider(db: Session, provider_id: uuid.UUID, user_id: uuid.UUID | None = None) -> Provider:
    provider = db.get(Provider, provider_id)
    if provider is None or provider.is_deleted:
        raise NotFoundError(f"provider {provider_id} not found")
    if user_id is None:
        return provider  # unscoped (internal/tests): no ownership check
    if provider.org_id is not None:
        # Org-scoped: visible only inside one of the caller's ACTIVE orgs.
        # (Scope is decided by org_id alone; user_id on org rows is audit.)
        if provider.org_id not in _active_org_ids(db, user_id):
            raise NotFoundError(f"provider {provider_id} not found")
        return provider
    if provider.user_id != user_id:
        raise NotFoundError(f"provider {provider_id} not found")
    return provider


def _active_org_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Org ids where `user_id` holds ACTIVE, live membership.

    Local Membership query (models only — never an `api.*` import, so the
    providers engine stays below the feature-service cycle).
    """
    from tollms.models.organization import Membership, MembershipState

    return set(
        db.scalars(
            select(Membership.org_id).where(
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        )
    )


def list_providers(
    db: Session, *, active_only: bool = False, user_id: uuid.UUID | None = None
) -> list[Provider]:
    """Personal providers owned by `user_id` plus org providers of the
    caller's ACTIVE orgs (config visible; credentials stay masked at the
    router — raw secrets are never serialized)."""
    stmt = select(Provider).where(Provider.is_deleted.is_(False)).order_by(Provider.created_at)
    if user_id is not None:
        from sqlalchemy import and_, or_

        org_ids = _active_org_ids(db, user_id)
        personal = and_(Provider.org_id.is_(None), Provider.user_id == user_id)
        if org_ids:
            stmt = stmt.where(or_(personal, Provider.org_id.in_(list(org_ids))))
        else:
            stmt = stmt.where(personal)
    if active_only:
        stmt = stmt.where(Provider.is_active.is_(True))
    return list(db.scalars(stmt))


def ensure_unique_name(
    db: Session, name: str, exclude_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None,
    *, org_id: uuid.UUID | None = None,
) -> None:
    """Name uniqueness per scope among live rows: personal scope is
    (user_id, name) with org_id NULL; org scope is (org_id, name)."""
    stmt = select(Provider).where(Provider.is_deleted.is_(False), Provider.name.ilike(name.strip()))
    if org_id is not None:
        stmt = stmt.where(Provider.org_id == org_id)
    else:
        stmt = stmt.where(Provider.org_id.is_(None))
        if user_id is not None:
            stmt = stmt.where(Provider.user_id == user_id)
    if exclude_id is not None:
        stmt = stmt.where(Provider.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ValidationError(f"provider name {name.strip()!r} is already taken")


def create_provider(
    db: Session, data: ProviderCreate, user_id: uuid.UUID | None = None, *,
    org_id: uuid.UUID | None = None,
) -> Provider:
    """Create a provider. Org-scoped rows carry both `org_id` (scope) and
    `user_id` (creating caller, audit only).

    With `catalog_slug` the server stamps ``metadata_['catalog']`` with the
    catalog identity and pre-fills ``credentials.base_url`` from the catalog
    row for CUSTOM providers when the caller omits it. Caller-supplied
    credentials are never overwritten."""
    ensure_unique_name(db, data.name, user_id=user_id, org_id=org_id)
    credentials = dict(data.credentials)
    metadata = dict(data.metadata or {})
    if data.catalog_slug:
        from tollms.api.catalog import service as catalog_service

        row = catalog_service.get_catalog_row(db, data.catalog_slug)
        metadata["catalog"] = {"slug": row.slug, "gateway_family": row.gateway_family}
        if (
            data.provider_type == ProviderType.CUSTOM
            and "base_url" not in credentials
            and row.api_base_url
        ):
            credentials["base_url"] = row.api_base_url
    provider = Provider(
        user_id=user_id,
        org_id=org_id,
        name=data.name,
        provider_type=data.provider_type,
        credentials_encrypted=encrypt(json.dumps(credentials)),
        metadata_=metadata,
        is_active=data.is_active,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    logger.info("provider created: %s (%s) org=%s", provider.id, provider.provider_type, org_id)
    return provider


def _require_org_provider_perm(db: Session, provider: Provider, user_id: uuid.UUID, code: str) -> None:
    """Org providers mutate only with the org permission in the same org.

    Lazy `api.orgs` import: orgs/service.py composes this module for org
    provider creation, so a top-level import would cycle.
    """
    from tollms.api.orgs import service as org_service

    org, mem = org_service._member_org(db, provider.org_id, user_id)
    org_service._require_perm(db, org, mem, user_id, code)


def update_provider(
    db: Session, provider_id: uuid.UUID, data: ProviderUpdate, user_id: uuid.UUID | None = None
) -> Provider:
    provider = get_provider(db, provider_id, user_id)
    if provider.org_id is not None and user_id is not None:
        _require_org_provider_perm(db, provider, user_id, "Providers.Update")
        if data.credentials is not None:
            _require_org_provider_perm(db, provider, user_id, "Providers.RotateCredentials")
    if data.name is not None:
        ensure_unique_name(db, data.name, exclude_id=provider.id, user_id=user_id,
                           org_id=provider.org_id)
        provider.name = data.name
    if data.credentials is not None:
        provider.credentials_encrypted = encrypt(json.dumps(data.credentials))
    if data.metadata is not None:
        provider.metadata_ = data.metadata
    if data.is_active is not None:
        provider.is_active = data.is_active
    db.commit()
    db.refresh(provider)
    _invalidate_provider_cache(provider.id)
    logger.info("provider updated: %s", provider.id)
    return provider


def delete_provider(db: Session, provider_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
    provider = get_provider(db, provider_id, user_id)
    if provider.org_id is not None and user_id is not None:
        _require_org_provider_perm(db, provider, user_id, "Providers.Delete")
    provider.is_deleted = True
    provider.deleted_at = datetime.now(timezone.utc)
    provider.is_active = False
    db.commit()
    _invalidate_provider_cache(provider.id)
    logger.info("provider soft-deleted: %s", provider.id)
    emit("provider.deleted", provider_id=str(provider_id), user_id=str(user_id))


async def validate_provider(
    db: Session,
    provider_id: uuid.UUID,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> tuple[bool, str, float]:
    """Validate via the adapter and persist the result on the provider.

    Fresh validations are cached for cache_ttl.VALIDATION seconds; cache
    hits return the last result without re-probing or rewriting the DB.
    Calls with an explicit transport (tests) always probe live.
    Org providers additionally require Providers.Validate (404 oracle).
    """
    provider = get_provider(db, provider_id, user_id)
    if user_id is not None and provider.org_id is not None:
        _require_org_provider_perm(db, provider, user_id, "Providers.Validate")
    manager = get_manager()
    if transport is None:
        hit = await manager.get(cache_keys.provider_validation(provider.id))
        if isinstance(hit, dict) and "valid" in hit:
            logger.info("provider %s validation: cache hit", provider.id)
            return bool(hit["valid"]), str(hit.get("message", "")), float(hit.get("latency_ms", 0))
    adapter = build_adapter(provider, None, decrypted_credentials(provider), transport)
    try:
        valid, message, latency = await adapter.validate_credentials()
    except Exception as e:
        logger.exception("provider %s validation crashed", provider.id)
        valid, message, latency = False, f"validation failed: {e}", 0
    # Probe errors may echo secrets; scrub before persisting, caching,
    # returning or logging so the admin `validation_message` never stores them.
    message = sanitize_validation_message(message) or ""
    checked_at = datetime.now(timezone.utc)
    provider.validation_status = "valid" if valid else "invalid"
    provider.validation_message = message
    provider.last_validated_at = checked_at
    db.commit()
    if transport is None:
        await manager.set(
            cache_keys.provider_validation(provider.id),
            {"valid": valid, "message": message, "latency_ms": latency, "checked_at": checked_at.isoformat()},
            ttl=cache_ttl.VALIDATION,
        )
    logger.info("provider %s validation: valid=%s (%s)", provider.id, valid, message)
    return valid, message, latency


# Failure-triggered revalidation: minimum interval per provider between
# revalidation probes (Valkey throttle). Stops a burst of gateway failures
# from hammering the provider with validate calls.
REVALIDATION_COOLDOWN_SECONDS = 300

# Only these failure codes suggest the stored validation state is stale and
# worth re-probing. Every other code (rate limits, not-found, user errors)
# never triggers a revalidation.
_REVALIDATION_CODES = frozenset(
    {ErrorCode.INVALID_CREDENTIALS, ErrorCode.TIMEOUT, ErrorCode.MODEL_UNAVAILABLE}
)


async def request_revalidation(
    db: Session,
    provider_id: uuid.UUID,
    reason: ErrorCode | str | ApplicationException | None,
    *,
    probe=None,
) -> bool:
    """Best-effort revalidation after a classified gateway failure. Never raises.

    Triggers ONLY for INVALID_CREDENTIALS, TIMEOUT and MODEL_UNAVAILABLE —
    codes that suggest the stored validation state is stale. All other codes
    (and success paths — callers never invoke this on success) return False
    without probing.

    Throttled per provider via Valkey (`REVALIDATION_COOLDOWN_SECONDS`
    minimum interval); a throttled call returns False without probing.

    `probe` is an injectable ``async (db, provider_id)`` callable (tests pass
    a fake). When None (production default): under PYTEST_CURRENT_TEST it only
    emits an event + log (zero network); otherwise it clears the validation
    result cache and calls `validate_provider` for a fresh probe.

    Returns True when a probe was requested (or pytest short-circuited).
    """
    code: ErrorCode | None = None
    if isinstance(reason, ErrorCode):
        code = reason
    elif isinstance(reason, ApplicationException):
        code = reason.code if isinstance(reason.code, ErrorCode) else None
    elif isinstance(reason, str):
        try:
            code = ErrorCode(reason)
        except ValueError:
            code = None
    elif reason is not None:
        maybe = getattr(reason, "code", None)
        if isinstance(maybe, ErrorCode):
            code = maybe
    if code not in _REVALIDATION_CODES:
        return False
    manager = get_manager()
    throttle_key = cache_keys.provider_revalidation(provider_id)
    try:
        seen = await manager.get(throttle_key)
    except Exception:
        logger.warning("provider %s revalidation throttle read failed", provider_id, exc_info=True)
        seen = None
    if seen is not None:
        logger.info("provider %s revalidation throttled (%s)", provider_id, code.value)
        return False
    try:
        await manager.set(
            throttle_key,
            {"at": datetime.now(timezone.utc).isoformat()},
            ttl=REVALIDATION_COOLDOWN_SECONDS,
        )
    except Exception:
        logger.warning("provider %s revalidation throttle write failed", provider_id, exc_info=True)
    if probe is not None:
        try:
            result = probe(db, provider_id)
            if inspect.isawaitable(result):
                await result
        except Exception:
            logger.exception("provider %s revalidation probe failed", provider_id)
            return False
        emit("provider.revalidation", provider_id=str(provider_id), code=code.value)
        logger.info("provider %s revalidation probed (%s)", provider_id, code.value)
        return True
    if os.getenv("PYTEST_CURRENT_TEST"):
        emit("provider.revalidation", provider_id=str(provider_id), code=code.value)
        logger.info("provider %s revalidation skipped under pytest (%s)", provider_id, code.value)
        return True
    try:
        # Force a fresh probe past the validate_provider result cache.
        await manager.delete(cache_keys.provider_validation(provider_id))
    except Exception:
        logger.warning("provider %s revalidation cache clear failed", provider_id, exc_info=True)
    try:
        await validate_provider(db, provider_id)
    except Exception:
        logger.exception("provider %s revalidation failed", provider_id)
        return False
    emit("provider.revalidation", provider_id=str(provider_id), code=code.value)
    logger.info("provider %s revalidation finished (%s)", provider_id, code.value)
    return True


async def discover_provider_models(
    db: Session,
    provider_id: uuid.UUID,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> DiscoveryResult:
    """Refresh the provider's discovery cache. Never registers or modifies models.

    Fetches the current model list from the provider, enriches each entry with
    repository intelligence (pricing/capabilities/match type), and stores the
    result on provider metadata for the Available/Registered panels.

    Fresh results are cached for cache_ttl.DISCOVERY seconds behind a
    provider_refresh lock; cache hits recompute registration live from the
    DB. Calls with an explicit transport (tests) always fetch live.
    Org providers additionally require Providers.RefreshModels (404 oracle).
    """
    from tollms.api.models.service import list_models as _list  # avoid import cycle at module load
    from tollms.services.model_repository.mapping import map_models as _map

    provider = get_provider(db, provider_id, user_id)
    if user_id is not None and provider.org_id is not None:
        _require_org_provider_perm(db, provider, user_id, "Providers.RefreshModels")
    registered = {m.model_id for m in _list(db, provider_id=provider.id, user_id=user_id)}
    manager = get_manager()
    cache_key = cache_keys.provider_models(provider.id)
    if transport is None:
        hit = await manager.get(cache_key)
        if isinstance(hit, dict) and isinstance(hit.get("models"), list):
            logger.info("provider %s discovery: cache hit (%s models)", provider.id, hit.get("total", 0))
            return _discovery_from_cache(provider, hit, registered)
    lock_key = cache_keys.provider_refresh_lock(provider.id)
    async with locked(lock_key, cache_ttl.LOCK_PROVIDER_REFRESH * 1000) as acquired:
        if not acquired:
            # Another worker is refreshing; serve cache if it landed meanwhile.
            hit = await manager.get(cache_key)
            if isinstance(hit, dict) and isinstance(hit.get("models"), list):
                return _discovery_from_cache(provider, hit, registered)
            logger.warning("provider %s discovery: refresh busy, fetching live", provider.id)
        try:
            creds = decrypted_credentials(provider)
            adapter = build_adapter(provider, None, creds, transport)
            discovered = await adapter.discover_models()
        except Exception as e:
            logger.exception("provider %s discovery crashed", provider.id)
            return DiscoveryResult(provider_id=provider.id, message=f"discovery failed: {e}")
    mapped = {
        m["model_id"]: m
        for m in _map(
            db,
            [d.model_id for d in discovered],
            provider_type=provider.provider_type.value,
            base_url=(creds.get("base_url") if isinstance(creds, dict) else None),
        )
    }
    infos = []
    for d in discovered:
        match = mapped.get(d.model_id, {})
        suggested = _json_safe(match.get("suggested") or {})
        # Provider identity wins; repository match supplies pricing/capabilities.
        suggested["model_id"] = d.model_id
        suggested["name"] = d.name or d.model_id
        # Endpoint truth: a repository match (provider_specific/global) is
        # authoritative for OpenAI-compatible families (gpt-5 -> responses,
        # text-embedding-3-large -> embeddings). The adapter's own hint is the
        # fallback for unmatched models.
        matched = match.get("match_type") in ("provider_specific", "global")
        if matched:
            primary = suggested.get("primary_endpoint") or d.primary_endpoint
            supported = suggested.get("supported_endpoints") or d.supported_endpoints
        else:
            primary = d.primary_endpoint or d.endpoint_type or suggested.get("primary_endpoint")
            supported = d.supported_endpoints or suggested.get("supported_endpoints")
        if primary:
            supported = [endpoint for endpoint in dict.fromkeys(supported or []) if endpoint]
            if primary not in supported:
                supported.insert(0, primary)
            suggested["primary_endpoint"] = primary
            suggested["supported_endpoints"] = supported
            suggested["endpoint_type"] = _legacy_endpoint(primary)
        endpoint_type = suggested.get("endpoint_type") or d.endpoint_type
        ctx = d.context_window if d.context_window is not None else suggested.get("context_window")
        max_out = d.max_output_tokens if d.max_output_tokens is not None else suggested.get("max_output_tokens")
        for price_key in ("input_price", "output_price", "cache_read_price", "cache_write_price"):
            val = suggested.get(price_key)
            if val is not None:
                s_val = str(val)
                if "." in s_val:
                    suggested[price_key] = s_val.rstrip("0").rstrip(".") or "0"
        if ctx is not None:
            suggested["context_window"] = ctx
        if max_out is not None:
            suggested["max_output_tokens"] = max_out
        infos.append(
            {
                "model_id": d.model_id,
                "name": d.name or d.model_id,
                "endpoint_type": endpoint_type,
                "primary_endpoint": suggested.get("primary_endpoint") or primary,
                "supported_endpoints": suggested.get("supported_endpoints") or supported or [],
                "context_window": ctx,
                "max_output_tokens": max_out,
                "repository_model_key": match.get("repository_model_key"),
                "match_type": match.get("match_type", "fallback"),
                "suggested": suggested,
                "repository_match": _json_safe(match.get("repository_match") or {}),
            }
        )
    now = datetime.now(timezone.utc)
    provider.metadata_ = {
        **(provider.metadata_ or {}),
        "discovery": {"models": infos, "total": len(infos), "last_discovery_at": now.isoformat()},
    }
    db.commit()
    if transport is None:
        await manager.set(
            cache_key,
            {"models": infos, "total": len(infos), "last_discovery_at": now.isoformat()},
            ttl=cache_ttl.DISCOVERY,
        )
    new_count = sum(1 for i in infos if i["model_id"] not in registered)
    logger.info("provider %s discovery: %s found, %s new", provider.id, len(infos), new_count)
    return DiscoveryResult(
        provider_id=provider.id,
        discovered=[DiscoveredModelInfo(**i) for i in infos],
        total=len(infos),
        new_count=new_count,
        registered_count=len(registered),
        last_discovery_at=now,
        message=f"{len(infos)} found, {new_count} available",
    )


def _discovery_from_cache(provider: Provider, hit: dict, registered: set[str]) -> DiscoveryResult:
    """Rebuild a DiscoveryResult from the Valkey payload with live registration."""
    try:
        discovered = [DiscoveredModelInfo(**i) for i in hit.get("models", [])]
    except Exception:
        logger.warning("provider %s discovery: corrupt cache entry", provider.id, exc_info=True)
        return DiscoveryResult(provider_id=provider.id, message="discovery cache unreadable")
    try:
        last = datetime.fromisoformat(str(hit.get("last_discovery_at", "")))
    except ValueError:
        last = None
    total = int(hit.get("total", len(discovered)))
    new_count = sum(1 for d in discovered if d.model_id not in registered)
    return DiscoveryResult(
        provider_id=provider.id,
        discovered=discovered,
        total=total,
        new_count=new_count,
        registered_count=len(registered),
        last_discovery_at=last,
        message=f"{total} found, {new_count} available",
    )


def _json_safe(value: Any) -> Any:
    """Recursively convert dates/decimals to JSON-safe scalars for metadata storage."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _legacy_endpoint(primary: str) -> str:
    """Wire path -> legacy EndpointType value (unknown endpoints degrade to chat)."""
    from tollms.models.registered_model import endpoint_enum

    enum = endpoint_enum(primary)
    return enum.value if enum else "chat_completions"


def _apply_discovered_endpoint(item, match: dict) -> None:
    """Write the resolved endpoint onto a DiscoveredModel (draft discovery).

    Repository matches are authoritative for OpenAI-compatible families; the
    adapter's hint is only used when the repository has nothing to say. Mirrors
    the precedence in `discover_provider_models`.
    """
    from tollms.models.registered_model import endpoint_enum

    suggested = _json_safe(match.get("suggested") or {})
    if suggested:
        item.suggested = suggested
    matched = match.get("match_type") in ("provider_specific", "global")
    if matched:
        primary = suggested.get("primary_endpoint") or item.primary_endpoint
        supported = suggested.get("supported_endpoints") or item.supported_endpoints
    else:
        primary = item.primary_endpoint or item.endpoint_type or suggested.get("primary_endpoint")
        supported = item.supported_endpoints or suggested.get("supported_endpoints")
    if not primary:
        return
    endpoints = [endpoint for endpoint in dict.fromkeys(supported or []) if endpoint]
    if primary not in endpoints:
        endpoints.insert(0, primary)
    item.primary_endpoint = primary
    item.supported_endpoints = endpoints
    enum = endpoint_enum(primary)
    item.endpoint_type = enum.value if enum else "chat_completions"


async def draft_validate(
    provider_type: ProviderType,
    credentials: dict,
    transport: httpx.AsyncBaseTransport | None = None,
    *,
    db: Session | None = None,
):
    """Validate credentials without persisting anything. Returns (valid, message, latency, discovered).

    When a session is provided, discovered models are enriched with repository
    intelligence (`suggested`) so the wizard's validation summary can count
    reasoning/embedding/image/audio models without registering anything.
    """
    from tollms.services.gateway.adapters.base import DiscoveredModel

    probe = Provider(name="draft", provider_type=provider_type, credentials_encrypted="")
    adapter = build_adapter(probe, None, credentials, transport)
    try:
        valid, message, latency = await adapter.validate_credentials()
    except Exception as e:
        logger.exception("draft validation crashed")
        return False, f"validation failed: {e}", 0, []
    discovered: list[DiscoveredModel] = []
    if valid:
        try:
            discovered = await adapter.discover_models()
        except Exception as e:
            logger.exception("draft discovery crashed")
            message = f"{message} (model listing failed: {e})"
    if db is not None and discovered:
        try:
            from tollms.services.model_repository.mapping import map_models

            base_url = credentials.get("base_url") if isinstance(credentials, dict) else None
            mapped = {
                m["model_id"]: m
                for m in map_models(
                    db,
                    [d.model_id for d in discovered],
                    provider_type=provider_type.value,
                    base_url=base_url,
                )
            }
            for item in discovered:
                match = mapped.get(item.model_id) or {}
                _apply_discovered_endpoint(item, match)
        except Exception:
            logger.exception("draft repository mapping failed")
    return valid, message, latency, discovered


def register_provider(
    db: Session, data, user_id: uuid.UUID | None = None
) -> tuple[Provider, list[AIModel], dict[str, int]]:
    """Atomic wizard registration: provider + selected models. Nothing persists on failure."""
    from tollms.api.models.service import create_model as _create_model

    ensure_unique_name(db, data.name, user_id=user_id)
    provider = Provider(
        user_id=user_id,
        name=data.name.strip(),
        provider_type=data.provider_type,
        credentials_encrypted=encrypt(json.dumps(data.credentials)),
        metadata_={**(data.metadata or {}), **({"description": data.description} if data.description else {})},
        validation_status=data.validation_status or "unknown",
        validation_message=data.validation_message,
        last_validated_at=datetime.now(timezone.utc) if data.validation_status else None,
    )
    db.add(provider)
    db.flush()  # id for models; commit once at the end
    models: list[AIModel] = []
    match_stats = {"provider_specific": 0, "global": 0, "fallback": 0}
    for m in data.models:
        payload = m.model_dump(exclude={"repository_match"})
        payload["provider_id"] = provider.id
        model = _create_model(
            db,
            _model_create(**payload),
            repository_match=(m.repository_match or None),
            commit=False,
            user_id=user_id,
        )
        models.append(model)
        match_type = (m.repository_match or {}).get("match_type", "fallback")
        match_stats[match_type if match_type in match_stats else "fallback"] += 1
    db.commit()
    db.refresh(provider)
    logger.info("provider registered: %s (%s) with %s models", provider.id, provider.provider_type, len(models))
    return provider, models, match_stats


def _model_create(**kwargs):
    from tollms.api.models.schemas import ModelCreate

    return ModelCreate(**kwargs)


def credential_security(provider: Provider) -> dict:
    """Validate at-rest encryption: ciphertext present, decryptable, masked."""
    from tollms.core.crypto import ALGORITHM, decrypt

    keys: list[str] = []
    masked = False
    encrypted = False
    raw = provider.credentials_encrypted or ""
    if raw:
        try:
            payload = decrypt(raw)
            keys = sorted(payload.keys())
            encrypted = True
            masked = bool(masked_credentials(provider))
        except Exception:
            logger.warning("provider %s: credentials are not decryptable", provider.id, exc_info=True)
    return {
        "encrypted": encrypted,
        "masked": masked,
        "algorithm": ALGORITHM,
        "credential_keys": keys,
        "validation_status": provider.validation_status or "unknown",
        "last_validated_at": provider.last_validated_at,
    }
