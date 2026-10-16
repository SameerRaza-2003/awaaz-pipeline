"""EmbeddingProvider interface: OpenRouter (default), fastembed (local, optional) and a hashing fallback."""

import hashlib
import json
import math
import re
from typing import Protocol

import httpx

from app.config import get_settings


class EmbeddingProvider(Protocol):
    name: str

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenRouterEmbeddings:
    def __init__(self) -> None:
        s = get_settings()
        if not s.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY not set")
        self.s = s
        self.name = f"openrouter:{s.embedding_model}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self.s.openrouter_base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.s.openrouter_api_key}"},
                json={"model": self.s.embedding_model, "input": texts},
            )
            r.raise_for_status()
            data = r.json()["data"]
        return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]


class FastEmbedEmbeddings:
    MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    def __init__(self) -> None:
        from fastembed import TextEmbedding  # optional dependency: uv sync --extra local-embeddings

        self.model = TextEmbedding(self.MODEL)
        self.name = f"fastembed:{self.MODEL}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import asyncio

        return await asyncio.to_thread(lambda: [list(map(float, v)) for v in self.model.embed(texts)])


class HashEmbeddings:
    """Dependency-free bag-of-words hashing. Lexical only; used offline and in tests."""

    DIM = 512
    name = "hash:bow512"
    STOP = set("a an the of and or to in on at for with by from is was were be been her his she he they it this that as are".split())

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        v = [0.0] * self.DIM
        words = [w for w in re.findall(r"[a-z]+", text.lower()) if w not in self.STOP and len(w) > 2]
        for w in words:
            stem = w[:6]
            h = int(hashlib.md5(stem.encode()).hexdigest(), 16)
            v[h % self.DIM] += 1.0 if (h >> 9) & 1 else -1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]


_cached: EmbeddingProvider | None = None


def get_provider() -> EmbeddingProvider:
    global _cached
    if _cached is not None:
        return _cached
    choice = get_settings().embedding_provider
    order = {"openrouter": ["openrouter", "fastembed", "hash"], "fastembed": ["fastembed", "hash"], "hash": ["hash"]}[choice]
    for name in order:
        try:
            if name == "openrouter":
                _cached = OpenRouterEmbeddings()
            elif name == "fastembed":
                _cached = FastEmbedEmbeddings()
            else:
                _cached = HashEmbeddings()
            return _cached
        except Exception:  # noqa: BLE001
            continue
    _cached = HashEmbeddings()
    return _cached


def reset_provider() -> None:
    global _cached
    _cached = None


async def embed_with_fallback(texts: list[str]) -> tuple[str, list[list[float]]]:
    """Embed with the configured provider; on failure drop to the hashing provider."""
    global _cached
    p = get_provider()
    try:
        return p.name, await p.embed(texts)
    except Exception:  # noqa: BLE001
        _cached = HashEmbeddings()
        return _cached.name, await _cached.embed(texts)


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def pack(provider: str, vec: list[float]) -> str:
    return json.dumps({"provider": provider, "v": vec})


def unpack(raw: str | None) -> tuple[str | None, list[float] | None]:
    if not raw:
        return None, None
    d = json.loads(raw)
    return d.get("provider"), d.get("v")
