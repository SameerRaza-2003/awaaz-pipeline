"""Gmail Agent: writes and sends outreach emails (modes: communities, news)."""

from pydantic import BaseModel, Field

from app.agents.runner import AgentSpec, RunContext, make_tool
from app.agents.schemas import EmailBatchResult
from app.config import get_settings, normalize_recipient
from app.outbound import guard
from app.tools.pii import Entity, scan

COMMUNITIES_PROMPT = """You are the Gmail Agent of Awaaz in COMMUNITIES mode. You email human-rights activist communities an
anonymised harassment case so they can post about it.

For EACH recipient listed in the data, write one email (one recipient per email, never shared lists):
- Subject: short and neutral, include the public reference.
- Body: a 2-3 sentence introduction of Awaaz and why they are receiving this; then the public description
  VERBATIM (copy it exactly, unchanged, between the lines "--- Case description ---" and "--- End ---");
  then a suggested social-media post (max 280 characters) that adds NO facts beyond the description;
  then "Reply to: {reply_to}"; then an unsubscribe note ("Reply STOP to stop receiving cases").
Call check_email_safety on the body, then send_email. Return EmailBatchResult with what send_email returned.
Never add names, contact details or any facts not in the public description."""

NEWS_PROMPT = """You are the Gmail Agent of Awaaz in NEWS mode. A harassment complaint was filed with the police and no action was
recorded within the deadline. You inform news agencies.

For EACH recipient listed in the data, write one email (one recipient per email):
- Subject: short and neutral, include the public reference.
- Body: a short note that a complaint with public reference {public_ref} was filed with the police on {filed_on},
  and no action was recorded after the deadline; then the public description VERBATIM between the lines
  "--- Case description ---" and "--- End ---"; then the sentence "No personal information about the complainant
  is shared in this message."; then "Reply to: {reply_to}".
Never include any police reference number, names or contact details.
Call check_email_safety on the body, then send_email. Return EmailBatchResult with what send_email returned."""


class BodyArgs(BaseModel):
    body: str


class SendArgs(BaseModel):
    to: str
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=40, max_length=8000)


def _entities(ctx: RunContext) -> list[Entity]:
    return [Entity(**e) if isinstance(e, dict) else e for e in ctx.state.get("entities", [])]


def body_problems(ctx: RunContext, subject: str, body: str) -> list[str]:
    problems = []
    res = scan(f"{subject}\n{body}", _entities(ctx))
    # Our own reply-to address is allowed; anything else personal is not.
    reply_to = ctx.state.get("reply_to", "")
    findings = [f for f in res.findings if not (f["type"] == "email" and f["match"].lower() == reply_to.lower())]
    if findings:
        problems.append(f"pii_scan failed: {findings}")
    if ctx.state["public_text"].strip() not in body:
        problems.append("the public description must appear verbatim in the body")
    police_ref = ctx.state.get("police_ref")
    if police_ref and police_ref in body:
        problems.append("the police reference must never be shared")
    return problems


async def _check(ctx: RunContext, body: str) -> dict:
    probs = body_problems(ctx, "", body)
    return {"safe": not probs, "problems": probs}


async def _send(ctx: RunContext, to: str, subject: str, body: str) -> dict:
    to_n = normalize_recipient(to)
    allowed = {normalize_recipient(r["email"]) for r in ctx.state["recipients"]}
    if to_n not in allowed:
        return {"to": to, "status": "rejected", "error": "not an approved recipient"}
    probs = body_problems(ctx, subject, body)
    if probs:
        return {"to": to, "status": "refused", "error": "; ".join(probs)}
    kind = "community_email" if ctx.state["mode"] == "communities" else "news_email"
    res = await guard.dispatch(
        kind=kind,  # type: ignore[arg-type]
        key=ctx.state["public_ref"],
        recipient=to_n,
        session_id=ctx.session_id,
        payload={"subject": subject, "body": body},
        agent=ctx.agent,
        node=ctx.node,
        run_id=ctx.run_id,
    )
    return {"to": res.to, "status": res.status, "message_id": res.provider_id, "error": res.error}


def _tools(ctx: RunContext):
    return [
        make_tool(ctx, "check_email_safety", "Run pii_scan and content rules over an email body.", BodyArgs, _check),
        make_tool(ctx, "send_email", "Send one email to one approved recipient (outbound guard + idempotent).", SendArgs, _send),
    ]


def gmail_agent(mode: str) -> AgentSpec:
    s = get_settings()
    reply_to = s.email_reply_to or s.smtp_user or "reply@awaaz.example"
    if mode == "communities":
        prompt = COMMUNITIES_PROMPT.replace("{reply_to}", reply_to)
        node = "gmail_communities"
    else:
        prompt = NEWS_PROMPT.replace("{reply_to}", reply_to)
        node = "gmail_news"
    return AgentSpec(name=f"gmail_agent_{mode}", node=node, system_prompt=prompt, build_tools=_tools, output_schema=EmailBatchResult, recursion_limit=40)


def template_email(mode: str, public_ref: str, public_text: str, filed_on: str | None = None) -> tuple[str, str]:
    s = get_settings()
    reply_to = s.email_reply_to or s.smtp_user or "reply@awaaz.example"
    if mode == "communities":
        subject = f"Anonymised harassment case {public_ref} for awareness"
        body = (
            "Assalam-o-Alaikum,\n\nAwaaz is a survivor-led reporting tool. A survivor chose to share the anonymised case "
            "below with communities working on this issue, so it can be raised publicly.\n\n"
            f"--- Case description ---\n{public_text}\n--- End ---\n\n"
            f"Suggested post: A survivor has reported harassment (case {public_ref}). Survivors deserve to be heard "
            "and complaints deserve action. #Awaaz\n\n"
            f"Reply to: {reply_to}\nReply STOP to stop receiving cases."
        )
    else:
        subject = f"Unaddressed harassment complaint {public_ref}"
        body = (
            f"A harassment complaint with public reference {public_ref} was filed with the police on {filed_on}. "
            "No action was recorded after the deadline.\n\n"
            f"--- Case description ---\n{public_text}\n--- End ---\n\n"
            "No personal information about the complainant is shared in this message.\n\n"
            f"Reply to: {reply_to}"
        )
    return subject, body
