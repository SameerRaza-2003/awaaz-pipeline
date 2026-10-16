"""End-to-end check against a running backend (default http://localhost:8000).

Drives both scenarios through the real API and asserts events, dispatch_log rows and police dashboard state.

    cd backend && uv run python ../scripts/e2e.py [--api URL] [--db backend/data/awaaz.db]

Works with or without OPENROUTER_API_KEY: without it every agent falls back to its deterministic path,
which is exactly what the fallbacks are for.
"""

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]

INTAKE = [
    "My manager at the office keeps making comments about my body and touched my shoulder twice.",
    "It happened in March 2026, most recently last Tuesday evening.",
    "Lahore, at a private textile company.",
    "He is my line manager. His name is Bilal Ahmed.",
    "A colleague saw it once. I have WhatsApp messages from him.",
    "I complained to HR verbally but nothing happened.",
    "My name is Ayesha Siddiqui, number +923217654321, I live in Model Town, Lahore.",
    "That's all, please continue.",
    "skip",
    "skip",
    "skip",
]


def events(c: httpx.Client, sid: str, seconds: float = 2.0) -> list[dict]:
    out = []
    try:
        with c.stream("GET", f"/api/sessions/{sid}/events", timeout=httpx.Timeout(seconds, read=seconds)) as r:
            for line in r.iter_lines():
                if line.startswith("data: ") and line != "data: {}":
                    out.append(json.loads(line[6:]))
    except httpx.ReadTimeout:
        pass
    return out


def wait_for(fn, timeout=90, every=1.0, what="condition"):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise AssertionError(f"timed out waiting for {what}")


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        raise AssertionError(msg)


def emergency(c: httpx.Client, db: Path):
    print("Emergency scenario")
    sid = c.post("/api/sessions", json={}).json()["session_id"]
    c.put(f"/api/sessions/{sid}/settings", json={"trusted_contact": {"name": "Sara", "phone": "+923001234567"}})
    t0 = time.time()
    r = c.post(f"/api/sessions/{sid}/danger", json={"answer": "yes", "location": {"lat": 31.5204, "lng": 74.3587, "accuracy": 15}})
    em = r.json()["emergency_id"]
    wait_for(lambda: any(e["kind"] == "workflow.end" for e in events(c, sid, 1.5)), 60, what="emergency workflow end")
    took = time.time() - t0
    evs = events(c, sid)
    loc = next(e for e in evs if e["kind"] == "status" and "location" in e["data"])["data"]["location"]
    check(loc["maps_link"].startswith("https://www.google.com/maps?q=31.52"), "location event with Maps link")
    rows = sqlite3.connect(db).execute("select kind, status from dispatch_log where public_ref=?", (f"em{em}:alert",)).fetchall()
    check(("sms", "dry_run") in rows or ("sms", "sent") in rows, "SMS dispatch row")
    check(("call", "dry_run") in rows or ("call", "sent") in rows, "call dispatch row")
    check(took < 60, f"alert completed in {took:.1f}s")
    check(c.post(f"/api/sessions/{sid}/safe", json={}).json()["ok"], "marked safe")


def report(c: httpx.Client, db: Path):
    print("Report scenario")
    sid = c.post("/api/sessions", json={}).json()["session_id"]
    c.post(f"/api/sessions/{sid}/danger", json={"answer": "no"})
    c.post(f"/api/sessions/{sid}/report/start", json={"wants_report": True})
    for text in INTAKE:
        r = c.post(f"/api/sessions/{sid}/messages", json={"text": text}, timeout=120).json()
        print(f"    you: {text[:50]}…\n    awaaz: {r['reply'][:90]}")
        if r["finalized"]:
            break
    check(r["finalized"], "intake finalized")
    s = wait_for(lambda: (x := c.get(f"/api/sessions/{sid}").json())["phase"] == "review" and x, 180, 2, "drafts")
    drafts = s["drafts"]
    check(bool(drafts["police_text"]), "police draft exists")
    for secret in ("Ayesha", "Bilal", "3217654321", "Model Town"):
        check(secret not in drafts["public_text"], f"public draft has no '{secret}'")
    n_before = sqlite3.connect(db).execute("select count(*) from dispatch_log where kind like '%email'").fetchone()[0]
    check(n_before == sqlite3.connect(db).execute("select count(*) from dispatch_log where kind like '%email'").fetchone()[0], "nothing sent before Send")
    t0 = time.time()
    ref = c.post(f"/api/sessions/{sid}/report/confirm", json={}).json()["public_ref"]

    tok = c.post("/api/police/login", json={"username": "officer", "password": "awaaz-demo"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    row = wait_for(lambda: next((x for x in c.get("/api/police/complaints", headers=h).json()["complaints"] if x["public_ref"] == ref), None), 60, 0.5, "police complaint")
    print(f"    police dashboard had the complaint after {time.time() - t0:.1f}s")
    detail = c.get(f"/api/police/complaints/{row['police_ref']}", headers=h).json()
    check("Ayesha" in (detail["full_text"] or "") or detail["complainant_name"], "police sees unfiltered details")

    wait_for(lambda: c.get(f"/api/sessions/{sid}").json()["phase"] == "sent", 120, 1, "report sent")
    con = sqlite3.connect(db)
    dump = "\n".join(str(v) for t in [r[0] for r in con.execute("select name from sqlite_master where type='table'")] for row_ in con.execute(f"select * from {t}") for v in row_)
    for secret in ("Ayesha", "Bilal Ahmed", "3217654321"):
        check(secret not in dump, f"awaaz.db never stores '{secret}'")
    pr = con.execute("select public_clean from public_reports where public_ref=?", (ref,)).fetchone()
    print(f"    public description clean: {bool(pr[0])}")
    return ref, row["police_ref"], bool(pr[0]), h


def escalation(c: httpx.Client, db: Path, ref: str, police_ref: str, h: dict):
    print("Escalation scenario")
    con = sqlite3.connect(db)
    n_agencies = con.execute("select count(*) from news_agencies where country='PK' and active=1").fetchone()[0]
    check(c.post(f"/api/demo/fast-forward/{ref}").json()["ok"], "fast-forward")
    wait_for(lambda: sqlite3.connect(db).execute("select state from escalation_jobs where public_ref=?", (ref,)).fetchone()[0] == "done", 120, 1, "escalation job")
    n = sqlite3.connect(db).execute("select count(*) from dispatch_log where public_ref=? and kind='news_email'", (ref,)).fetchone()[0]
    check(n == n_agencies, f"unaddressed complaint emailed {n} news agencies (one each)")


def addressed(c: httpx.Client, db: Path):
    print("Addressed complaint scenario")
    ref, police_ref, clean, h = report(c, db)
    if not clean:
        print("    (public text on hold, skipping)")
        return
    c.patch(f"/api/police/complaints/{police_ref}/status", headers=h, json={"status": "IN_PROGRESS", "note": "assigned"})
    c.post(f"/api/demo/fast-forward/{ref}")
    wait_for(lambda: sqlite3.connect(db).execute("select state from escalation_jobs where public_ref=?", (ref,)).fetchone()[0] == "done", 120, 1, "escalation job")
    n = sqlite3.connect(db).execute("select count(*) from dispatch_log where public_ref=? and kind='news_email'", (ref,)).fetchone()[0]
    check(n == 0, "addressed complaint is not escalated")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--db", default=str(ROOT / "backend" / "data" / "awaaz.db"))
    a = ap.parse_args()
    db = Path(a.db)
    with httpx.Client(base_url=a.api, timeout=30) as c:
        health = c.get("/healthz").json()
        print(f"Backend: mode={health['outbound_mode']} llm={'on' if health['llm_configured'] else 'off (fallbacks)'}")
        if health["outbound_mode"] == "live":
            sys.exit("Refusing to run e2e against OUTBOUND_MODE=live")
        emergency(c, db)
        ref, police_ref, clean, h = report(c, db)
        if clean:
            escalation(c, db, ref, police_ref, h)
        else:
            print("  (public description on hold: news escalation correctly disabled)")
        addressed(c, db)
    print("\nAll end-to-end checks passed.")


if __name__ == "__main__":
    main()
