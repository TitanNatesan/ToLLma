"""Settings application service: preferences, profile, password, sessions.

Valkey owns session state (metadata + index); PostgreSQL owns users and the
durable per-session usage aggregates (messages.session_id).
"""

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.api.settings.schemas import (
    DEFAULT_PREFERENCES,
    PasswordChange,
    PreferencesRead,
    PreferencesUpdate,
    ProfileUpdate,
    SessionRead,
    SessionsRead,
)
from tollms.core import security
from tollms.core.exceptions import (
    AuthenticationError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from tollms.models.message import Message, Role
from tollms.models.user import User

logger = logging.getLogger(__name__)


# --- preferences ------------------------------------------------------------


def get_preferences(db: Session, user: User) -> PreferencesRead:
    """Stored preferences merged over defaults. Corrupt values never break the UI."""
    merged: dict[str, Any] = dict(DEFAULT_PREFERENCES)
    stored = user.preferences if isinstance(user.preferences, dict) else {}
    for key in DEFAULT_PREFERENCES:
        if key in stored:
            merged[key] = stored[key]
    try:
        return PreferencesRead(**merged)
    except Exception:
        logger.warning("user %s: invalid stored preferences, using defaults", user.id, exc_info=True)
        return PreferencesRead()


def update_preferences(db: Session, user: User, data: PreferencesUpdate) -> PreferencesRead:
    """Merge a partial update into the user's JSONB preferences column."""
    stored = dict(user.preferences) if isinstance(user.preferences, dict) else {}
    stored.update(data.model_dump(exclude_unset=True))
    user.preferences = stored
    db.commit()
    db.refresh(user)
    return get_preferences(db, user)


# --- profile ----------------------------------------------------------------


async def update_profile(db: Session, user: User, data: ProfileUpdate) -> User:
    """Update profile fields. Email changes reset verification and re-send the link."""
    fields = data.model_fields_set
    email_changed = False

    if "email" in fields and data.email is not None:
        address = auth_service.normalize_email(str(data.email))
        if address != user.email:
            existing = auth_service.get_by_email(db, address)
            if existing is not None and existing.id != user.id:
                raise ConflictError("email already registered")
            user.email = address
            user.email_verified = False
            email_changed = True

    if "full_name" in fields:
        user.full_name = data.full_name or None

    if "username" in fields:
        username = data.username
        if username is not None:
            existing = db.scalar(
                select(User).where(
                    User.username == username,
                    User.is_deleted.is_(False),
                    User.id != user.id,
                )
            )
            if existing is not None:
                raise ConflictError("username already taken")
        user.username = username

    if "avatar_url" in fields:
        user.avatar_url = data.avatar_url or None

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ConflictError("email or username already in use") from e
    db.refresh(user)

    if email_changed:
        await auth_service.issue_verification(db, user)
        logger.info("profile email changed for user %s (verification sent)", user.id)
    return user


# --- password ---------------------------------------------------------------


async def change_password(
    db: Session, user: User, data: PasswordChange, *, keep_session_id: str | None
) -> int:
    """Verify the current password, store the new hash, revoke every other session.

    Local-auth only: OAuth accounts have no local password (403, never 422, so
    the UI can hide the section and the API stays honest).
    """
    if user.provider != "local" or not user.has_password:
        raise ForbiddenError("password management is not available for OAuth accounts")
    if not user.password_hash:
        raise ForbiddenError("this account has no local password")
    if not security.verify_password(data.current_password, user.password_hash):
        raise AuthenticationError("current password is incorrect")
    if security.verify_password(data.new_password, user.password_hash):
        raise ValidationError("new password must be different from the current one")
    security.validate_password_strength(data.new_password)
    user.password_hash = security.hash_password(data.new_password)
    user.has_password = True
    db.commit()
    revoked = await security.revoke_other_sessions(user.id, keep_session_id or "")
    logger.info("password changed for user %s (%d other sessions revoked)", user.id, revoked)
    return revoked


# --- sessions ---------------------------------------------------------------


def _location(ip: str) -> str | None:
    """Coarse location label. No geo database: private ranges are labelled
    honestly, public addresses stay unknown rather than guessing."""
    if not ip:
        return None
    if ip in ("::1", "localhost"):
        return "Local network"
    if ip.startswith(("127.", "10.", "192.168.", "169.254.")):
        return "Local network"
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
        except (IndexError, ValueError):
            return None
        if 16 <= second <= 31:
            return "Local network"
    return None


def _parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def parse_user_agent(user_agent: str) -> tuple[str, str]:
    """(browser, os) coarse labels from a UA string. Dependency-free heuristics."""
    text = (user_agent or "").lower()
    browser = "Unknown"
    for needle, label in (
        ("edg/", "Edge"),
        ("opr/", "Opera"),
        ("chrome/", "Chrome"),
        ("crios/", "Chrome"),
        ("firefox/", "Firefox"),
        ("fxios/", "Firefox"),
        ("safari/", "Safari"),
    ):
        if needle in text:
            browser = label
            break
    os_name = "Unknown"
    for needle, label in (
        ("windows", "Windows"),
        ("android", "Android"),
        ("iphone", "iOS"),
        ("ipad", "iOS"),
        ("mac os x", "macOS"),
        ("macintosh", "macOS"),
        ("linux", "Linux"),
    ):
        if needle in text:
            os_name = label
            break
    return browser, os_name


def _session_usage(db: Session, session_ids: list[str]) -> dict[str, tuple[int, int]]:
    """(requests, tokens) per session id, from durable assistant rows."""
    if not session_ids:
        return {}
    rows = db.execute(
        select(
            Message.session_id,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
        )
        .where(
            Message.session_id.in_(session_ids),
            Message.is_deleted.is_(False),
            Message.role == Role.ASSISTANT,
        )
        .group_by(Message.session_id)
    ).all()
    return {str(r[0]): (int(r[1]), int(r[2])) for r in rows}


async def list_sessions(db: Session, user_id: uuid.UUID, current_session_id: str | None) -> SessionsRead:
    records = await security.list_session_records(user_id, current_session_id)
    usage = _session_usage(db, [str(r["session_id"]) for r in records])
    sessions = []
    for record in records:
        browser, os_name = parse_user_agent(str(record.get("user_agent", "")))
        device = (
            f"{browser} on {os_name}"
            if browser != "Unknown" and os_name != "Unknown"
            else (browser if browser != "Unknown" else (os_name if os_name != "Unknown" else "Unknown device"))
        )
        requests, tokens = usage.get(str(record["session_id"]), (0, 0))
        login_method = str(record.get("login_method", "password"))
        sessions.append(
            SessionRead(
                id=str(record["session_id"]),
                current=bool(record.get("current")),
                device=device,
                browser=browser,
                os=os_name,
                provider="google" if login_method == "google" else "local",
                location=_location(str(record.get("ip") or "")),
                ip=str(record.get("ip") or "") or None,
                login_method=login_method,
                created_at=_parse_iso(record.get("created_at")),
                last_seen=_parse_iso(record.get("last_seen")),
                requests=requests,
                tokens=tokens,
            )
        )
    return SessionsRead(sessions=sessions, total=len(sessions))


async def revoke_session(
    db: Session, user_id: uuid.UUID, session_id: str, current_session_id: str | None
) -> None:
    """Revoke one session. Current session must use logout instead."""
    if current_session_id and session_id == current_session_id:
        raise ValidationError("cannot revoke the current session; use logout instead")
    records = await security.list_session_records(user_id)
    if session_id not in {str(r["session_id"]) for r in records}:
        raise NotFoundError("session not found")
    await security.destroy_session(session_id)
    logger.info("session revoked for user %s: %s", user_id, session_id)


async def revoke_other_sessions(user_id: uuid.UUID, current_session_id: str | None) -> int:
    return await security.revoke_other_sessions(user_id, current_session_id or "")
