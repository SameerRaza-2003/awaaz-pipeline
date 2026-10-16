from langchain_core.messages import AIMessage

from app import llm, sessions
from app.config import get_settings
from app.llm import ScriptedChatModel, tool_call
from app.tools import privacy
from app.tools.pii import Entity, scan
from app.workflows import report

from .helpers import Scripts, drain


def test_plate_number_identifier_is_caught_in_any_spacing():
    ents = [Entity("LEB-7865", "identifier")]
    assert not scan("Two men on a bike, plate LEB 7865, followed her.", ents).clean
    assert not scan("The plate number was 7865 leb", [Entity("7865", "identifier")]).clean
    assert scan("Two men on a motorbike followed her car near a signal in Lahore.", ents).clean


def _enable(monkeypatch):
    monkeypatch.setenv("PRIVACY_LLM_REVIEW", "true")
    get_settings.cache_clear()


async def test_review_flags_what_regex_misses(monkeypatch):
    _enable(monkeypatch)
    text = "A woman was followed by two men on a motorbike with plate 7865 near the university in Lahore."
    assert scan(text, []).clean  # the pattern scanner alone misses a short plate number
    llm.set_model_override(lambda name: ScriptedChatModel(script=[tool_call("Review", identifying_details=["plate 7865"], clean=False)]))
    res = await privacy.full_check("s", text, [])
    assert not res.clean and res.findings[0]["type"] == "privacy_review"


async def test_review_fails_closed(monkeypatch):
    _enable(monkeypatch)
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("down")]))
    res = await privacy.full_check("s", "A woman was harassed at a private company in Lahore by a senior colleague.", [])
    assert not res.clean


async def test_extracted_identifiers_block_the_draft(monkeypatch):
    """End to end: the model extracts the plate, the scanner then refuses a draft that contains it."""
    _enable(monkeypatch)
    s = Scripts().install()
    s.add("privacy_guard", tool_call("Identifiers", items=[{"value": "7865", "kind": "identifier"}]))
    dirty = "According to the complainant, two men on a motorbike, plate 7865, followed her car to a traffic signal in Lahore and filmed her."
    clean = "According to the complainant, two men on a motorbike followed her car to a traffic signal in Lahore, filmed her without consent and made inappropriate remarks."
    police = "The complainant states that two men on motorbike 7865 followed her car on the way to university and filmed her."
    s.add("drafting_agent", tool_call("save_drafts", police_text=police, public_text=dirty),
          tool_call("save_drafts", police_text=police, public_text=clean), tool_call("DraftingDone", saved=True))
    s.add("privacy_guard", tool_call("Review", identifying_details=[], clean=True))
    sid = (await sessions.create_session()).id
    rec = {"incident_summary": "followed by two men on a bike, plate 7865", "harassment_type": "street/public", "city_area": "Lahore", "country": "PK"}
    await sessions.save_state(sid, {"slots": rec, "record": rec, "final": True, "transcript": [{"role": "user", "text": "plate 7865"}]})
    drafts = await report.run_drafting(sid)
    await drain()
    assert drafts["public_text"] == clean and drafts["public_clean"]
    state = await sessions.load_state(sid)
    assert {"value": "7865", "kind": "identifier"} in state["entities"]


async def test_danger_comes_from_the_agent_not_keywords():
    Scripts().install()
    sid = (await sessions.create_session()).id
    await report.start(sid, True)
    # no LLM: words like "bachao" no longer trigger anything by themselves
    r = await report.message(sid, "bachao, he is here")
    assert r["danger_suspected"] is False
    s = Scripts().install()
    sid2 = (await sessions.create_session()).id
    await report.start(sid2, True)
    s.add("intake_agent", tool_call("signal_danger", reason="someone outside"), AIMessage(content="You can press Get help now."))
    assert (await report.message(sid2, "someone is outside my door right now"))["danger_suspected"] is True
