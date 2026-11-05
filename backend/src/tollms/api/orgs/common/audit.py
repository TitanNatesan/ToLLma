"""Shared org audit + notification writers (leaf module)."""

import uuid

from sqlalchemy.orm import Session

from tollms.models.organization import AuditLog, Notification


def _audit(db: Session, org_id: uuid.UUID | None, actor: uuid.UUID | None, action: str, **target) -> None:
    db.add(AuditLog(org_id=org_id, actor_user_id=actor, action=action, target=dict(target)))



def _notify(db: Session, user_id: uuid.UUID, kind: str, title: str, org_id: uuid.UUID | None = None,
            body: str | None = None, **ref) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, org_id=org_id, ref=dict(ref)))

