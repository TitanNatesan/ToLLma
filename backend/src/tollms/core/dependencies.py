"""FastAPI auth dependencies (split from core.security).

`get_current_user` accepts Bearer or the `access_token` httpOnly cookie.
May import sessions + passwords; those modules must never import this one.
"""

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.passwords import ACCESS_COOKIE, decode_token, verify_password
from tollms.core.sessions import (
    _parse_session_time,
    destroy_session,
    get_session,
    session_bounds_error,
    touch_session_throttled,
)

if TYPE_CHECKING:
    from tollms.models.user import User


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(ACCESS_COOKIE)


def get_current_session_id(request: Request) -> str | None:
    """Session id (JWT `sid`) for the current request, if the token carries one.

    Cheap: relies on `get_current_user` having validated the session already.
    """
    token = _token_from_request(request)
    payload = decode_token(token) if token else None
    if payload is None or payload.get("type") != "access":
        return None
    sid = payload.get("sid")
    return str(sid) if sid else None


async def get_current_user(request: Request, db: Session = Depends(get_db)):
    """Authenticated user or 401. Verifies JWT + live Valkey session + active PG user."""
    from tollms.core.exceptions import AuthenticationError
    from tollms.models.user import User

    token = _token_from_request(request)
    if not token:
        raise AuthenticationError("not authenticated")
    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        raise AuthenticationError("invalid or expired token")
    sid = str(payload.get("sid", ""))
    session = await get_session(sid)
    if session is None:
        raise AuthenticationError("session expired")
    if session_bounds_error(session) is not None:
        # Absolute lifetime or idle timeout: force re-login, never extend.
        await destroy_session(sid)
        raise AuthenticationError("session expired")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        raise AuthenticationError("invalid token subject") from None
    user = db.get(User, user_id)
    if user is None or user.is_deleted or not user.is_active:
        raise AuthenticationError("account unavailable")
    # Session-activity write-behind: keeps "last seen" useful for the sessions
    # UI without a Valkey write on every request.
    await touch_session_throttled(sid, session)
    return user


async def require_verified_user(request: Request, db: Session = Depends(get_db)) -> "User":
    """Authenticated + email-verified user or 403 EMAIL_VERIFICATION_REQUIRED.

    Google-verified accounts (email_verified=True) pass through. Used by
    feature routers; auth session endpoints stay on `get_current_user` so
    unverified users can verify, resend, refresh and logout.
    """
    from tollms.core.exceptions import EmailVerificationRequiredError
    from tollms.models.user import User

    user: User = await get_current_user(request, db)
    if not user.email_verified:
        raise EmailVerificationRequiredError("email verification required")
    return user


async def require_active_user(request: Request, db: Session = Depends(get_db)) -> "User":
    """Verified user whose account is NOT pending deletion.

    Feature-router gate: verified + deletion_scheduled_for unset, otherwise
    403 ACCOUNT_PENDING_DELETION. Delete-request (idempotent re-request) and
    restore stay on `get_current_user` so pending accounts can reach them.
    """
    from tollms.core.exceptions import AccountPendingDeletionError

    user = await require_verified_user(request, db)
    if user.deletion_scheduled_for is not None:
        raise AccountPendingDeletionError("Account scheduled for deletion.")
    return user


# Passwordless accounts confirm a destructive action with a fresh Google
# login: the caller's session must be google-method and recent.
_RECENT_GOOGLE_SESSION_SECONDS = 15 * 60


async def require_fresh_confirmation(
    user: "User", current_password: str | None, session_id: str | None
) -> None:
    """Fail-closed re-auth for destructive account actions (delete-request,
    restore). Shared single path so both endpoints enforce identical proof.

    Local-with-password accounts prove with `current_password` (missing ->
    422, wrong -> 401). Passwordless accounts (Google / OAuth-only) must hold
    a google-method session created within 15 minutes, otherwise 403.
    """
    from tollms.core.exceptions import (
        AuthenticationError,
        ForbiddenError,
        ValidationError,
    )

    if user.has_password and user.password_hash:
        if not current_password:
            raise ValidationError("current password is required")
        if not verify_password(current_password, user.password_hash):
            raise AuthenticationError("current password is incorrect")
        return
    if not session_id:
        raise ForbiddenError("recent Google sign-in required")
    session = await get_session(session_id)
    if session is None or session.get("user_id") != str(user.id):
        raise ForbiddenError("recent Google sign-in required")
    if str(session.get("login_method", "")) != "google":
        raise ForbiddenError("recent Google sign-in required")
    created = _parse_session_time(session.get("created_at"))
    if created is None:
        raise ForbiddenError("recent Google sign-in required")
    age = (datetime.now(timezone.utc) - created).total_seconds()
    if age < 0 or age > _RECENT_GOOGLE_SESSION_SECONDS:
        raise ForbiddenError("recent Google sign-in required")


async def platform_admin_required(user=Depends(require_verified_user)):
    """Platform admin gate for /api/admin/*. 403 for regular accounts.

    Reads the platform-level role only — organization/RBAC roles will live on
    memberships and must not widen this gate.
    """
    from tollms.core.exceptions import ForbiddenError
    from tollms.models.user import PlatformRole

    if user.platform_role != PlatformRole.PLATFORM_ADMIN:
        raise ForbiddenError("platform administrator access required")
    return user
