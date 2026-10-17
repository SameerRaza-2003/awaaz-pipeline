from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT / ".env", ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    outbound_mode: Literal["dry_run", "sandbox", "live"] = "dry_run"
    outbound_allowlist: str = ""
    alert_authorities: bool = False
    authority_number: str = ""
    news_agency_email: str = ""  # when set, news escalation goes to this inbox instead of the seeded agencies
    authority_email: str = ""  # demo authority inbox for the social-media-post version; falls back to the reply-to / SMTP address
    default_trusted_contact: str = ""
    default_discord_webhook: str = ""  # used when a session has not set its own trusted contact webhook

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    model_default: str = "deepseek/deepseek-v4-flash"
    model_drafting: str = ""
    embedding_provider: Literal["openrouter", "fastembed", "hash"] = "openrouter"
    embedding_model: str = "baai/bge-m3"
    match_threshold: float = 0.50
    match_margin: float = 0.05  # also keep only communities within this distance of the best score (0 = off)
    match_threshold_hash: float = 0.2  # the offline hashing embedder scores lower
    match_top_k: int = 5
    privacy_llm_review: bool = True  # LLM identifier extraction + second-read review on top of the scanner

    call_provider: Literal["twilio", "macrodroid"] = "twilio"
    sms_provider: Literal["twilio", "macrodroid"] = "twilio"
    # MacroDroid on a spare Android phone places the call. Either the device link + trigger identifier,
    # or the full trigger URL in macrodroid_call_url.
    macrodroid_url: str = ""  # https://trigger.macrodroid.com/<device-id>/
    macrodroid_call_id: str = "awaaz_call"
    macrodroid_call_url: str = ""
    macrodroid_sms_id: str = "awaaz_sms"

    @property
    def macrodroid_sms_endpoint(self) -> str:
        if self.macrodroid_url.strip() and self.macrodroid_sms_id.strip():
            return self.macrodroid_url.strip().rstrip("/") + "/" + self.macrodroid_sms_id.strip().strip("/")
        return ""

    @property
    def macrodroid_call_endpoint(self) -> str:
        if self.macrodroid_call_url.strip():
            return self.macrodroid_call_url.strip()
        if self.macrodroid_url.strip() and self.macrodroid_call_id.strip():
            return self.macrodroid_url.strip().rstrip("/") + "/" + self.macrodroid_call_id.strip().strip("/")
        return ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    google_maps_api_key: str = ""
    geocoder: Literal["nominatim", "google"] = "nominatim"
    nominatim_email: str = ""  # sent in the User-Agent, as the OpenStreetMap usage policy asks

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_app_password: str = ""
    email_from_name: str = "Awaaz"
    email_reply_to: str = ""

    escalation_delay_seconds: int = 86400
    addressed_statuses: str = "IN_PROGRESS,RESOLVED,REJECTED"
    agent_timeout_s: float = 45
    agent_max_retries: int = 2
    tracking_interval_s: int = 120
    tracking_max_updates: int = 10
    purge_transcript: bool = True
    scheduler_poll_s: float = 30

    data_encryption_key: str = ""
    police_service_key: str = "dev-police-service-key"
    police_demo_user: str = "officer"
    police_demo_password: str = "awaaz-demo"
    enable_demo_routes: bool = True
    default_country: str = "PK"
    seed_email_base: str = ""
    police_api_url: str = ""  # empty = call the in-process police service over ASGI

    data_dir: Path = ROOT / "backend" / "data"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @field_validator("model_drafting")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def drafting_model(self) -> str:
        return self.model_drafting or self.model_default

    @property
    def allowlist(self) -> set[str]:
        listed = {normalize_recipient(x) for x in self.outbound_allowlist.split(",") if x.strip()}
        extra = {self.authority_recipient} if self.authority_recipient else set()
        if self.news_agency_email.strip():
            extra.add(normalize_recipient(self.news_agency_email))
        return listed | extra

    @property
    def authority_recipient(self) -> str:
        addr = self.authority_email or self.email_reply_to or self.smtp_user
        return normalize_recipient(addr) if addr else ""

    @property
    def addressed_set(self) -> set[str]:
        return {s.strip().upper() for s in self.addressed_statuses.split(",") if s.strip()}

    @property
    def awaaz_db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.data_dir / 'awaaz.db'}"

    @property
    def police_db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.data_dir / 'police.db'}"


def normalize_phone(value: str, country: str | None = None) -> str | None:
    """Any common way of writing a number (03120051793, 0092 312..., +92 312...) -> E.164, using the
    person's country for local formats. None if it is not a valid number."""
    import phonenumbers

    region = (country or get_settings().default_country or "PK").upper()
    try:
        n = phonenumbers.parse(value.strip(), region)
    except phonenumbers.NumberParseException:
        return None
    return phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164) if phonenumbers.is_valid_number(n) else None


def normalize_recipient(value: str, country: str | None = None) -> str:
    value = value.strip()
    if value.lower().startswith("discord:"):
        return "discord:" + value.split(":", 1)[1].strip()
    if "@" in value:
        return value.lower()
    phone = normalize_phone(value, country)
    if phone:
        return phone
    digits = "".join(c for c in value if c.isdigit())
    return ("+" + digits) if digits else value


@lru_cache
def get_settings() -> Settings:
    return Settings()
