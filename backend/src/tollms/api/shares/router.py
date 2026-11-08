"""Conversation sharing endpoints (owner-scoped + one public read)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.shares import service
from tollms.api.shares.schemas import PublicShareRead, ShareCreate, ShareRead, ShareUpdate
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/shares", tags=["shares"])


@router.post("", response_model=ShareRead, status_code=201)
def create(
    data: ShareCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ShareRead:
    return service.create_share(db, user.id, data.conversation_id, data.expires_in_hours)


@router.get("", response_model=list[ShareRead])
def list_all(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ShareRead]:
    return service.list_shares(db, user.id, conversation_id)


@router.patch("/{share_id}", response_model=ShareRead)
def update(
    share_id: uuid.UUID,
    data: ShareUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ShareRead:
    return service.update_share(
        db, user.id, share_id, is_public=data.is_public, expires_in_hours=data.expires_in_hours
    )


@router.delete("/{share_id}", response_model=ShareRead)
def disable(
    share_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ShareRead:
    return service.disable_share(db, user.id, share_id)


@router.post("/{share_id}/regenerate", response_model=ShareRead)
def regenerate(
    share_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ShareRead:
    return service.regenerate_share(db, user.id, share_id)


@router.get("/public/{token}", response_model=PublicShareRead)
def public(token: str, db: Session = Depends(get_db)) -> PublicShareRead:
    """Unauthenticated read-only view. No user or credential data is exposed."""
    return service.public_share(db, token)
