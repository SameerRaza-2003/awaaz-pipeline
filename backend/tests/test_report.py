from sqlalchemy import select

from app import sessions
from app.config import get_settings
from app.crypto import decrypt
from app.db import DispatchLog, EscalationJob, PublicReport, SessionLocal
from app.events import bus
from app.police.db import Complaint, PoliceSession
from app.seed import seed
from app.workflows import report

from .helpers import ACCUSED, NAME, PUBLIC_CLEAN, Scripts, awaaz_dump, drafting_scripts, drain, final, intake_scripts, tool_call


async def _to_review(monkeypatch, scripts: Scripts):
    monkeypatch.setenv("MATCH_THRESHOLD_HASH", "0.05")
    get_settings.cache_clear()
    await seed()
    sid = (await sessions.create_session()).id
    await report.start(sid, True)
    intake_scripts(scripts)
    drafting_scripts(scripts)
    r1 = await report.message(sid, "My manager keeps touching me at work")
    assert not r1["finalized"] and "Who was" in r1["reply"]
    r2 = await report.message(sid, f"It is {ACCUSED}. My name is {NAME}.")
    assert r2["finalized"]
    await drain()
    sess = await sessions.get_session(sid)
    assert sess.phase == "review"
    return sid


async def test_full_report_flow(monkeypatch):
    s = Scripts().install()
    sid = await _to_review(monkeypatch, s)
    state = await sessions.load_state(sid)
    assert state["drafts"]["public_clean"] and state["drafts"]["public_text"] == PUBLIC_CLEAN
    # nothing is dispatched before Send
    async with SessionLocal() as db:
        assert (await db.scalars(select(DispatchLog))).all() == []
        assert (await db.scalars(select(PublicReport))).all() == []

    s.add("police_dispatch_agent", tool_call("get_public_ref"),
          tool_call("submit_to_police_dashboard", city="Lahore", country="PK", harassment_type="workplace"),
          final("DispatchOut", police_ref="?", public_ref="?", submitted_at="?"))
    s.add("matching_agent", tool_call("search_communities", public_text="x", country="PK"),
          tool_call("select_recipients", scores=[]), final("Recipients", recipients=[]))
    s.add("gmail_agent_communities", RuntimeError("gmail agent crashed"))  # fallback template must still send

    res = await report.confirm(sid, None, None)
    await drain()
    ref = res["public_ref"]

    async with PoliceSession() as db:
        c = (await db.scalars(select(Complaint))).one()
    assert c.public_ref == ref and NAME in decrypt(c.full_text_enc) and decrypt(c.complainant_name_enc) == NAME

    async with SessionLocal() as db:
        pr = await db.get(PublicReport, ref)
        assert pr.police_ref == c.police_ref and pr.public_clean
        emails = (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "community_email"))).all()
        job = await db.scalar(select(EscalationJob).where(EscalationJob.public_ref == ref))
    assert emails and all(e.status == "dry_run" for e in emails)
    assert job and job.state == "pending"
    async with SessionLocal() as db:
        authority = (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "authority_email"))).all()
    assert len(authority) == 1 and authority[0].status == "dry_run"
    assert authority[0].recipient == get_settings().authority_recipient

    hist = await bus.history(sid)
    matched = next(e for e in hist if e["kind"] == "status" and "selected" in e["data"])
    selected = matched["data"]["selected"]
    assert {e.recipient for e in emails} and len(emails) == len(selected)
    assert all(x["score"] >= 0.05 for x in selected)

    # awaaz.db never holds the unfiltered account
    dump = await awaaz_dump()
    for secret in (NAME, "Ayesha", ACCUSED, "Bilal", "Zenith", "Model Town", "1234567"):
        assert secret not in dump, secret
    assert (await sessions.get_session(sid)).purged_at is not None


async def test_matching_threshold_none_pass(monkeypatch):
    s = Scripts().install()
    sid = await _to_review(monkeypatch, s)
    monkeypatch.setenv("MATCH_THRESHOLD_HASH", "0.99")
    get_settings.cache_clear()
    res = await report.confirm(sid, None, None)
    await drain()
    async with SessionLocal() as db:
        emails = (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "community_email"))).all()
        authority = (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "authority_email"))).all()
        pr = await db.get(PublicReport, res["public_ref"])
    assert emails == [] and pr.police_ref  # police flow still continues
    assert len(authority) == 1  # the authority still gets the post version
    hist = await bus.history(sid)
    assert any(e["data"].get("message") == "No community matched" for e in hist)


async def test_public_on_hold_when_pii_never_clears(monkeypatch):
    s = Scripts().install()
    monkeypatch.setenv("MATCH_THRESHOLD_HASH", "0.05")
    get_settings.cache_clear()
    await seed()
    sid = (await sessions.create_session()).id
    await report.start(sid, True)
    intake_scripts(s)
    from .helpers import POLICE, PUBLIC_DIRTY

    s.add("drafting_agent", *[tool_call("save_drafts", police_text=POLICE, public_text=PUBLIC_DIRTY) for _ in range(4)],
          final("DraftingDone", saved=False))
    await report.message(sid, "hello")
    await report.message(sid, "more")
    await drain()
    state = await sessions.load_state(sid)
    assert state["drafts"]["public_clean"] is False
    res = await report.confirm(sid, None, None)
    await drain()
    assert res["public_clean"] is False
    async with SessionLocal() as db:
        assert (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "community_email"))).all() == []
        pr = await db.get(PublicReport, res["public_ref"])
        assert pr.public_text == "" and pr.police_ref  # police complaint still goes through
        assert await db.scalar(select(EscalationJob)) is None


async def test_edited_public_text_with_pii_is_refused(monkeypatch):
    s = Scripts().install()
    sid = await _to_review(monkeypatch, s)
    try:
        await report.confirm(sid, None, PUBLIC_CLEAN + " Call 0300-1234567.")
        raise AssertionError("should refuse")
    except report.FlowError as e:
        assert e.status == 422


async def test_revise_public_keeps_police_text(monkeypatch):
    s = Scripts().install()
    sid = await _to_review(monkeypatch, s)
    before = (await sessions.load_state(sid))["drafts"]
    new_public = PUBLIC_CLEAN.replace("about her appearance", "of a personal nature")
    s.add("drafting_agent", tool_call("save_drafts", police_text="ignored police text that is long enough to pass", public_text=new_public),
          final("DraftingDone", saved=True))
    await report.revise(sid, "public", "make it less specific")
    await drain()
    after = (await sessions.load_state(sid))["drafts"]
    assert after["public_text"] == new_public and after["police_text"] == before["police_text"]


async def test_intake_without_llm_uses_fixed_questions():
    # no scripts installed for intake: every agent call fails, the fixed interview takes over
    Scripts().install()
    sid = (await sessions.create_session()).id
    await report.start(sid, True)
    answers = ["My boss touched me at the office", "May 2026", "Karachi", "my manager Imran Qureshi", "skip",
               "messages", "no", "Sana Malik", "+923331112222", "skip"]
    r = None
    for a in answers:
        r = await report.message(sid, a)
        if r["finalized"]:
            break
    assert r["finalized"]
    await drain()
    state = await sessions.load_state(sid)
    rec = state["record"]
    assert rec["harassment_type"] == "other" and rec["city_area"] == "Karachi"  # no LLM: no guessing from keywords
    assert rec["complainant_name"] == "Sana Malik" and "Imran" in rec["accused"]
    assert "Imran Qureshi" in state["drafts"]["police_text"] and "Sana Malik" in state["drafts"]["police_text"]
    assert state["drafts"]["public_clean"] is False  # no drafting LLM: publication fails closed
