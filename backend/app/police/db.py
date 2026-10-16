"""police.db: the police system's own store. Only app.police touches it."""

from datetime import datetime

from sqlalchemy import Integer, String, Text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings
from app.db import TZDateTime, make_engine, utcnow

STATUSES = ("NEW", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "REJECTED")


class PoliceBase(DeclarativeBase):
    pass


class Complaint(PoliceBase):
    __tablename__ = "complaints"
    police_ref: Mapped[str] = mapped_column(String, primary_key=True)
    public_ref: Mapped[str] = mapped_column(String, unique=True)
    received_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String, default="NEW")
    full_text_enc: Mapped[str] = mapped_column(Text)
    complainant_name_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    complainant_contact_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    complainant_address_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    accused_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    harassment_type: Mapped[str | None] = mapped_column(String, nullable=True)
    last_updated: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class StatusHistory(PoliceBase):
    __tablename__ = "status_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    police_ref: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String)
    changed_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


_engine: AsyncEngine | None = None
_sm: async_sessionmaker[AsyncSession] | None = None


async def init_police_db() -> None:
    global _engine, _sm
    s = get_settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    _engine = make_engine(s.police_db_url)
    _sm = async_sessionmaker(_engine, expire_on_commit=False)
    async with _engine.begin() as conn:
        await conn.run_sync(PoliceBase.metadata.create_all)


async def close_police_db() -> None:
    global _engine, _sm
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sm = None


def PoliceSession() -> AsyncSession:
    if _sm is None:
        raise RuntimeError("police database not initialised")
    return _sm()
