ALGORITHM = "fernet"
"""Fernet credential encryption. Key derived from SECRET_KEY (env only)."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from tollms.core.config import get_settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(get_settings().secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise ValueError("cannot decrypt credentials") from e


def mask(value: str) -> str:
    """Show only the last 4 chars: ****abcd."""
    if len(value) <= 4:
        return "****"
    return "****" + value[-4:]
