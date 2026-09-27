"""Authentication primitives: argon2 passwords, HS256 JWTs, Valkey sessions.

Token model: access (15m) + refresh (30d, rotating with `jti`) both carry
`sid` (session id). Sessions live in Valkey (`session:{sid}`, absolute-lifetime
TTL); logout deletes the session, which invalidates both tokens.
Refresh rotation: every refresh mints a new `jti`, stores it on the session
record, and invalidates the presented one. A stale `jti` (or any use of an
unexpired refresh for an unknown session) revokes the whole family.
`get_current_user` accepts Bearer or the `access_token` httpOnly cookie.
"""

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from tollms.core.config import get_settings
from tollms.core.deps import get_db
from tollms.core.exceptions import ValidationError
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager

if TYPE_CHECKING:
    from tollms.models.user import User

logger = logging.getLogger(__name__)

_ph = PasswordHasher()

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
SESSION_COOKIE = "tollma_session"  # non-sensitive presence marker for middleware


def hash_password(password: str) -> str:
    return _ph.hash(password)


# --- password policy ---------------------------------------------------------

PASSWORD_MIN_LENGTH = 8


def validate_password_strength(password: str) -> None:
    """Enforce the account policy: 8+ chars with upper, lower and a digit.

    Applied on signup, change-password and reset-password so every way of
    setting a local password shares one contract.
    """
    problems: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"at least {PASSWORD_MIN_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        problems.append("an uppercase letter")
    if not re.search(r"[a-z]", password):
        problems.append("a lowercase letter")
    if not re.search(r"\d", password):
        problems.append("a number")
    if problems:
        raise ValidationError("Password must contain " + ", ".join(problems) + ".")


def hash_reset_token(token: str) -> str:
    """Reset tokens are stored as sha256 only — never in plaintext."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        logger.exception("password verification crashed")
        return False


def _encode(payload: dict) -> str:
    settings = get_settings()
    return jwt.encode(payload, settings.jwt_signing_key, algorithm=settings.jwt_algorithm)


def _decode(token: str) -> dict | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_signing_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        logger.info("jwt expired")
        return None
    except jwt.InvalidTokenError:
        logger.info("jwt invalid")
        return None


def decode_token(token: str) -> dict | None:
    """Public JWT decode for auth flows (refresh, verification)."""
    return _decode(token)


def create_access_token(user_id: uuid.UUID, email: str, session_id: str) -> str:
    now = datetime.now(timezone.utc)
    return _encode(
        {
            "sub": str(user_id),
            "email": email,
            "sid": session_id,
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=get_settings().access_token_minutes)).timestamp()),
        }
    )


def create_refresh_token(user_id: uuid.UUID, session_id: str, jti: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    return _encode(
        {
            "sub": str(user_id),
            "sid": session_id,
            "type": "refresh",
            "jti": jti or uuid.uuid4().hex,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=get_settings().refresh_token_days)).timestamp()),
        }
    )


def generate_refresh_jti() -> str:
    """New refresh-token id for rotation and initial issuance."""
    return uuid.uuid4().hex


def create_verification_token(user_id: uuid.UUID, email: str) -> str:
    now = datetime.now(timezone.utc)
    return _encode(
        {
            "sub": str(user_id),
            "email": email,
            "type": "verify_email",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=get_settings().verification_token_hours)).timestamp()),
        }
    )


_ACTIVITY_TOUCH_INTERVAL = 60  # seconds; keeps last_seen fresh without a Valkey write per request


def client_meta(request: Request) -> dict[str, str]:
    """Coarse device metadata for the session-management UI. Never trusted for auth."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = (forwarded.split(",")[0].strip() if forwarded else "") or (
        request.client.host if request.client else ""
    )
    return {"user_agent": request.headers.get("user-agent", "")[:512], "ip": ip[:64]}


def _session_ttl_seconds() -> int:
    """Valkey TTL bounds the whole rotation chain (absolute lifetime)."""
    return max(1, get_settings().session_absolute_lifetime_days) * 86400


def _parse_session_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _mask_session_email(email: str) -> str:
    """Masked email for audit logs (mirrors auth service; avoids a cycle)."""
    local, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    if len(local) <= 2:
        return f"{local[:1]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _mask_session_ip(ip: str) -> str:
    """Masked IP for audit logs: last IPv4 octet hidden, all else redacted."""
    text = (ip or "").strip()
    if not text:
        return "unknown"
    if "." in text:
        head, _, _ = text.rpartition(".")
        return f"{head}.***" if head else "***"
    return "***"


def _session_last_active(session: dict) -> datetime | None:
    return _parse_session_time(session.get("last_active")) or _parse_session_time(
        session.get("last_seen")
    )


def session_absolute_expired(session: dict) -> bool:
    """True past the absolute lifetime. Legacy records without created_at pass."""
    created = _parse_session_time(session.get("created_at"))
    if created is None:
        return False
    lifetime = max(1, get_settings().session_absolute_lifetime_days) * 86400
    return (datetime.now(timezone.utc) - created).total_seconds() >= lifetime


def session_idle_expired(session: dict) -> bool:
    """True past the idle timeout. Legacy records without activity pass."""
    last_active = _session_last_active(session)
    if last_active is None:
        return False
    idle = max(1, get_settings().session_idle_timeout_hours) * 3600
    return (datetime.now(timezone.utc) - last_active).total_seconds() >= idle


def session_bounds_error(session: dict) -> str | None:
    """'absolute' | 'idle' | None. Single check for get_current_user + refresh."""
    if session_absolute_expired(session):
        return "absolute"
    if session_idle_expired(session):
        return "idle"
    return None


def _remaining_session_ttl(session: dict) -> int:
    """Remaining absolute lifetime for Valkey TTL (floored so keys die promptly)."""
    created = _parse_session_time(session.get("created_at"))
    if created is None:
        return _session_ttl_seconds()
    age = (datetime.now(timezone.utc) - created).total_seconds()
    return max(60, int(_session_ttl_seconds() - age)) if age < _session_ttl_seconds() else 60


async def create_session(
    user_id: uuid.UUID,
    email: str,
    login_method: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
    refresh_jti: str | None = None,
) -> str:
    """Persist a Valkey session; returns the session id embedded in both tokens.

    Fail-closed: raises 503 when Valkey cannot persist (sessions require it).
    `refresh_jti` lets callers mint the first refresh token without an extra
    read; when omitted one is generated internally. Beyond the per-user cap
    the oldest sessions are destroyed.
    """
    from tollms.core.exceptions import ServiceUnavailableError

    session_id = uuid.uuid4().hex
    jti = refresh_jti or uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "user_id": str(user_id),
        "email": email,
        "login_method": login_method,
        "user_agent": user_agent or "",
        "ip": ip or "",
        "created_at": now,
        "last_seen": now,
        "last_active": now,
        "refresh_jti": jti,
    }
    manager = get_manager()
    stored = await manager.set(cache_keys.session(session_id), record, ttl=_session_ttl_seconds())
    if not stored:
        logger.error("session store unavailable, denying login: user_id=%s", user_id)
        raise ServiceUnavailableError("authentication temporarily unavailable")
    added = await manager.sadd(cache_keys.user_sessions(user_id), session_id)
    if not added:
        # Fresh sid cannot already be a member: 0 means the index write failed.
        await manager.delete(cache_keys.session(session_id))
        logger.error("session index unavailable, denying login: user_id=%s", user_id)
        raise ServiceUnavailableError("authentication temporarily unavailable")
    await manager.expire(cache_keys.user_sessions(user_id), _session_ttl_seconds() + 60)
    await enforce_session_cap(user_id, keep_session_id=session_id)
    logger.info(
        "new session: user_id=%s method=%s email=%s ip=%s",
        user_id, login_method, _mask_session_email(email), _mask_session_ip(ip or ""),
    )
    return session_id


async def get_session(session_id: str) -> dict | None:
    value = await get_manager().get(cache_keys.session(session_id))
    return value if isinstance(value, dict) else None


async def list_session_records(user_id: uuid.UUID, current_session_id: str | None = None) -> list[dict]:
    """Live sessions for one user, newest activity first. Prunes dead ids.

    `current_session_id` is computed by callers; not part of the cached value.
    """
    manager = get_manager()
    index = cache_keys.user_sessions(user_id)
    session_ids = await manager.smembers(index)
    if not session_ids:
        return []
    records: list[dict] = []
    values = await manager.mget([cache_keys.session(sid) for sid in sorted(session_ids)])
    stale: list[str] = []
    for sid, value in zip(sorted(session_ids), values):
        if not isinstance(value, dict):
            stale.append(sid)
            continue
        records.append({"session_id": sid, "current": sid == current_session_id, **value})
    if stale:
        await manager.srem(index, *stale)
    records.sort(
        key=lambda r: str(r.get("last_active", r.get("last_seen", ""))), reverse=True
    )
    return records


async def revoke_all_user_sessions(user_id: uuid.UUID) -> int:
    """Destroy every live session for one user (reuse detection)."""
    manager = get_manager()
    index = cache_keys.user_sessions(user_id)
    session_ids = await manager.smembers(index)
    revoked = 0
    for sid in session_ids:
        await manager.delete(cache_keys.session(sid))
        await manager.srem(index, sid)
        revoked += 1
    return revoked


async def enforce_session_cap(user_id: uuid.UUID, keep_session_id: str | None = None) -> int:
    """Destroy oldest sessions beyond the per-user cap. Returns evicted count."""
    max_sessions = max(1, get_settings().session_max_per_user)
    records = await list_session_records(user_id, keep_session_id)
    if len(records) <= max_sessions:
        return 0

    def _age_key(record: dict) -> tuple[str, str]:
        return (
            str(record.get("created_at", "")),
            str(record.get("last_active", record.get("last_seen", ""))),
        )

    newest_first = sorted(records, key=_age_key, reverse=True)
    keep = {str(r["session_id"]) for r in newest_first[:max_sessions]}
    if keep_session_id is not None:
        keep.add(keep_session_id)
        while len(keep) > max_sessions:
            # Keep set overflowed (keep was not among newest): evict the
            # oldest kept entry that is not the protected one.
            for candidate in sorted(
                (r for r in newest_first if str(r["session_id"]) in keep
                 and str(r["session_id"]) != keep_session_id),
                key=_age_key,
            ):
                keep.discard(str(candidate["session_id"]))
                break
            else:
                break
    evicted = 0
    for record in records:
        sid = str(record["session_id"])
        if sid not in keep:
            await destroy_session(sid)
            evicted += 1
    if evicted:
        logger.info("session cap enforced: user_id=%s evicted=%d", user_id, evicted)
    return evicted


async def rotate_session_refresh(session_id: str, session: dict) -> str:
    """Store a fresh refresh jti + activity; returns the new jti for minting."""
    from tollms.core.exceptions import ServiceUnavailableError

    new_jti = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    session["refresh_jti"] = new_jti
    session["last_seen"] = now
    session["last_active"] = now
    stored = await get_manager().set(
        cache_keys.session(session_id), session, ttl=_remaining_session_ttl(session)
    )
    if not stored:
        logger.error("session rotation store failed, denying refresh")
        raise ServiceUnavailableError("authentication temporarily unavailable")
    return new_jti


async def revoke_other_sessions(user_id: uuid.UUID, keep_session_id: str) -> int:
    """Destroy every live session except the caller's. Returns the count revoked."""
    manager = get_manager()
    session_ids = await manager.smembers(cache_keys.user_sessions(user_id))
    revoked = 0
    for sid in session_ids:
        if sid == keep_session_id:
            continue
        await manager.delete(cache_keys.session(sid))
        await manager.srem(cache_keys.user_sessions(user_id), sid)
        revoked += 1
    return revoked


async def touch_session(session_id: str) -> None:
    manager = get_manager()
    key = cache_keys.session(session_id)
    session = await manager.get(key)
    if isinstance(session, dict):
        now = datetime.now(timezone.utc).isoformat()
        session["last_seen"] = now
        session["last_active"] = now
        await manager.set(key, session, ttl=_remaining_session_ttl(session))


async def touch_session_throttled(session_id: str, session: dict) -> None:
    """Activity write-behind: refresh last_seen at most once per interval."""
    last_seen = session.get("last_active", session.get("last_seen"))
    if isinstance(last_seen, str):
        try:
            moment = datetime.fromisoformat(last_seen)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - moment).total_seconds() < _ACTIVITY_TOUCH_INTERVAL:
                return
        except ValueError:
            pass
    await touch_session(session_id)


async def destroy_session(session_id: str) -> None:
    manager = get_manager()
    key = cache_keys.session(session_id)
    session = await manager.get(key)
    if isinstance(session, dict) and session.get("user_id"):
        await manager.srem(cache_keys.user_sessions(str(session["user_id"])), session_id)
    await manager.delete(key)


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
    payload = _decode(token) if token else None
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
    payload = _decode(token)
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


