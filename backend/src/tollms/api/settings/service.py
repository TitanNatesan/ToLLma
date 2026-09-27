"""Settings application service: preferences, profile, password, sessions.

Valkey owns session state (metadata + index); PostgreSQL owns users and the
durable per-session usage aggregates (messages.session_id).
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.api.keys import service as keys_service
from tollms.api.settings.schemas import (
    DEFAULT_PREFERENCES,
    AccountDeleteRequest,
    AccountDeletionStatus,
    PasswordChange,
    PasswordSet,
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
    EmailVerificationRequiredError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from tollms.models.message import Message, Role
from tollms.models.user import User
from tollms.services.email import send_account_deletion_requested
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)

# Grace period between a delete-request and the hard purge (fixed; no settings).
DELETION_GRACE_DAYS = 15


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

# Passwordless accounts confirm an email change with a fresh Google login:
# the caller's session must be google-method and created within this window.
_RECENT_GOOGLE_SESSION_SECONDS = 15 * 60


async def _authorize_email_change(
    user: User, data: ProfileUpdate, current_session_id: str | None
) -> None:
    """Fail-closed confirmation for a staged email change.

    Local-with-password accounts prove with `current_password` (missing ->
    422, wrong -> 401). Passwordless accounts (Google / OAuth-only) must hold
    a google-method session created within 15 minutes, otherwise 403.
    """
    if user.has_password and user.password_hash:
        if not data.current_password:
            raise ValidationError("current password is required to change email")
        if not security.verify_password(data.current_password, user.password_hash):
            raise AuthenticationError("current password is incorrect")
        return
    if not current_session_id:
        raise ForbiddenError("recent Google sign-in required")
    session = await security.get_session(current_session_id)
    if session is None or session.get("user_id") != str(user.id):
        raise ForbiddenError("recent Google sign-in required")
    if str(session.get("login_method", "")) != "google":
        raise ForbiddenError("recent Google sign-in required")
    created = _parse_iso(session.get("created_at"))
    if created is None:
        raise ForbiddenError("recent Google sign-in required")
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - created).total_seconds()
    if age < 0 or age > _RECENT_GOOGLE_SESSION_SECONDS:
        raise ForbiddenError("recent Google sign-in required")


async def update_profile(
    db: Session, user: User, data: ProfileUpdate, *, current_session_id: str | None = None
) -> User:
    """Update profile fields.

    Email changes never swap `email` directly: after confirmation they stage
    `pending_email`/`pending_email_requested_at` (replacing any previous
    request), keep `email_verified` as-is, and send the verification link to
    the NEW address plus a fact-only notice to the OLD address. The swap
    happens when the new address is verified. Same-address changes are a
    no-op 200; taken addresses 409 before anything is sent.
    """
    fields = data.model_fields_set
    pending_address: str | None = None

    if "email" in fields and data.email is not None:
        address = auth_service.normalize_email(str(data.email))
        if address != user.email:
            await _authorize_email_change(user, data, current_session_id)
            existing = auth_service.get_by_email(db, address)
            if existing is not None and existing.id != user.id:
                raise ConflictError("email already registered")
            pending_address = address
            user.pending_email = address
            user.pending_email_requested_at = datetime.now(timezone.utc)

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

    if pending_address is not None:
        old_email = user.email
        await auth_service.issue_email_change_verification(db, user, pending_address)
        auth_service.send_email_change_notice_to_old(
            old_email, pending_address, user.pending_email_requested_at or datetime.now(timezone.utc)
        )
        logger.info(
            "email change requested: user_id=%s old=%s new=%s",
            user.id,
            auth_service.mask_email(old_email),
            auth_service.mask_email(pending_address),
        )
    return user


# --- password ---------------------------------------------------------------


async def change_password(
    db: Session, user: User, data: PasswordChange, *, keep_session_id: str | None
) -> int:
    """Verify the current password, store the new hash, revoke every other session.

    Any account with a local password (email or Google-with-password) may
    change it; passwordless OAuth accounts get 403 (never 422, so the UI can
    hide the section and the API stays honest).
    """
    if not user.has_password:
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
    emit("password.changed", user_id=str(user.id), sessions_revoked=revoked)
    return revoked


def set_initial_password(db: Session, user: User, data: PasswordSet) -> None:
    """Set the first password on a passwordless (OAuth-only) account.

    409 when a password already exists (use change-password instead).
    Single write path via auth `set_password` (strength policy + hash +
    has_password mirror). Audit log carries user_id only, never the password.
    """
    if user.has_password:
        raise ConflictError("password already set; use change-password instead")
    auth_service.set_password(user, data.password)
    db.commit()
    db.refresh(user)
    logger.info("initial password set for user %s", user.id)
    emit("password.set", user_id=str(user.id))


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
    emit("session.revoked", user_id=str(user_id))


async def revoke_other_sessions(user_id: uuid.UUID, current_session_id: str | None) -> int:
    return await security.revoke_other_sessions(user_id, current_session_id or "")


# --- account deletion ---------------------------------------------------------


async def request_account_deletion(
    db: Session, user: User, data: AccountDeleteRequest, *, current_session_id: str | None = None
) -> AccountDeletionStatus:
    """Schedule the account for hard purge after the fixed grace period.

    Verified-only. A re-request while pending is an idempotent 200 (no
    re-auth, no side effects) so pending accounts can poll status. Otherwise
    fresh re-auth, stamp requested/scheduled (+15d) with stage 1, revoke
    every other session (caller keeps theirs, like change-password),
    soft-delete + invalidate every API key immediately, and mail the notice.
    Audit log carries user_id only.
    """
    if not user.email_verified:
        raise EmailVerificationRequiredError("email verification required")
    if user.deletion_scheduled_for is not None:
        return AccountDeletionStatus(
            scheduled_for=user.deletion_scheduled_for, days_remaining=DELETION_GRACE_DAYS
        )
    await security.require_fresh_confirmation(user, data.current_password, current_session_id)
    now = datetime.now(timezone.utc)
    user.deletion_requested_at = now
    user.deletion_scheduled_for = now + timedelta(days=DELETION_GRACE_DAYS)
    user.deletion_notice_stage = 1
    db.commit()
    await security.revoke_other_sessions(user.id, current_session_id or "")
    for key in keys_service.list_keys(db, user.id):
        keys_service.delete_key(db, key.id, user.id)
    send_account_deletion_requested(
        user.email, user.deletion_scheduled_for.astimezone(timezone.utc).isoformat()
    )
    logger.info("account deletion requested: user_id=%s", user.id)
    emit("account.deletion_requested", user_id=str(user.id))
    return AccountDeletionStatus(
        scheduled_for=user.deletion_scheduled_for, days_remaining=DELETION_GRACE_DAYS
    )
