import asyncio
from collections import defaultdict, deque

from sqlalchemy import text

from app import db, llm
from app.llm import ScriptedChatModel, final, tool_call, tool_calls
from langchain_core.messages import AIMessage

NAME = "Ayesha Siddiqui"
ACCUSED = "Bilal Ahmed"
PHONE = "+923001234567"

PUBLIC_DIRTY = (
    "According to the complainant, a senior manager named Bilal repeatedly made unwelcome comments and "
    "touched her shoulder without consent at a private company in Lahore during March 2026."
)
PUBLIC_CLEAN = (
    "According to the complainant, a senior manager at a private company in Lahore repeatedly made unwelcome "
    "comments about her appearance and touched her shoulder without consent during March 2026. She reported "
    "feeling unsafe at the workplace and has saved messages as evidence. The complaint concerns workplace "
    "harassment by a supervisor; the accused has not been found guilty of any offence."
)
POLICE = (
    f"The complainant, {NAME} (contact {PHONE}, House No. 12, Model Town, Lahore), states that her manager "
    f"{ACCUSED} at Zenith Textiles repeatedly harassed her at work in March 2026."
)


class Scripts:
    """Queue of scripted models per agent; each agent run pops the next script."""

    def __init__(self):
        self.queues: dict[str, deque] = defaultdict(deque)

    def add(self, agent: str, *messages):
        self.queues[agent].append(list(messages))

    def __call__(self, agent: str):
        q = self.queues.get(agent)
        if not q:
            return ScriptedChatModel(script=[RuntimeError(f"no script for {agent}")])
        return ScriptedChatModel(script=q.popleft())

    def install(self):
        llm.set_model_override(self)
        return self


def intake_scripts(s: Scripts):
    s.add(
        "intake_agent",
        tool_call("record_fields", fields={"incident_summary": "Her manager made comments and touched her shoulder repeatedly",
                                           "harassment_type": "workplace", "city_area": "Lahore", "date_time": "March 2026"}),
        AIMessage(content="Thank you for sharing. Who was the person, if you feel comfortable saying?"),
    )
    s.add(
        "intake_agent",
        tool_call("record_fields", fields={"accused": "her manager", "accused_name": ACCUSED, "institution_name": "Zenith Textiles",
                                           "complainant_name": NAME, "complainant_contact": PHONE,
                                           "complainant_address": "House No. 12, Model Town, Lahore", "evidence_available": "messages"}),
        tool_call("finalize_intake"),
        AIMessage(content="Thank you. I will now prepare two drafts for you to review."),
    )


def drafting_scripts(s: Scripts):
    s.add(
        "drafting_agent",
        tool_call("pii_scan", text=PUBLIC_DIRTY),
        tool_call("save_drafts", police_text=POLICE, public_text=PUBLIC_DIRTY),
        tool_call("pii_scan", text=PUBLIC_CLEAN),
        tool_call("save_drafts", police_text=POLICE, public_text=PUBLIC_CLEAN),
        final("DraftingDone", saved=True, notes="clean on second attempt"),
    )


async def drain():
    from app.workflows.emergency import _tasks

    for _ in range(50):
        if not _tasks:
            return
        await asyncio.gather(*list(_tasks), return_exceptions=True)
        await asyncio.sleep(0)


async def awaaz_dump() -> str:
    """Every text value in awaaz.db, for leak assertions."""
    out = []
    async with db.SessionLocal() as s:
        tables = (await s.execute(text("select name from sqlite_master where type='table'"))).scalars().all()
        for t in tables:
            for row in (await s.execute(text(f"select * from {t}"))).all():
                out.extend(str(v) for v in row)
    return "\n".join(out)


__all__ = ["Scripts", "final", "tool_call", "tool_calls"]
