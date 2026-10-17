"""HTML version of outreach emails, sent next to the plain text one.

The plain text body is what the agent writes and what every privacy check runs on, so the HTML is only a rendering of
that same text: nothing is added except fixed labels. Table layout and inline styles, because that is what mail
clients (Gmail, Outlook, Apple Mail) render reliably.
"""

import re
from datetime import datetime, timezone
from html import escape
from urllib.parse import quote

# Brand tokens, same values as the web app (frontend/app/globals.css).
PAPER = "#f6f3ec"
SURFACE = "#fffdf9"
SUNKEN = "#eeeae1"
INK = "#1f1b16"
INK_2 = "#474037"
MUTED = "#655d52"
LINE = "#ded7ca"
DANGER = "#a3231a"
SERIF = "Georgia, 'Times New Roman', serif"
SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

KICKER = {
    "community_email": "An anonymised case for your community",
    "news_email": "An unaddressed complaint",
    "authority_email": "Public post version, for your attention",
}

CASE_RE = re.compile(r"-{2,}\s*Case description\s*-{2,}\s*\n(.*?)\n\s*-{2,}\s*End\s*-{2,}", re.S | re.I)
POST_RE = re.compile(r"^\s*(?:suggested|social[- ]?media)[^:\n]{0,40}?post[^:\n]{0,20}:\s*(.*)$", re.I)
REPLY_RE = re.compile(r"^\s*reply[- ]to\s*:\s*(\S+)\s*$", re.I)
STOP_RE = re.compile(r"reply\s+stop", re.I)
PRIVACY_RE = re.compile(r"no personal information", re.I)


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _p(text: str, *, size: int = 16, color: str = INK_2, margin: str = "0 0 16px") -> str:
    body = escape(text).replace("\n", "<br>")
    return f'<p style="margin:{margin};font-family:{SANS};font-size:{size}px;line-height:1.6;color:{color};">{body}</p>'


def parse(body: str) -> dict:
    """Split an outreach email into its parts. Anything not recognised stays in `intro` or `outro`, never dropped."""
    m = CASE_RE.search(body)
    case = m.group(1).strip() if m else ""
    before, after = (body[: m.start()], body[m.end() :]) if m else (body, "")

    post = reply_to = None
    stop = privacy = False
    outro: list[str] = []
    lines = after.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if pm := POST_RE.match(line):
            text = pm.group(1).strip()
            if not text:  # label on its own line: the post is the next paragraph
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                buf = []
                while j < len(lines) and lines[j].strip():
                    buf.append(lines[j].strip())
                    j += 1
                text, i = " ".join(buf), j - 1
            post = text or None
        elif rm := REPLY_RE.match(line):
            reply_to = rm.group(1)
        elif STOP_RE.search(line):
            stop = True
        elif PRIVACY_RE.search(line):
            privacy = True
        else:
            outro.append(line)
        i += 1
    return {
        "intro": _paragraphs(before),
        "case": case,
        "post": post,
        "outro": _paragraphs("\n".join(outro)),
        "reply_to": reply_to,
        "stop": stop,
        "privacy": privacy,
    }


def render(kind: str, subject: str, body: str, ref: str | None = None, now: datetime | None = None) -> str:
    parts = parse(body)
    date = (now or datetime.now(timezone.utc)).strftime("%d %B %Y").lstrip("0")
    kicker = KICKER.get(kind, "A message from Awaaz")
    preheader = escape((parts["case"] or body)[:140].replace("\n", " "))

    meta = f'<span style="font-family:{SANS};font-size:13px;color:{MUTED};">{escape(date)}</span>'
    if ref:
        meta = (
            f'<span style="display:inline-block;padding:3px 8px;border:1px solid {LINE};border-radius:4px;'
            f'font-family:Menlo,Consolas,monospace;font-size:13px;color:{INK};">{escape(ref)}</span>'
            f'<span style="font-family:{SANS};font-size:13px;color:{MUTED};">&nbsp;&nbsp;{escape(date)}</span>'
        )

    alert = ""
    if kind == "news_email":
        alert = (
            f'<tr><td style="padding:0 40px 24px;"><div style="background:{DANGER};color:#ffffff;border-radius:6px;padding:12px 16px;'
            f'font-family:{SANS};font-size:15px;font-weight:600;line-height:1.4;">'
            "No action was recorded by the authorities before the deadline.</div></td></tr>"
        )

    intro = "".join(_p(t) for t in parts["intro"])
    case = ""
    if parts["case"]:
        case_paras = "".join(_p(t, size=17, color=INK, margin="0 0 12px") for t in _paragraphs(parts["case"]))
        case = (
            f'<tr><td class="px" style="padding:8px 40px 8px;">'
            f'<p style="margin:0 0 10px;font-family:{SANS};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{MUTED};">The case</p>'
            f'<div style="border-left:4px solid {DANGER};padding:4px 0 4px 20px;">{case_paras}</div>'
            "</td></tr>"
        )

    post = ""
    if parts["post"]:
        share = "https://twitter.com/intent/tweet?text=" + quote(parts["post"][:280])
        post = (
            f'<tr><td class="px" style="padding:16px 40px 8px;"><div style="background:{SUNKEN};border-radius:8px;padding:20px 22px;">'
            f'<p style="margin:0 0 8px;font-family:{SANS};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{MUTED};">Suggested post</p>'
            + _p(parts["post"], size=16, color=INK, margin="0 0 16px")
            + f'<a href="{escape(share)}" style="display:inline-block;background:{INK};color:#ffffff;text-decoration:none;'
            f'font-family:{SANS};font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">Share this post</a>'
            "</div></td></tr>"
        )

    outro = "".join(_p(t) for t in parts["outro"])
    outro_row = f'<tr><td class="px" style="padding:16px 40px 0;">{outro}</td></tr>' if outro else ""

    privacy = (
        f'<tr><td class="px" style="padding:16px 40px 8px;"><p style="margin:0;font-family:{SANS};font-size:14px;line-height:1.5;color:{INK_2};">'
        f'<span style="color:{DANGER};font-weight:700;">&#9679;</span>&nbsp; No personal information about the survivor is in this email. '
        "The case was anonymised and checked twice before sending, and the survivor approved it.</p></td></tr>"
    )

    footer_bits = []
    if parts["reply_to"]:
        addr = escape(parts["reply_to"])
        footer_bits.append(f'Reply to <a href="mailto:{addr}" style="color:{INK};">{addr}</a>.')
    if parts["stop"]:
        footer_bits.append("Reply STOP to stop receiving cases.")
    footer_bits.append("Sent by Awaaz on behalf of a survivor.")
    footer = " ".join(footer_bits)

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{escape(subject)}</title>
<style>@media (max-width:480px){{.px{{padding-left:20px !important;padding-right:20px !important;}}}}</style></head>
<body style="margin:0;padding:0;background:{PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:{SURFACE};border:1px solid {LINE};border-radius:10px;">
<tr><td class="px" style="padding:28px 40px 20px;border-bottom:1px solid {LINE};">
  <span style="font-family:{SERIF};font-size:26px;font-weight:700;color:{INK};letter-spacing:-0.01em;">Awaaz</span>
  <span style="font-family:{SANS};font-size:13px;color:{MUTED};">&nbsp;&nbsp;A survivor's voice, kept anonymous</span>
</td></tr>
<tr><td class="px" style="padding:28px 40px 8px;">
  <p style="margin:0 0 10px;font-family:{SANS};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{DANGER};">{escape(kicker)}</p>
  <h1 style="margin:0 0 14px;font-family:{SERIF};font-size:28px;line-height:1.2;font-weight:700;color:{INK};">{escape(subject)}</h1>
  <p style="margin:0 0 20px;">{meta}</p>
</td></tr>
{alert}
<tr><td class="px" style="padding:0 40px;">{intro}</td></tr>
{case}
{post}
{outro_row}
{privacy}
<tr><td class="px" style="padding:24px 40px 28px;border-top:1px solid {LINE};">
  <p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.6;color:{MUTED};">{footer}</p>
</td></tr>
</table>
</td></tr></table>
</body></html>"""
