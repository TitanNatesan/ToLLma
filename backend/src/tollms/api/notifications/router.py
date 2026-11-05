"""Notification endpoints (authenticated owner only)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.notifications import service
from tollms.api.notifications.service import NotificationRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationRead])
def list_all(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_notifications(db, user.id, limit)


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> dict:
    return {"unread": service.unread_count(db, user.id)}


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_read(notification_id: uuid.UUID, db: Session = Depends(get_db),
              user: User = Depends(require_active_user)):
    return service.mark_read(db, user.id, notification_id)


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> dict:
    return {"marked": service.mark_all_read(db, user.id)}
