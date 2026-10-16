"""Org audit trail reads."""

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.guards import (
    _clamp_limit,
    _member_org,
    _parse_time,
    _parse_uuid,
    _require_perm,
)
from tollms.api.orgs.schemas import AuditRead
from tollms.core.exceptions import ValidationError
from tollms.models.organization import AuditLog
from tollms.models.user import User


def get_audit(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, limit: int = 100, *,
              action: str | None = None, actor: str | None = None,
              from_: str | None = None, to_: str | None = None,
              cursor: str | None = None) -> list[AuditRead]:
    """Audit trail, newest first (created_at desc, id tiebreak for stable
    paging). ?action= exact-matches (values with no events yield []; never
    422); ?actor= filters by actor user id (malformed UUID is 422);
    ?from=/?to= bound created_at as ISO dates/datetimes (malformed is 422).
    ?cursor= paginates: either a non-negative integer offset or an audit-row
    UUID meaning "rows strictly older than this row" (unknown/foreign ids are
    422). Rows carry batch-resolved actor_email/actor_name; system events
    (actor None) keep null enrichment. Default limit-only calls behave as
    before."""
    org, mem = _member_org(db, org_id, user_id)
    _require_perm(db, org, mem, user_id, "Audit.Read")
    lim = _clamp_limit(limit, 100) or 100
    stmt = select(AuditLog).where(AuditLog.org_id == org_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    actor_id = _parse_uuid(actor, "actor")
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_user_id == actor_id)
    from_dt = _parse_time(from_, "from")
    if from_dt is not None:
        stmt = stmt.where(AuditLog.created_at >= from_dt)
    to_dt = _parse_time(to_, "to", end_of_day=True)
    if to_dt is not None:
        stmt = stmt.where(AuditLog.created_at <= to_dt)
    off = 0
    if cursor:
        text = cursor.strip()
        try:
            off = max(int(text), 0)
        except (ValueError, TypeError):
            anchor_id = _parse_uuid(text, "cursor")
            anchor = db.get(AuditLog, anchor_id) if anchor_id is not None else None
            if anchor is None or anchor.org_id != org_id:
                raise ValidationError(f"unknown cursor: {cursor!r}") from None
            stmt = stmt.where(or_(
                AuditLog.created_at < anchor.created_at,
                and_(AuditLog.created_at == anchor.created_at, AuditLog.id < anchor.id),
            ))
    stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(lim)
    if off:
        stmt = stmt.offset(off)
    rows = list(db.execute(stmt).scalars().all())
    actor_ids = list({r.actor_user_id for r in rows if r.actor_user_id is not None})
    users = {u.id: u for u in db.execute(
        select(User).where(User.id.in_(actor_ids))).scalars().all()} if actor_ids else {}
    return [AuditRead(id=r.id, action=r.action, actor_user_id=r.actor_user_id,
                      target=dict(r.target or {}), created_at=r.created_at,
                      actor_email=(users[r.actor_user_id].email if r.actor_user_id in users else None),
                      actor_name=(users[r.actor_user_id].full_name if r.actor_user_id in users else None))
            for r in rows]

