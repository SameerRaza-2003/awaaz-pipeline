# Awaaz

Awaaz ("voice") is a chat tool for survivors of harassment. It opens with one question: **"Are you in danger right now?"**

- **Yes:** the survivor's live location goes to her trusted contact by SMS, with a Google Maps link, and the contact gets a phone call. Updated locations keep going out until she presses **I'm safe**.
- **No:** she can report a case. A gentle interview, in Urdu, Roman Urdu or English, produces two texts:
  - a **police description** with every detail, submitted to a separate police dashboard;
  - a **public description** with no personal information, emailed to activist communities picked by embedding similarity.

  If the police record no action within 24 hours, the public description goes to news outlets.

The frontend shows the whole workflow live: which agent is running, which tool it called, with what arguments, what came back, and what happens next.

> Awaaz is not a substitute for emergency services. Pakistan: Police **15**, Rescue **1122**.

## How it is built

```
Next.js (Home, About, Police)  ──REST + SSE──>  FastAPI
                                                 ├─ workflows (plain Python, fixed order): emergency, report, escalation
                                                 │     └─ agents (LangChain create_agent + tools), run by AgentRunner
                                                 │          Location · Twilio · Intake · Drafting · Matching · Gmail · PoliceDispatch · PoliceStatus
                                                 ├─ OutboundGuard: every SMS / call / email (dry_run · sandbox · live, idempotent)
                                                 ├─ event bus → events table → SSE (replay with Last-Event-ID)
                                                 └─ scheduler loop over escalation_jobs (survives restarts)
awaaz.db   sessions, contacts, communities, news agencies, public reports, dispatch log, jobs, events, agent runs
police.db  complaints (encrypted fields) and status history, reachable only through app/police
```

Each agent is an LLM with tools, but **the order of steps, who gets contacted, and every safety check live in code**:

| Guarantee | Where it is enforced |
|---|---|
| Public text has no personal info | `tools/pii.py` scanner, re-run by `save_drafts`, at confirm, and by `send_email` |
| Only communities above the threshold get email | `tools/similarity.select_recipients` uses scores it computed itself |
| News escalation only when not addressed / not cancelled | `evaluate_addressed` + `trigger_news` re-check, and the workflow overrules the agent |
| No double sends | `dispatch_log` unique key `(ref, kind, recipient)` claimed before sending |
| Nothing leaves the machine in dry run | `OutboundGuard`, the only path to Twilio and SMTP |
| Help still goes out if the LLM fails | deterministic fallbacks: fixed SMS/call template, fixed-question interview, direct police submission |
| Publication fails closed | if the scanner cannot confirm a clean public text, nothing is sent publicly; the police complaint still goes |

## Running it

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
cp .env.example .env          # fill in what you have; everything defaults to safe dry-run mode
make install
make dev                      # backend on :8000, frontend on :3000
```

Open http://localhost:3000. The police dashboard is at `/police` (demo login from `POLICE_DEMO_USER` / `POLICE_DEMO_PASSWORD`, default `officer` / `awaaz-demo`).

Without an `OPENROUTER_API_KEY` the app still works end to end on its deterministic fallbacks: the alert and call go out from a fixed template, the interview uses fixed questions, the police complaint is built from the answers, and the public report is held back because no clean public draft can be confirmed.

### Configuration

All settings are in [.env.example](.env.example). The important ones:

| Variable | Meaning |
|---|---|
| `OUTBOUND_MODE` | `dry_run` (default: log only), `sandbox` (only `OUTBOUND_ALLOWLIST`), `live` |
| `ALERT_AUTHORITIES` / `AUTHORITY_NUMBER` | off by default; never contact real emergency services by accident |
| `OPENROUTER_API_KEY`, `MODEL_DEFAULT`, `MODEL_DRAFTING` | LLMs, see [docs/MODEL_CHOICE.md](docs/MODEL_CHOICE.md) |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `MATCH_THRESHOLD`, `MATCH_TOP_K` | community matching |
| `ESCALATION_DELAY_SECONDS` | default 86400 (24 h) |
| `DATA_ENCRYPTION_KEY` | Fernet key or passphrase for encrypted fields. **Set this outside development.** |
| `POLICE_SERVICE_KEY` | shared secret the platform uses to submit to the police service |
| `SEED_EMAIL_BASE` | e.g. `you@gmail.com`; seed contacts become `you+community1@gmail.com` so demo emails really arrive |

### Twilio

Create an account, buy or use the trial number, and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
**Trial accounts can only send SMS and place calls to verified numbers**: verify your own phone in the Twilio console, put it in
`OUTBOUND_ALLOWLIST`, and use `OUTBOUND_MODE=sandbox`. Trial calls also play a short Twilio notice before the message.

### Gmail

Turn on 2-step verification for the sending account, create an **app password** (Google Account → Security → App passwords),
and set `SMTP_USER` and `SMTP_APP_PASSWORD`. Gmail's sending limits apply. For the demo, set `SEED_EMAIL_BASE` to the same
address and run `make demo-reset` so community and news emails land in your own inbox via plus-addressing.

### Google Maps

The browser provides the coordinates. `GOOGLE_MAPS_API_KEY` (Geocoding API) adds a street address to the alert;
without it the alert has coordinates and a Maps link only. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps Embed API) is optional for the map on the home page.

## Tests

```bash
make test            # unit + integration (scripted LLM, fake Twilio/SMTP, injected clock)
make e2e             # drives both scenarios through a running backend; refuses to run in live mode
make matching-eval   # does each case rank the right community first?
make eval MODELS=a,b # model selection eval, needs OPENROUTER_API_KEY
make lint            # frontend typecheck + eslint
```

## Demo script (about 4 minutes)

1. `make demo-reset`, then open the home page. Point out the "Demo mode" banner and the idle workflow graph.
2. Open **Setup**, add yourself as the trusted contact. Click **Yes**. Location Agent, then Twilio Agent light up; open the Agent Console to show the tool calls and the Maps link. In sandbox mode your phone buzzes.
3. Press **I'm safe**, then **Start a new session**.
4. Click **No**, then **Yes, report**. Chat in Urdu or English. Watch Intake, then Drafting (a PII retry shows as a second `pii_scan`), then the two cards.
5. Press **Send**. Police Dispatch and Matching run side by side; the console shows similarity scores; the Gmail Agent sends.
6. Open `/police` in a second window: the complaint is there with a countdown.
7. Press **Demo: fast-forward**. The Police Status Agent sees `NEW` and escalates; news emails go out.
8. Repeat with a second complaint after marking it `IN_PROGRESS` on the police page: "addressed, no escalation".

## Scope

Not included yet: follow-up updates to communities, routing to agencies other than the police, a mobile app, WhatsApp,
evidence uploads, and a UI in languages other than English (Urdu text input is supported).
The survivor side uses anonymous sessions; the police side uses a demo login, not production identity or MFA.
Seed organisations are fictional. Add real contacts only after agreeing terms with them.
