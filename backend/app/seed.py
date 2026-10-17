"""Fictional seed data. Replace with verified real contacts only after agreeing terms with them."""

import asyncio

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import Community, NewsAgency, SessionLocal, init_db
from app.tools.similarity import ensure_community_embeddings

COMMUNITIES = [
    (
        "Workplace Dignity Collective (fictional)",
        "PK",
        "Activists supporting women facing sexual harassment at the workplace: offices, factories, banks, "
        "private companies. Harassment by managers, bosses, supervisors and colleagues; inquiry committees "
        "under the 2010 workplace harassment law; HR complaints and retaliation.",
    ),
    (
        "Safe Streets Network (fictional)",
        "PK",
        "Campaigners against street and public-space harassment: catcalling, stalking, groping and following "
        "women in markets, parks and streets; making public spaces safe in Pakistani cities.",
    ),
    (
        "Campus Voices Alliance (fictional)",
        "PK",
        "Student-led group documenting harassment in universities, colleges and schools by teachers, professors, "
        "staff and fellow students; campus complaint committees and hostels.",
    ),
    (
        "Digital Safety Circle (fictional)",
        "PK,GLOBAL",
        "Digital rights volunteers helping survivors of online harassment: cyberstalking, blackmail, "
        "sextortion, fake profiles, leaked pictures, abusive messages on WhatsApp, Instagram and Facebook.",
    ),
    (
        "Commuter Women's Forum (fictional)",
        "PK",
        "Advocates for safe public transport: harassment on buses, metro, rickshaws, ride-hailing cabs and "
        "drivers; bus stops and stations; women commuters.",
    ),
    (
        "Home Safe Rights Group (fictional)",
        "PK",
        "Women's rights group working on domestic violence and harassment by family members, relatives, "
        "in-laws and husbands inside the home; shelters and legal aid.",
    ),
    (
        "Global Survivors Solidarity Network (fictional)",
        "GLOBAL",
        "International network amplifying survivors' stories of gender-based harassment and pushing "
        "institutions to respond to complaints.",
    ),
]

# Old seed names, renamed in place on start so existing databases keep their rows.
RENAMED_NEWS = {"Pakistan Herald Tips (fictional)": "Herald Tips Line (fictional)"}

NEWS = [
    ("Daily Sach Desk (fictional)", "PK"),
    ("Indus Newswire (fictional)", "PK"),
    ("Herald Tips Line (fictional)", "PK"),
]


def _addr(prefix: str, i: int) -> str:
    s = get_settings()
    base = {"community": s.community_email_base, "news": s.news_email_base}.get(prefix, "").strip() or s.seed_email_base.strip()
    if base and "@" in base:
        user, domain = base.split("@", 1)
        return f"{user.split('+')[0]}+{prefix}{i}@{domain}"
    return f"{prefix}{i}@example.org"


async def sync_emails() -> int:
    """Point existing demo organisations at the configured inboxes (runs on every start). Returns rows changed."""
    changed = 0
    async with SessionLocal() as db:
        for old, new in RENAMED_NEWS.items():
            row = await db.scalar(select(NewsAgency).where(NewsAgency.name == old))
            if row and not await db.scalar(select(NewsAgency).where(NewsAgency.name == new)):
                row.name = new
                changed += 1
        for i, (name, _, _) in enumerate(COMMUNITIES, 1):
            row = await db.scalar(select(Community).where(Community.name == name))
            if row and row.email != _addr("community", i):
                row.email = _addr("community", i)
                changed += 1
        for i, (name, _) in enumerate(NEWS, 1):
            row = await db.scalar(select(NewsAgency).where(NewsAgency.name == name))
            if row and row.email != _addr("news", i):
                row.email = _addr("news", i)
                changed += 1
        await db.commit()
    return changed


async def seed(reset: bool = False) -> dict:
    async with SessionLocal() as db:
        if reset:
            await db.execute(delete(Community))
            await db.execute(delete(NewsAgency))
            await db.commit()
        existing = {c.name for c in (await db.scalars(select(Community))).all()}
        for i, (name, countries, desc) in enumerate(COMMUNITIES, 1):
            if name not in existing:
                db.add(Community(name=name, email=_addr("community", i), description=desc, countries=countries))
        existing_news = {n.name for n in (await db.scalars(select(NewsAgency))).all()}
        for i, (name, country) in enumerate(NEWS, 1):
            if name not in existing_news:
                db.add(NewsAgency(name=name, email=_addr("news", i), country=country))
        await db.commit()
    provider = await ensure_community_embeddings(None)
    return {"communities": len(COMMUNITIES), "news_agencies": len(NEWS), "embedding_provider": provider}


async def _main() -> None:
    await init_db()
    print(await seed(reset=True))


if __name__ == "__main__":
    asyncio.run(_main())
