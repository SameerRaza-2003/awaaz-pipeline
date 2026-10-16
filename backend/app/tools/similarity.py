from sqlalchemy import select

from app.config import get_settings
from app.db import Community, SessionLocal
from app.embeddings import cosine, embed_with_fallback, pack, unpack


async def ensure_community_embeddings(provider_name: str | None = None) -> str:
    """(Re)compute cached community embeddings when missing or produced by another provider."""
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Community).where(Community.active.is_(True)))).all()
        stale = [r for r in rows if unpack(r.embedding_json)[0] != provider_name or provider_name is None]
        if not stale:
            return provider_name or ""
        name, vecs = await embed_with_fallback([f"{r.name}. {r.description}" for r in stale])
        for r, v in zip(stale, vecs, strict=True):
            r.embedding_json = pack(name, v)
        await db.commit()
        return name


async def score_communities(public_text: str, country: str) -> list[dict]:
    """Cosine similarity of the case against every active community in the country (or GLOBAL)."""
    name, [case_vec] = await embed_with_fallback([public_text])
    await ensure_community_embeddings(name)
    country = country.upper()
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Community).where(Community.active.is_(True)))).all()
    out = []
    for r in rows:
        countries = {c.strip().upper() for c in r.countries.split(",")}
        if country not in countries and "GLOBAL" not in countries:
            continue
        prov, vec = unpack(r.embedding_json)
        score = cosine(case_vec, vec) if vec and prov == name else 0.0
        out.append(
            {
                "community_id": r.id,
                "name": r.name,
                "email": r.email,
                "description": r.description,
                "countries": r.countries,
                "score": round(score, 4),
                "provider": name,
            }
        )
    out.sort(key=lambda x: x["score"], reverse=True)
    return out


def effective_threshold(scores: list[dict]) -> float:
    s = get_settings()
    hashed = bool(scores) and str(scores[0].get("provider", "")).startswith("hash")
    return s.match_threshold_hash if hashed else s.match_threshold


def select_recipients(scores: list[dict], threshold: float | None = None, top_k: int | None = None) -> list[dict]:
    s = get_settings()
    if threshold is None:
        threshold = effective_threshold(scores)
    top_k = s.match_top_k if top_k is None else top_k
    passing = [x for x in sorted(scores, key=lambda x: x["score"], reverse=True) if x["score"] >= threshold]
    return passing[:top_k]
