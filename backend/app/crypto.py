import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

_fernet: Fernet | None = None


def _key() -> bytes:
    raw = get_settings().data_encryption_key.strip()
    if raw:
        try:
            Fernet(raw.encode())
            return raw.encode()
        except (ValueError, TypeError):
            pass
        # Accept an arbitrary passphrase by deriving a key from it.
        return base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
    # Development fallback so the app works out of the box. Set DATA_ENCRYPTION_KEY in production.
    return base64.urlsafe_b64encode(hashlib.sha256(b"awaaz-dev-only-key").digest())


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_key())
    return _fernet


def reset() -> None:
    global _fernet
    _fernet = None


def encrypt(value: str | None) -> str | None:
    if value is None:
        return None
    return fernet().encrypt(value.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if token is None:
        return None
    try:
        return fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def encrypt_json(value: Any) -> str:
    return encrypt(json.dumps(value, ensure_ascii=False))  # type: ignore[return-value]


def decrypt_json(token: str | None, default: Any = None) -> Any:
    raw = decrypt(token)
    if raw is None:
        return default
    return json.loads(raw)
