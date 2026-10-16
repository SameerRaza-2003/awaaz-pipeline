from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db, llm
from app.api import sessions as sessions_api
from app.config import get_settings
from app.police import db as police_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await police_db.init_police_db()
    if get_settings().openrouter_api_key:
        await llm.load_pricing()
    yield
    await police_db.close_police_db()
    await db.close_db()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Awaaz", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in s.cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(sessions_api.router)

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

    return app


app = create_app()
