"""Password hashing/strength + JWT mint/validate (split from core.security)."""

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from tollms.core.config import get_settings
from tollms.core.exceptions import ValidationError

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
