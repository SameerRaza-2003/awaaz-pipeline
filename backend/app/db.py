from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.types import TypeDecorator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class TZDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    locale: Mapped[str] = mapped_column(String, default="en")
    country: Mapped[str] = mapped_column(String, default="PK")
    phase: Mapped[str] = mapped_column(String, default="gate")
    # Encrypted working state for the live session: transcript, slots, drafts.
    intake_json_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)  # set when she is signed in


class UserRow(Base):
    """Optional survivor account: a username and password only, no email or real name."""

    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    # Encrypted: display name, trusted contact (name, phone, Discord webhook), country, language.
    profile_enc: Mapped[str | None] = mapped_column(Text, nullable=True)


class TrustedContact(Base):
    __tablename__ = "trusted_contacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    discord_webhook_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class Community(Base):
    __tablename__ = "communities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    email: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    countries: Mapped[str] = mapped_column(String, default="GLOBAL")  # comma separated, or GLOBAL
    embedding_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class NewsAgency(Base):
    __tablename__ = "news_agencies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    email: Mapped[str] = mapped_column(String)
    country: Mapped[str] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class PublicReport(Base):
    __tablename__ = "public_reports"
    public_ref: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    police_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str] = mapped_column(String)
    public_text: Mapped[str] = mapped_column(Text)
    public_clean: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    escalation_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)


class DispatchLog(Base):
    __tablename__ = "dispatch_log"
    __table_args__ = (UniqueConstraint("public_ref", "kind", "recipient", name="uq_dispatch"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_ref: Mapped[str] = mapped_column(String, index=True)  # or emergency key for sms/call
    kind: Mapped[str] = mapped_column(String)  # community_email|news_email|sms|call
    recipient: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)  # pending|sent|dry_run|blocked|failed
    provider_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class EscalationJob(Base):
    __tablename__ = "escalation_jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_ref: Mapped[str] = mapped_column(String, unique=True)
    due_at: Mapped[datetime] = mapped_column(TZDateTime, index=True)
    state: Mapped[str] = mapped_column(String, default="pending")  # pending|running|done|cancelled
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class Emergency(Base):
    __tablename__ = "emergencies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    started_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_location_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    location_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_update_sent_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    updates_sent: Mapped[int] = mapped_column(Integer, default=0)


class EventRow(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    ts: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String)
    agent: Mapped[str | None] = mapped_column(String, nullable=True)
    node: Mapped[str | None] = mapped_column(String, nullable=True)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    data_json: Mapped[str] = mapped_column(Text, default="{}")


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    agent: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="running")
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    started_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def make_engine(url: str) -> AsyncEngine:
    engine = create_async_engine(url, future=True)
    event.listen(engine.sync_engine, "connect", _sqlite_pragmas)
    return engine


async def init_db() -> None:
    global _engine, _sessionmaker
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    _engine = make_engine(settings.awaaz_db_url)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


def _add_missing_columns(conn) -> None:
    """Tiny forward-only migration: add columns introduced after a database was created."""
    from sqlalchemy import inspect

    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                ddl = col.type.compile(dialect=conn.dialect)
                conn.exec_driver_sql(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}")


async def close_db() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def SessionLocal() -> AsyncSession:
    if _sessionmaker is None:
        raise RuntimeError("database not initialised")
    return _sessionmaker()


def engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("database not initialised")
    return _engine
