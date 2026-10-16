from app import crypto
from app.config import get_settings


def test_fernet_round_trip():
    token = crypto.encrypt("Ayesha Siddiqui, +923001234567")
    assert "Ayesha" not in token
    assert crypto.decrypt(token) == "Ayesha Siddiqui, +923001234567"
    assert crypto.decrypt_json(crypto.encrypt_json({"a": [1, "ب"]})) == {"a": [1, "ب"]}


def test_wrong_key_cannot_decrypt(monkeypatch):
    token = crypto.encrypt("secret")
    monkeypatch.setenv("DATA_ENCRYPTION_KEY", "a-different-passphrase")
    get_settings.cache_clear()
    crypto.reset()
    assert crypto.decrypt(token) is None
