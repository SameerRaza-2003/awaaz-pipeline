from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.sse import event_stream, parse_last_id
from app.events import POLICE_STREAM
from app.police import service
from app.police.db import STATUSES

router = APIRouter(prefix="/api/police", tags=["police"])


class LoginIn(BaseModel):
    username: str
    password: str


class StatusIn(BaseModel):
    status: str
    note: str | None = Field(default=None, max_length=1000)


def officer(authorization: str | None = Header(default=None)) -> str:
    token = authorization.removeprefix("Bearer ").strip() if authorization else None
    user = service.verify_token(token)
    if not user:
        raise HTTPException(401, "police login required")
    return user


def service_caller(x_service_key: str | None = Header(default=None)) -> None:
    if not service.check_service_key(x_service_key):
        raise HTTPException(401, "invalid service key")


@router.post("/login")
async def login(body: LoginIn):
    if not service.check_login(body.username, body.password):
        raise HTTPException(401, "invalid credentials")
    return {"token": service.issue_token(body.username), "username": body.username}


@router.post("/intake", dependencies=[Depends(service_caller)])
async def intake(body: service.ComplaintIn):
    c = await service.intake(body)
    return {"police_ref": c.police_ref, "received_at": c.received_at.isoformat()}


@router.get("/complaints/{police_ref}/status", dependencies=[Depends(service_caller)])
async def complaint_status(police_ref: str):
    c = await service.get_complaint(police_ref)
    if c is None:
        raise HTTPException(404, "not found")
    return {"police_ref": c.police_ref, "status": c.status, "last_updated": c.last_updated.isoformat()}


@router.get("/complaints")
async def list_complaints(user: str = Depends(officer)):
    from app.workflows.escalation import escalation_info

    rows = await service.list_complaints()
    info = await escalation_info([r.public_ref for r in rows])
    return {
        "statuses": STATUSES,
        "complaints": [{**service.summary(r), **info.get(r.public_ref, {})} for r in rows],
    }


@router.get("/complaints/{police_ref}")
async def get_complaint(police_ref: str, user: str = Depends(officer)):
    from app.workflows.escalation import escalation_info

    d = await service.detail(police_ref)
    if d is None:
        raise HTTPException(404, "not found")
    info = await escalation_info([d["public_ref"]])
    return {**d, **info.get(d["public_ref"], {})}


@router.patch("/complaints/{police_ref}/status")
async def patch_status(police_ref: str, body: StatusIn, user: str = Depends(officer)):
    try:
        c = await service.update_status(police_ref, body.status, body.note, user)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if c is None:
        raise HTTPException(404, "not found")
    return service.summary(c)


@router.get("/events")
async def police_events(request: Request, token: str | None = Query(default=None), last_id: int | None = None):
    # EventSource cannot set headers, so the token may come as a query parameter.
    if not service.verify_token(token or request.headers.get("authorization", "").removeprefix("Bearer ").strip()):
        raise HTTPException(401, "police login required")
    return event_stream(request, [POLICE_STREAM], parse_last_id(request, last_id))
