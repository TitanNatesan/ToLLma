"""Org-scoped API keys: issuance, listing, revocation.

Canonical owner of ALL org-scoped key operations. ``api/orgs/keys/service.py``
is a thin delegating wrapper so org URLs stay unchanged.

Org keys (``api_keys.org_id`` set) are issued to ACTIVE members, budgeted
against the org cap, and revoked on membership loss. Raw keys are shown once
at issuance and never stored. Personal keys (``org_id`` NULL) live in
``api/keys/service.py`` and never appear here.
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from tollms.api.keys import service as keys_service
from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import (
    _clamp_limit,
    _clamp_offset,
    _live_membership,
    _member_org,
    _require_perm,
    _search_like,
)
from tollms.api.orgs.schemas import OrgKeyRead
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.organization import Membership, MembershipState
from tollms.models.user import User

logger = logging.getLogger(__name__)


def active_org_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Org ids where `user_id` holds ACTIVE, live membership."""
    return set(
        r[0] for r in db.execute(
            select(Membership.org_id).where(
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        ).all()
    )



def _org_key_select():
    from tollms.models.api_key import ApiKey

    return (
        select(ApiKey)
        .where(ApiKey.is_deleted.is_(False))
        .options(
            selectinload(ApiKey.policy),
            selectinload(ApiKey.ip_rules),
            selectinload(ApiKey.model_permissions),
        )
    )



def _read_org_key(db: Session, key, spend_usd: float = 0.0) -> OrgKeyRead:
    assignee = db.get(User, key.user_id)
    return OrgKeyRead(
        id=key.id, org_id=key.org_id, assignee_user_id=key.user_id,
        assignee_email=assignee.email if assignee else None,
        issued_by=key.issued_by, name=key.name, description=key.description,
        key_prefix=key.key_prefix, masked=keys_service.masked_prefix(key.key_prefix),
        enabled=key.enabled, expires_at=key.expires_at, last_used_at=key.last_used_at,
        rotation_count=key.rotation_count,
        policy=key.policy, ip_rules=list(key.ip_rules or []),
        model_permissions=list(key.model_permissions or []),
        created_at=key.created_at, updated_at=key.updated_at,
        spend_usd=spend_usd,
    )



def _allocated_budget(db: Session, org_id: uuid.UUID) -> Decimal:
    """SUM(policy.max_budget_usd) over live org keys (NULL budgets count 0)."""
    from tollms.models.api_key import ApiKey, ApiKeyPolicy

    total = db.scalar(
        select(func.coalesce(func.sum(ApiKeyPolicy.max_budget_usd), 0))
        .join(ApiKey, ApiKey.id == ApiKeyPolicy.api_key_id)
        .where(
            ApiKey.org_id == org_id, ApiKey.is_deleted.is_(False),
            ApiKey.enabled.is_(True),
        )
    )
    return Decimal(str(total or 0))



def create_org_key(
    db: Session, caller_id: uuid.UUID, org_id: uuid.UUID, *, assignee_user_id: uuid.UUID,
    name: str, description: str | None, max_budget_usd: Decimal | None,
    model_permissions: list,
    expires_at: datetime | None = None,
    policy=None,
    ip_rules: list | None = None,
) -> tuple:
    """Issue an org key to an ACTIVE member. Gates (all 404-oracle except budget):

    - caller ACTIVE member + ``Keys.Create`` (strangers denied as 404);
    - assignee ACTIVE member (else 404);
    - every listed model scope visible to the granter (escalation rule);
    - org cap: allocated + new <= max_spend (else 422).
    Accepts the same full field set as personal key creation (expiration,
    limits/rate limits/spend caps, IP allow/deny rules, model restrictions
    with per-model caps); only the assignee is org-specific.
    """
    from tollms.api.keys.schemas import ApiKeyCreate, PolicyIn
    from tollms.models.api_key import ApiKey
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    granter = _require_perm(db, org, mem, caller_id, "Keys.Create")
    assignee = _live_membership(db, org_id, assignee_user_id)
    if assignee is None:
        raise NotFoundError("member not found")
    effective_policy = policy
    if effective_policy is None and max_budget_usd is not None:
        effective_policy = PolicyIn(max_budget_usd=max_budget_usd)
    elif (
        effective_policy is not None
        and effective_policy.max_budget_usd is None
        and max_budget_usd is not None
    ):
        effective_policy = effective_policy.model_copy(update={"max_budget_usd": max_budget_usd})
    effective_budget = effective_policy.max_budget_usd if effective_policy else None
    data = ApiKeyCreate(
        name=name, description=description, expires_at=expires_at,
        policy=effective_policy,
        ip_rules=list(ip_rules or []),
        model_permissions=list(model_permissions or []),
    )
    parts = keys_service.prepare_key_parts(
        db, data, caller_id, visible_org_ids=active_org_ids(db, caller_id),
        key_org_id=org_id,
    )
    _ = granter  # visibility (not code-grant) gates model scope per spec
    if org.max_spend is not None:
        new_budget = effective_budget or Decimal("0")
        if _allocated_budget(db, org_id) + new_budget > Decimal(str(org.max_spend)):
            raise ValidationError(
                f"org budget cap exceeded: allocated + {new_budget} > {org.max_spend}"
            )
    api_key, raw_key = keys_service.persist_key(
        db, parts, user_id=assignee_user_id, org_id=org_id, issued_by=caller_id,
    )
    db.flush()
    stored = db.scalar(_org_key_select().where(ApiKey.id == api_key.id))
    emit("key.issued", key_id=str(api_key.id), org_id=str(org_id),
         user_id=str(assignee_user_id), issued_by=str(caller_id))
    _audit(db, org_id, caller_id, "key.issued", key_id=str(api_key.id),
           user_id=str(assignee_user_id))
    db.commit()
    logger.info("org key issued: %s org=%s assignee=%s", api_key.id, org_id, assignee_user_id)
    return _read_org_key(db, stored), raw_key



def list_org_keys(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID, *,
                  search: str | None = None, limit: int | None = None,
                  offset: int = 0) -> list[OrgKeyRead]:
    """Metadata only — never hashes or raw key material. Each key carries
    spend_usd = SUM(api_request_logs.cost) over successful gateway traffic
    (0.0 with no traffic), resolved with one grouped query for the page.
    ?search= matches the key name; limit/offset paginate (absent limit =
    full list, the historical default)."""
    from tollms.models.api_key import ApiKey, ApiRequestLog

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Keys.Read")
    stmt = (
        _org_key_select()
        .where(ApiKey.org_id == org_id)
    )
    like = _search_like(search)
    if like is not None:
        stmt = stmt.where(func.lower(ApiKey.name).like(like))
    stmt = stmt.order_by(ApiKey.created_at.desc())
    lim = _clamp_limit(limit, None)
    if lim is not None:
        stmt = stmt.limit(lim)
    off = _clamp_offset(offset)
    if off:
        stmt = stmt.offset(off)
    rows = list(db.scalars(stmt).all())
    spend: dict[uuid.UUID, float] = {}
    if rows:
        ids = [k.id for k in rows]
        spend = {
            kid: float(total or 0) for kid, total in db.execute(
                select(ApiRequestLog.api_key_id, func.coalesce(func.sum(ApiRequestLog.cost), 0))
                .where(ApiRequestLog.api_key_id.in_(ids), ApiRequestLog.status == "success")
                .group_by(ApiRequestLog.api_key_id)
            ).all()
        }
    return [_read_org_key(db, k, spend_usd=spend.get(k.id, 0.0)) for k in rows]



def revoke_org_key(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                   key_id: uuid.UUID) -> None:
    """Revoke one org key: enabled=False + soft-delete. Never reactivates —
    re-issuance is always a new row."""
    from tollms.models.api_key import ApiKey
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Keys.Revoke")
    key = db.scalar(
        _org_key_select().where(ApiKey.id == key_id, ApiKey.org_id == org_id)
    )
    if key is None:
        raise NotFoundError("api key not found")
    key_hash = key.key_hash
    key.enabled = False
    key.is_deleted = True
    key.deleted_at = datetime.now(timezone.utc)
    key.deleted_by = caller_id
    _audit(db, org_id, caller_id, "key.revoked", key_id=str(key_id),
           user_id=str(key.user_id))
    db.commit()
    key_engine.invalidate_context(key_hash)
    key_engine.write_tombstone(key_hash)
    emit("key.revoked", key_id=str(key_id), org_id=str(org_id), user_id=str(caller_id))
    logger.info("org key revoked: %s org=%s", key_id, org_id)



def _revoke_member_keys(db: Session, org_id: uuid.UUID, user_id: uuid.UUID, *,
                        reason: str, actor_id: uuid.UUID | None) -> None:
    """Revoke ALL live org keys assigned to `user_id` in `org_id`.

    Called from remove/suspend/leave. Resume/approve NEVER restore keys:
    re-issuance is always a new row. Other members' keys and the user's
    personal keys are untouched.
    """
    from tollms.models.api_key import ApiKey
    from tollms.services.api_keys import keys as key_engine
    from tollms.services.observability.events import emit

    rows = db.scalars(
        select(ApiKey).where(
            ApiKey.org_id == org_id, ApiKey.user_id == user_id,
            ApiKey.is_deleted.is_(False),
        )
    ).all()
    for key in rows:
        key_hash = key.key_hash
        key.enabled = False
        key.is_deleted = True
        key.deleted_at = datetime.now(timezone.utc)
        key.deleted_by = actor_id
        _audit(db, org_id, actor_id, "key.revoked", key_id=str(key.id),
               user_id=str(user_id), reason=reason)
        emit("key.revoked", key_id=str(key.id), org_id=str(org_id),
             user_id=str(user_id), reason=reason)
        try:
            key_engine.invalidate_context(key_hash)
            key_engine.write_tombstone(key_hash)
        except Exception:
            logger.warning("org key revocation cache cleanup failed: %s", key.id, exc_info=True)
    if rows:
        logger.info("org keys revoked on %s: user=%s count=%d", reason, user_id, len(rows))
    db.flush()

