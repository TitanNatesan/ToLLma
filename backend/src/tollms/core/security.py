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


async def create_session(user_id: uuid.UUID, email: str, login_method: str) -> str:
    """Persist a Valkey session; returns the session id embedded in both tokens."""
    session_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await get_manager().set(
        cache_keys.session(session_id),
        {"user_id": str(user_id), "email": email, "login_method": login_method,
         "created_at": now, "last_seen": now},
        ttl=get_settings().refresh_token_days * 86400,
    )
    return session_id


async def get_session(session_id: str) -> dict | None:
    value = await get_manager().get(cache_keys.session(session_id))
    return value if isinstance(value, dict) else None


async def touch_session(session_id: str) -> None:
    manager = get_manager()
    key = cache_keys.session(session_id)
    session = await manager.get(key)
    if isinstance(session, dict):
        session["last_seen"] = datetime.now(timezone.utc).isoformat()
        await manager.set(key, session, ttl=get_settings().refresh_token_days * 86400)


async def destroy_session(session_id: str) -> None:
    await get_manager().delete(cache_keys.session(session_id))


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(ACCESS_COOKIE)


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
    session = await get_session(str(payload.get("sid", "")))
    if session is None:
        raise AuthenticationError("session expired")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        raise AuthenticationError("invalid token subject") from None
    user = db.get(User, user_id)
    if user is None or user.is_deleted or not user.is_active:
        raise AuthenticationError("account unavailable")
    return user
