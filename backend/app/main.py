import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app import db, llm
from app.api import report as report_api
from app.api import sessions as sessions_api
from app.config import get_settings
from app.police import db as police_db
from app.police.routes import router as police_router
from app.workflows import escalation


async def _seed_if_empty() -> None:
    from app.seed import seed

    async with db.SessionLocal() as s:
        count = await s.scalar(select(func.count()).select_from(db.Community))
    if not count:
        await seed()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await police_db.init_police_db()
    if get_settings().openrouter_api_key:
        await llm.load_pricing()
    await _seed_if_empty()
    stop = asyncio.Event()
    scheduler = asyncio.create_task(escalation.scheduler_loop(stop))
    yield
    stop.set()
    escalation.wake()
    scheduler.cancel()
    await police_db.close_police_db()
    await db.close_db()


def create_app(with_lifespan: bool = True) -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Awaaz", lifespan=lifespan if with_lifespan else None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in s.cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(sessions_api.router)
    app.include_router(report_api.router)
    app.include_router(report_api.demo_router())
    app.include_router(police_router)

    @app.get("/healthz")
    async def healthz():
        s = get_settings()
        return {
            "ok": True,
            "outbound_mode": s.outbound_mode,
            "alert_authorities": s.alert_authorities,
            "llm_configured": bool(s.openrouter_api_key),
            "model_default": s.model_default,
            "model_drafting": s.drafting_model,
            "demo_routes": s.enable_demo_routes,
            "escalation_delay_seconds": s.escalation_delay_seconds,
            "match_threshold": s.match_threshold,
        }

    @app.get("/api/costs")
    async def costs():
        async with db.SessionLocal() as s:
            row = (
                await s.execute(
                    select(
                        func.count(db.AgentRun.id),
                        func.coalesce(func.sum(db.AgentRun.tokens_in), 0),
                        func.coalesce(func.sum(db.AgentRun.tokens_out), 0),
                        func.coalesce(func.sum(db.AgentRun.cost_usd), 0.0),
                    )
                )
            ).one()
        return {"runs": row[0], "tokens_in": row[1], "tokens_out": row[2], "cost_usd": round(row[3], 6)}

    return app


app = create_app()
