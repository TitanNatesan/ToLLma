"""Security endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from tollms.api.security import service
from tollms.api.security.schemas import KekStatus, RevokeAllResult, SecurityAuditRead
from tollms.core.deps import get_db
from tollms.core.security import platform_admin_required, require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/security", tags=["security"])


@router.get("/audit", response_model=list[SecurityAuditRead])
def read_audit(
    event_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    limit: int = Query(default=100),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(platform_admin_required),
) -> list[SecurityAuditRead]:
    """Platform-admin audit reads. 403 for regular accounts (never 404 oracle:
    the platform role itself is not secret)."""
    actor_id: uuid.UUID | None = None
    if actor:
        from tollms.core.exceptions import ValidationError

        try:
            actor_id = uuid.UUID(actor)
        except (ValueError, TypeError, AttributeError):
            raise ValidationError(f"unknown actor: {actor!r}") from None
    rows = service.list_events(
        db, event_type=event_type, severity=severity,
        actor_user_id=actor_id, outcome=outcome, limit=limit, cursor=cursor,
    )
    return [SecurityAuditRead(**row) for row in rows]


@router.post("/sessions/revoke-all", response_model=RevokeAllResult)
async def revoke_all(
    request: Request, db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> RevokeAllResult:
    """Destroy every live session for the caller (including this one).
    Re-login required afterwards. Thin wrapper over the session store."""
    del db, request
    revoked = await service.revoke_all_sessions(user.id)
    return RevokeAllResult(revoked=revoked)


@router.get("/kek/status", response_model=KekStatus)
def kek_status(
    db: Session = Depends(get_db), user: User = Depends(require_active_user)
) -> KekStatus:
    """KEK version info. Algorithm + versions only — never key material."""
    del db, user
    return KekStatus(**service.kek_status())
