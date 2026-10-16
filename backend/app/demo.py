from sqlalchemy import delete

from app.db import (
    AgentRun,
    DispatchLog,
    Emergency,
    EscalationJob,
    EventRow,
    PublicReport,
    SessionLocal,
    SessionRow,
    TrustedContact,
)
from app.police.db import Complaint, PoliceSession, StatusHistory
from app.seed import seed


async def reset_all() -> dict:
    async with SessionLocal() as db:
        for model in (EventRow, AgentRun, DispatchLog, EscalationJob, PublicReport, Emergency, TrustedContact, SessionRow):
            await db.execute(delete(model))
        await db.commit()
    async with PoliceSession() as db:
        await db.execute(delete(StatusHistory))
        await db.execute(delete(Complaint))
        await db.commit()
    return {"reset": True, **(await seed(reset=True))}


async def _main() -> None:
    from app.db import init_db
    from app.police.db import init_police_db

    await init_db()
    await init_police_db()
    print(await reset_all())


if __name__ == "__main__":
    import asyncio

    asyncio.run(_main())
