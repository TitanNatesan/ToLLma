"""Authentication primitives: argon2 passwords, HS256 JWTs, Valkey sessions.

Token model: access (15m) + refresh (30d) both carry `sid` (session id).
Sessions live in Valkey (`session:{sid}`, 30d TTL); logout deletes the
session, which invalidates both tokens. `get_current_user` accepts Bearer
or the `access_token` httpOnly cookie (browser flows).
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from tollms.core.config import get_settings
from tollms.core.deps import get_db
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager

logger = logging.getLogger(__name__)

_ph = PasswordHasher()

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
SESSION_COOKIE = "tollma_session"  # non-sensitive presence marker for middleware


def hash_password(password: str) -> str:
    return _ph.hash(password)


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


def create_refresh_token(user_id: uuid.UUID, session_id: str) -> str:
    now = datetime.now(timezone.utc)
    return _encode(
        {
            "sub": str(user_id),
            "sid": session_id,
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=get_settings().refresh_token_days)).timestamp()),
        }
    )


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


async def create_session(
    user_id: uuid.UUID,
    email: str,
    login_method: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> str:
    """Persist a Valkey session; returns the session id embedded in both tokens."""
    session_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    manager = get_manager()
    await manager.set(
        cache_keys.session(session_id),
        {"user_id": str(user_id), "email": email, "login_method": login_method,
         "user_agent": user_agent or "", "ip": ip or "",
         "created_at": now, "last_seen": now},
        ttl=get_settings().refresh_token_days * 86400,
    )
    index = cache_keys.user_sessions(user_id)
    await manager.sadd(index, session_id)
    await manager.expire(index, get_settings().refresh_token_days * 86400 + 60)
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
    records.sort(key=lambda r: str(r.get("last_seen", "")), reverse=True)
    return records


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
        session["last_seen"] = datetime.now(timezone.utc).isoformat()
        await manager.set(key, session, ttl=get_settings().refresh_token_days * 86400)


async def touch_session_throttled(session_id: str, session: dict) -> None:
    """Activity write-behind: refresh last_seen at most once per interval."""
    last_seen = session.get("last_seen")
    if isinstance(last_seen, str):
        try:
            if (datetime.now(timezone.utc) - datetime.fromisoformat(last_seen)).total_seconds() < _ACTIVITY_TOUCH_INTERVAL:
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
