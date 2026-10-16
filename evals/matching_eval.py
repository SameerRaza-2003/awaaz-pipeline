"""Matching sanity: each case should rank the community whose focus matches first.

    cd backend && uv run python ../evals/matching_eval.py
Uses the configured EMBEDDING_PROVIDER, so it also helps tune MATCH_THRESHOLD.
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

CASES = [
    ("A senior manager at a private company in Lahore repeatedly made unwelcome comments to an employee and touched her "
     "without consent at the office. She complained to HR.", "Workplace Dignity Collective"),
    ("A university student reports that a professor made sexual remarks in class and sent messages asking her to meet "
     "privately, threatening her grades.", "Campus Voices Alliance"),
    ("A woman reports that an unknown account created a fake profile with her pictures on Instagram and is sending "
     "abusive messages and blackmail threats.", "Digital Safety Circle"),
    ("A woman was groped by a passenger on a crowded metro bus and later followed by the rickshaw driver from the bus stop.",
     "Commuter Women's Forum"),
    ("A woman reports that men in a market followed her, catcalled and blocked her path in the street in the evening.",
     "Safe Streets Network"),
    ("A woman reports harassment and threats by her in-laws and husband inside the family home.", "Home Safe Rights Group"),
]


async def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["DATA_DIR"] = tmp
        from app import db
        from app.config import get_settings
        from app.seed import seed
        from app.tools.similarity import score_communities, select_recipients

        get_settings.cache_clear()
        await db.init_db()
        info = await seed(reset=True)
        print(f"embedding provider: {info['embedding_provider']}, threshold {get_settings().match_threshold}")
        ok = 0
        for text, expected in CASES:
            scores = await score_communities(text, "PK")
            top = scores[0]
            hit = top["name"].startswith(expected)
            ok += hit
            chosen = [s["name"].split(" (")[0] for s in select_recipients(scores)]
            print(f"{'✓' if hit else '✗'} expected {expected:30s} top {top['name'].split(' (')[0]:30s} {top['score']:.3f}  selected={chosen}")
        await db.close_db()
    print(f"\n{ok}/{len(CASES)} ranked the expected community first")
    return 0 if ok == len(CASES) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
