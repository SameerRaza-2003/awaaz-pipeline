"""Model selection eval for OpenRouter models.

    cd backend && uv run python ../evals/run_model_eval.py --models deepseek/deepseek-v4-flash,openai/gpt-5-nano
    cd backend && uv run python ../evals/run_model_eval.py --list     # print the cheapest tool-capable models

Each model runs, in an isolated temp database with OUTBOUND_MODE=dry_run:
  (a) tool-call correctness: every agent once, asserting the tools it must call
  (b) PII removal: 30 cases (en / Roman Urdu / Urdu); public text must pass pii_scan AND a leak check
  (c) intake quality: 10 scripted dialogues; slot completeness and style rules
  (d) latency per agent run, (e) cost per full pipeline run (from OpenRouter usage)
Results go to evals/results/<model>.json and a summary table is printed.
"""

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "evals"))

import httpx  # noqa: E402

PASS = {"tool_calls": 1.0, "pii": 1.0, "intake": 0.8}


def leak_check(text: str, terms: list[str]) -> list[str]:
    from app.tools.pii import norm_token

    tokens = {norm_token(t) for t in re.findall(r"[\w؀-ۿ]+", text)}
    digits = re.sub(r"\D", "", text)
    leaks = []
    for term in terms:
        if term.isdigit() or re.sub(r"\D", "", term) == term.replace(" ", ""):
            if re.sub(r"\D", "", term) and re.sub(r"\D", "", term) in digits:
                leaks.append(term)
        elif len(term) >= 3 and norm_token(term) in tokens:
            leaks.append(term)
    return leaks


async def setup_env(model: str, tmp: str) -> None:
    os.environ.update({"DATA_DIR": tmp, "OUTBOUND_MODE": "dry_run", "MODEL_DEFAULT": model, "MODEL_DRAFTING": "", "PURGE_TRANSCRIPT": "false"})
    from app import crypto, db, embeddings
    from app.config import get_settings
    from app.police import db as pdb
    from app.seed import seed

    get_settings.cache_clear()
    crypto.reset()
    embeddings.reset_provider()
    await db.init_db()
    await pdb.init_police_db()
    await seed(reset=True)


async def teardown() -> None:
    from app import db
    from app.police import db as pdb

    await db.close_db()
    await pdb.close_police_db()


async def tools_called(session_id: str) -> list[str]:
    from app.events import bus

    return [e["data"]["tool"] for e in await bus.history(session_id) if e["kind"] == "tool.start" and e.get("agent") != "tracking_updater"]


async def eval_tool_calls() -> dict:
    """(a) Every agent once with the real model; required tools must be called."""
    from app import sessions
    from app.workflows import emergency, escalation, report
    from app.workflows.emergency import _tasks

    async def drain():
        while _tasks:
            await asyncio.gather(*list(_tasks), return_exceptions=True)

    results = {}
    sid = (await sessions.create_session()).id
    await sessions.set_trusted_contact(sid, "Sara", "+923001234567")
    await emergency.start(sid, {"lat": 31.5204, "lng": 74.3587, "accuracy": 12}, None)
    await drain()
    called = await tools_called(sid)
    fb = [e for e in await __import__("app.events", fromlist=["bus"]).bus.history(sid) if e["kind"] == "step" and e["data"].get("fallback")]
    results["location_agent"] = {"get_latest_location", "build_maps_link"} <= set(called) and not any(e["node"] == "location_agent" for e in fb)
    results["twilio_agent"] = {"send_sms", "place_call"} <= set(called) and not any(e["node"] == "twilio_agent" for e in fb)

    sid = (await sessions.create_session()).id
    await report.start(sid, True)
    for t in ["My manager Bilal Ahmed at Zenith Textiles in Lahore touched me and sends messages at night, since March 2026.",
              "A colleague Sana saw it. I have WhatsApp messages. I told HR.", "My name is Ayesha Siddiqui, +923217654321, House 12 Model Town Lahore.",
              "That is everything, please prepare the report."]:
        r = await report.message(sid, t)
        if r["finalized"]:
            break
    called = await tools_called(sid)
    results["intake_agent"] = "record_fields" in called and r["finalized"]
    await drain()
    called = await tools_called(sid)
    results["drafting_agent"] = {"pii_scan", "save_drafts"} <= set(called)
    state = await sessions.load_state(sid)
    if (await sessions.get_session(sid)).phase == "review" and state.get("drafts", {}).get("public_clean"):
        from app.config import get_settings

        os.environ["MATCH_THRESHOLD"] = "0.0"
        os.environ["MATCH_THRESHOLD_HASH"] = "0.0"
        get_settings.cache_clear()
        res = await report.confirm(sid, None, None)
        await drain()
        called = await tools_called(sid)
        results["police_dispatch_agent"] = "submit_to_police_dashboard" in called
        results["matching_agent"] = {"search_communities", "select_recipients"} <= set(called)
        results["gmail_agent_communities"] = called.count("send_email") >= 1
        from app.db import DispatchLog, SessionLocal
        from sqlalchemy import select

        async with SessionLocal() as db:
            fallback_emails = (await db.scalars(select(DispatchLog).where(DispatchLog.kind == "community_email"))).all()
        await escalation.fast_forward(res["public_ref"])
        escalation.now = lambda: __import__("app.db", fromlist=["utcnow"]).utcnow() + __import__("datetime").timedelta(days=2)
        await escalation.tick()
        called = await tools_called(sid)
        results["police_status_agent"] = {"get_complaint_status", "evaluate_addressed", "trigger_news_escalation"} <= set(called)
        results["gmail_agent_news"] = called.count("send_email") > len(fallback_emails)
    else:
        for k in ("police_dispatch_agent", "matching_agent", "gmail_agent_communities", "police_status_agent", "gmail_agent_news"):
            results[k] = False
    return results


async def eval_pii(cases: list[dict]) -> dict:
    """(b) Drafting agent on synthetic records: zero leaks required."""
    from app import sessions
    from app.workflows import report

    out = []
    for c in cases:
        sid = (await sessions.create_session()).id
        await sessions.save_state(sid, {"slots": c["record"], "record": c["record"], "final": True, "default_country": "PK"})
        drafts = await report.run_drafting(sid)
        leaks = leak_check(drafts["public_text"], c["leak_terms"]) if drafts["public_text"] else ["(no public text)"]
        out.append({"id": c["id"], "clean": drafts["public_clean"], "leaks": leaks, "ok": drafts["public_clean"] and not leaks})
        print(f"    pii {c['id']}: {'ok' if out[-1]['ok'] else 'FAIL ' + str(leaks)}", flush=True)
    return {"cases": out, "pass_rate": sum(x["ok"] for x in out) / len(out)}


async def eval_intake(dialogues: list[dict]) -> dict:
    """(c) Slot completeness + style: one question per reply, never 'why'."""
    from app import sessions
    from app.workflows import report

    out = []
    for i, d in enumerate(dialogues):
        sid = (await sessions.create_session()).id
        await report.start(sid, True)
        style_ok = True
        finalized = False
        for t in d["turns"]:
            r = await report.message(sid, t)
            reply = r["reply"]
            if reply.count("?") + reply.count("؟") > 2 or re.search(r"\bwhy\b|\bkyun\b|کیوں", reply, re.I):
                style_ok = False
            if r["finalized"]:
                finalized = True
                break
        state = await sessions.load_state(sid)
        slots = state.get("slots", {})
        filled = sum(1 for k in d["expect"] if slots.get(k))
        score = filled / len(d["expect"])
        out.append({"id": i, "lang": d["lang"], "completeness": score, "style_ok": style_ok, "finalized": finalized,
                    "ok": score >= 0.8 and style_ok and finalized})
        print(f"    intake {i} ({d['lang']}): completeness {score:.2f} style {'ok' if style_ok else 'FAIL'} finalized {finalized}", flush=True)
    return {"dialogues": out, "pass_rate": sum(x["ok"] for x in out) / len(out)}


async def runs_summary() -> dict:
    from sqlalchemy import select

    from app.db import AgentRun, SessionLocal

    async with SessionLocal() as db:
        runs = (await db.scalars(select(AgentRun))).all()
    lat = [(r.ended_at - r.started_at).total_seconds() for r in runs if r.ended_at]
    return {
        "agent_runs": len(runs),
        "errors": sum(r.status != "done" for r in runs),
        "latency_p50_s": round(statistics.median(lat), 2) if lat else None,
        "latency_max_s": round(max(lat), 2) if lat else None,
        "cost_usd_total": round(sum(r.cost_usd for r in runs), 5),
    }


async def eval_model(model: str, quick: bool) -> dict:
    from cases import DIALOGUES, pii_cases

    with tempfile.TemporaryDirectory() as tmp:
        await setup_env(model, tmp)
        try:
            t0 = time.time()
            print(f"== {model}: (a) tool calls", flush=True)
            tc = await eval_tool_calls()
            pipeline = await runs_summary()
            print(f"== {model}: (b) PII", flush=True)
            cases = pii_cases()
            pii = await eval_pii(cases[::6] if quick else cases)
            print(f"== {model}: (c) intake", flush=True)
            intake = await eval_intake(DIALOGUES[:3] if quick else DIALOGUES)
            totals = await runs_summary()
        finally:
            await teardown()
    tool_rate = sum(tc.values()) / len(tc)
    passed = tool_rate >= PASS["tool_calls"] and pii["pass_rate"] >= PASS["pii"] and intake["pass_rate"] >= PASS["intake"]
    return {
        "model": model,
        "passed": passed,
        "tool_calls": tc,
        "tool_call_rate": tool_rate,
        "pii_pass_rate": pii["pass_rate"],
        "intake_pass_rate": intake["pass_rate"],
        "pipeline_cost_usd": pipeline["cost_usd_total"],
        "latency_p50_s": totals["latency_p50_s"],
        "latency_max_s": totals["latency_max_s"],
        "eval_cost_usd": totals["cost_usd_total"],
        "wall_s": round(time.time() - t0, 1),
        "detail": {"pii": pii, "intake": intake},
    }


def list_models(n: int = 25) -> None:
    r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
    rows = []
    for m in r.json()["data"]:
        sp = set(m.get("supported_parameters") or [])
        if "tools" not in sp or "structured_outputs" not in sp or ":batch" in m["id"] or ":free" in m["id"]:
            continue
        p = m.get("pricing") or {}
        pi, po = float(p.get("prompt", 0)) * 1e6, float(p.get("completion", 0)) * 1e6
        if pi > 0:
            rows.append((pi + 3 * po, pi, po, m["id"]))
    for _, pi, po, mid in sorted(rows)[:n]:
        print(f"{mid:50s} ${pi:.3f}/M in  ${po:.3f}/M out")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="")
    ap.add_argument("--quick", action="store_true", help="subset of cases, for a smoke run")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        list_models()
        return
    from app.config import get_settings

    if not get_settings().openrouter_api_key:
        sys.exit("Set OPENROUTER_API_KEY in .env first.")
    from app import llm

    asyncio.run(llm.load_pricing())
    out_dir = ROOT / "evals" / "results"
    out_dir.mkdir(exist_ok=True)
    results = []
    for m in [x.strip() for x in a.models.split(",") if x.strip()]:
        res = asyncio.run(eval_model(m, a.quick))
        (out_dir / f"{m.replace('/', '__')}.json").write_text(json.dumps(res, indent=2, default=str))
        results.append(res)
    print("\n| model | (a) tools | (b) PII | (c) intake | pipeline $ | p50 s | pass |")
    print("|---|---|---|---|---|---|---|")
    for r in results:
        print(f"| {r['model']} | {r['tool_call_rate']:.0%} | {r['pii_pass_rate']:.0%} | {r['intake_pass_rate']:.0%} | "
              f"{r['pipeline_cost_usd']:.4f} | {r['latency_p50_s']} | {'✅' if r['passed'] else '❌'} |")


if __name__ == "__main__":
    main()
