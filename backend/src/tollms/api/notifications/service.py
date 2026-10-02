"""Notification reads: list (unread first), unread count, mark read. Owner-only."""

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError
from tollms.models.organization import Notification


class NotificationRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID | None
    kind: str
    title: str
    body: str | None
    ref: dict
    read_at: datetime | None
    created_at: datetime


def _read(n: Notification) -> NotificationRead:
    return NotificationRead(
        id=n.id, org_id=n.org_id, kind=n.kind, title=n.title, body=n.body,
        ref=dict(n.ref or {}), read_at=n.read_at, created_at=n.created_at,
    )


def list_notifications(db: Session, user_id: uuid.UUID, limit: int = 50) -> list[NotificationRead]:
    rows = db.execute(
        select(Notification).where(Notification.user_id == user_id)
        .order_by(Notification.read_at.is_(None).desc(), Notification.created_at.desc())
        .limit(min(max(limit, 1), 100))
    ).scalars().all()
    return [_read(n) for n in rows]


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.read_at.is_(None))
    ).scalar_one()


def mark_read(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> NotificationRead:
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user_id:
        raise NotFoundError("notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(n)
    return _read(n)


def mark_all_read(db: Session, user_id: uuid.UUID) -> int:
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ).scalars().all()
    for n in rows:
        n.read_at = now
    db.commit()
    return len(rows)
