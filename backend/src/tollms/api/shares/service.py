"""Public conversation sharing: create/disable/regenerate + read-only lookup."""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.api.shares.schemas import (
    PublicShareMessage,
    PublicShareRead,
    ShareRead,
)
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.share import ConversationShare
from tollms.services.cache import constants as cache_constants
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_delete_sync, cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)

TOKEN_BYTES = 24


def _share_url(token: str) -> str:
    return f"/share/{token}"


def _read(share: ConversationShare) -> ShareRead:
    return ShareRead(
        id=share.id,
        conversation_id=share.conversation_id,
        share_token=share.share_token,
        share_url=_share_url(share.share_token),
        is_public=share.is_public,
        expires_at=share.expires_at,
        view_count=share.view_count,
        created_at=share.created_at,
    )


def _get_owned(db: Session, share_id: uuid.UUID, user_id: uuid.UUID | None) -> ConversationShare:
    share = db.get(ConversationShare, share_id)
    if share is None or (user_id is not None and share.user_id != user_id):
        raise NotFoundError("share not found")
    return share


def _active_share(db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None) -> ConversationShare | None:
    stmt = (
        select(ConversationShare)
        .where(
            ConversationShare.conversation_id == conversation_id,
            ConversationShare.is_public.is_(True),
        )
        .order_by(ConversationShare.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(ConversationShare.user_id == user_id)
    return db.execute(stmt).scalars().first()


def create_share(
    db: Session,
    user_id: uuid.UUID | None,
    conversation_id: uuid.UUID,
    expires_in_hours: int | None = None,
) -> ShareRead:
    """Idempotent: reuses the live public link instead of minting duplicates."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.is_deleted or (
        user_id is not None and conversation.user_id != user_id
    ):
        raise NotFoundError("conversation not found")

    existing = _active_share(db, conversation_id, user_id)
    if existing is not None and (existing.expires_at is None or existing.expires_at > datetime.now(timezone.utc)):
        return _read(existing)

    share = ConversationShare(
        conversation_id=conversation_id,
        user_id=user_id,
        share_token=secrets.token_urlsafe(TOKEN_BYTES),
        is_public=True,
        expires_at=_expiry(expires_in_hours),
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    cache_delete_sync(cache_keys.share_lookup(share.share_token))
    return _read(share)


def _expiry(expires_in_hours: int | None) -> datetime | None:
    if expires_in_hours is None:
        return None
    return datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)


def list_shares(
    db: Session, user_id: uuid.UUID | None, conversation_id: uuid.UUID
) -> list[ShareRead]:
    stmt = (
        select(ConversationShare)
        .where(ConversationShare.conversation_id == conversation_id)
        .order_by(ConversationShare.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(ConversationShare.user_id == user_id)
    return [_read(row) for row in db.execute(stmt).scalars()]


def update_share(
    db: Session, user_id: uuid.UUID | None, share_id: uuid.UUID, *, is_public: bool | None, expires_in_hours: int | None
) -> ShareRead:
    share = _get_owned(db, share_id, user_id)
    if is_public is not None:
        share.is_public = is_public
    if expires_in_hours is not None:
        share.expires_at = _expiry(expires_in_hours)
    db.commit()
    db.refresh(share)
    cache_delete_sync(cache_keys.share_lookup(share.share_token))
    return _read(share)


def disable_share(db: Session, user_id: uuid.UUID | None, share_id: uuid.UUID) -> ShareRead:
    return update_share(db, user_id, share_id, is_public=False, expires_in_hours=None)


def regenerate_share(db: Session, user_id: uuid.UUID | None, share_id: uuid.UUID) -> ShareRead:
    """Rotate the token (old link stops working immediately)."""
    share = _get_owned(db, share_id, user_id)
    old_token = share.share_token
    share.share_token = secrets.token_urlsafe(TOKEN_BYTES)
    share.is_public = True
    db.commit()
    db.refresh(share)
    cache_delete_sync(cache_keys.share_lookup(old_token), cache_keys.share_lookup(share.share_token))
    return _read(share)


def _bump_view_count(db: Session, token: str) -> int | None:
    """Best-effort view counter for one public read. Active shares only;
    returns the new count, or None when the link is gone/inactive/expired.
    Never raises: counter failures must not block the read."""
    try:
        share = db.execute(
            select(ConversationShare).where(ConversationShare.share_token == token)
        ).scalar_one_or_none()
        if share is None or not share.is_public:
            return None
        if share.expires_at is not None and share.expires_at <= datetime.now(timezone.utc):
            return None
        share.view_count += 1
        db.commit()
        return int(share.view_count)
    except Exception:
        db.rollback()
        logger.warning("share view-count bump failed", exc_info=True)
        return None


def _load_public(db: Session, token: str) -> PublicShareRead:
    share = db.execute(
        select(ConversationShare).where(
            ConversationShare.share_token == token, ConversationShare.is_public.is_(True)
        )
    ).scalar_one_or_none()
    if share is None:
        raise NotFoundError("share link not found")
    if share.expires_at is not None and share.expires_at <= datetime.now(timezone.utc):
        raise NotFoundError("share link expired")

    conversation = db.get(Conversation, share.conversation_id)
    if conversation is None or conversation.is_deleted:
        raise NotFoundError("conversation not found")

    # Every live branch/root, including failed/cancelled generations (safe
    # error info only): those stay visible even when they produced no content.
    # System prompts and soft-deleted rows are never shared. Single query,
    # strictly scoped to the token's conversation.
    messages = list(
        db.execute(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.is_deleted.is_(False),
                Message.role != Role.SYSTEM,
                or_(
                    Message.content != "",
                    Message.status.in_([MessageStatus.FAILED, MessageStatus.CANCELLED]),
                ),
            )
            .order_by(Message.created_at.asc(), Message.id.asc())
        ).scalars()
    )
    model_name = (
        db.execute(select(AIModel.name).where(AIModel.id == conversation.model_id)).scalar_one_or_none()
        if conversation.model_id
        else None
    )
    provider_name = (
        db.execute(select(Provider.name).where(Provider.id == conversation.provider_id)).scalar_one_or_none()
        if conversation.provider_id
        else None
    )

    return PublicShareRead(
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        model_name=model_name,
        provider_name=provider_name,
        messages=[
            PublicShareMessage(
                id=message.id,
                parent_message_id=message.parent_message_id,
                version_number=message.version_number,
                role=message.role.value,
                status=message.status,
                content=message.content,
                error=message.error,
                error_code=message.error_code,
                created_at=message.created_at,
                model_name=model_name if message.role == Role.ASSISTANT else None,
            )
            for message in messages
        ],
        tree={
            "nodes": [
                {
                    "id": message.id,
                    "parent_message_id": message.parent_message_id,
                    "role": message.role.value,
                    "version_number": message.version_number,
                    "status": message.status.value,
                    "created_at": message.created_at,
                }
                for message in messages
            ],
            "active_leaf_id": conversation.active_leaf_message_id,
        },
        view_count=share.view_count,
    )


def public_share(db: Session, token: str) -> PublicShareRead:
    """Unauthenticated read-only lookup, cached briefly (revocation must stick).

    The view counter moves on EVERY read, outside the cache-hit path: the
    cached payload is still served (TTL untouched) while the counter update
    is best-effort and never blocks the response. A cached entry whose link
    has since been revoked/expired fails closed with 404.
    """
    key = cache_keys.share_lookup(token)
    cached = cache_get_sync(key)
    views = _bump_view_count(db, token)
    if cached is not None:
        if views is None:
            cache_delete_sync(key)
            raise NotFoundError("share link not found")
        try:
            payload = PublicShareRead.model_validate(cached)
        except Exception:
            # Stale entry from a previous payload shape: drop it and load fresh.
            logger.warning("share cache entry failed validation, reloading", exc_info=True)
            cache_delete_sync(key)
            cached = None
        else:
            payload.view_count = views
            return payload

    payload = _load_public(db, token)
    if views is not None:
        payload.view_count = views
    cache_set_sync(key, payload.model_dump(mode="json"), ttl=cache_constants.SHARE)
    return payload
