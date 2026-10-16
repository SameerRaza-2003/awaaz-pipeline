"""Deterministic PII scanner. The public text is only ever released if this says clean."""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("url", re.compile(r"\b(?:https?://|www\.)\S+", re.I)),
    ("cnic", re.compile(r"\b\d{5}-\d{7}-\d\b")),
    ("cnic", re.compile(r"(?<!\d)\d{13}(?!\d)")),
    ("phone", re.compile(r"(?<![\w])\+?\d[\d\s\-().]{7,}\d(?![\w])")),
    ("phone", re.compile(r"\b0?3\d{2}[\s-]?\d{7}\b")),
    ("handle", re.compile(r"(?<![\w.])@[A-Za-z0-9_.]{2,}")),
    ("id_number", re.compile(r"(?<![\w])\d{6,}(?![\w])")),
    (
        "street_address",
        re.compile(
            r"\b(?:house|h\s?#|plot|flat|apartment|apt|street|st\.|gali|lane|mohallah|mohalla|block)\s*(?:no\.?|number|#)?\s*\d+[A-Za-z]?\b",
            re.I,
        ),
    ),
    ("street_address", re.compile(r"\b\d+[A-Za-z]?[,\s]+(?:[A-Z][a-z]+\s){0,3}(?:road|street|avenue|lane)\b", re.I)),
]

# Urdu script -> rough Latin, only for fuzzy name matching.
URDU_MAP = {
    "ا": "a", "آ": "a", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s", "ج": "j", "چ": "ch", "ح": "h",
    "خ": "kh", "د": "d", "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh",
    "ص": "s", "ض": "z", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "ك": "k",
    "گ": "g", "ل": "l", "م": "m", "ن": "n", "ں": "n", "و": "o", "ہ": "a", "ه": "h", "ھ": "h", "ء": "",
    "ی": "i", "ي": "i", "ے": "e", "ئ": "i", "ۓ": "e", "ة": "a", "ۃ": "a",
}

NAME_STOPWORDS = {
    "mr", "mrs", "ms", "miss", "sir", "madam", "dr", "prof", "sahab", "sahib", "bibi", "begum", "syed",
    "muhammad", "mohammad", "the", "and", "my", "his", "her", "manager", "boss", "teacher", "colleague",
    "neighbour", "neighbor", "cousin", "uncle", "friend", "driver", "unknown", "man", "woman", "person",
    "he", "she", "they", "their", "its", "this", "that", "there", "then", "when", "we", "our", "it", "in", "at",
    "on", "name", "is", "was", "line", "senior", "junior", "head", "staff", "student", "yes", "not", "know",
}

GENERIC_PLACE_WORDS = {
    "company", "private", "school", "college", "university", "office", "bank", "hospital", "market", "road",
    "street", "city", "town", "limited", "ltd", "pvt", "the", "of", "and", "public", "government", "lahore",
    "karachi", "islamabad", "rawalpindi", "pakistan", "peshawar", "quetta", "multan", "faisalabad",
}


@dataclass
class Entity:
    value: str
    kind: str = "person"  # person | org | place | contact | identifier


@dataclass
class ScanResult:
    clean: bool
    findings: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"clean": self.clean, "findings": self.findings}


def translit(s: str) -> str:
    s = "".join(URDU_MAP.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


URDU_RE = re.compile(r"[\u0600-\u06FF]")


def skeleton(latin: str) -> str:
    """Consonant skeleton used to compare names across Urdu and Latin script."""
    t = re.sub(r"[^a-z]", "", latin.lower())
    for a, b in (("ph", "f"), ("q", "k"), ("w", "v")):
        t = t.replace(a, b)
    t = re.sub(r"[aeiouhy]", "", t)
    return re.sub(r"(.)\1+", r"\1", t)


def norm_token(tok: str) -> str:
    if URDU_RE.search(tok):
        return "~" + skeleton(translit(tok))
    t = translit(tok).lower()
    t = re.sub(r"[^a-z]", "", t)
    for a, b in (("ph", "f"), ("q", "k"), ("w", "v"), ("ee", "i"), ("oo", "u"), ("ay", "e"), ("ai", "e"), ("ei", "e"), ("y", "i")):
        t = t.replace(a, b)
    t = re.sub(r"(.)\1+", r"\1", t)  # collapse doubled letters
    return t


def _tokens(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in re.finditer(r"[\w؀-ۿ']+", text)]


def _coerce(entities: list[Any] | None) -> list[Entity]:
    out: list[Entity] = []
    for e in entities or []:
        if isinstance(e, Entity):
            out.append(e)
        elif isinstance(e, dict) and e.get("value"):
            out.append(Entity(str(e["value"]), e.get("kind", "person")))
        elif isinstance(e, str) and e.strip():
            out.append(Entity(e.strip(), "person"))
    return [e for e in out if e.value.strip()]


DATE_RE = re.compile(r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}:\d{2}")


def _looks_like_phone(s: str) -> bool:
    digits = re.sub(r"\D", "", s)
    return 9 <= len(digits) <= 15 and not DATE_RE.search(s)


def _token_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a.startswith("~") or b.startswith("~"):
        sa = a[1:] if a.startswith("~") else skeleton(a)
        sb = b[1:] if b.startswith("~") else skeleton(b)
        if len(sa) < 2 or len(sb) < 2:
            return False
        return sa == sb if min(len(sa), len(sb)) <= 3 else fuzz.ratio(sa, sb) >= 85
    if len(b) <= 3 or len(a) <= 3:
        return a == b
    threshold = 85 if min(len(a), len(b)) <= 4 else 80
    return fuzz.ratio(a, b) >= threshold


def scan(text: str, known_entities: list[Any] | None = None) -> ScanResult:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()

    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            span = (m.start(), m.end())
            if any(s[0] <= span[0] and span[1] <= s[1] for s in seen):
                continue
            if kind == "phone" and not _looks_like_phone(m.group(0)):
                continue
            seen.add(span)
            findings.append({"type": kind, "match": m.group(0), "start": m.start(), "end": m.end()})

    text_tokens = [(t, s, e, norm_token(t)) for t, s, e in _tokens(text)]
    flat_text = re.sub(r"[^0-9a-z]", "", translit(text).lower())
    for ent in _coerce(known_entities):
        if ent.kind == "identifier":
            # Plates, ID numbers, handles: match the alphanumeric core anywhere, ignoring spacing and dashes.
            core = re.sub(r"[^0-9a-z]", "", translit(ent.value).lower())
            if len(core) >= 3 and core in flat_text:
                findings.append({"type": "known_entity", "entity_kind": "identifier", "match": ent.value})
            continue
        if ent.kind == "contact":
            # phone numbers / emails / addresses given by the survivor: compare digit runs and long words
            digits = re.sub(r"\D", "", ent.value)
            if len(digits) >= 6 and digits[-6:] in re.sub(r"\D", "", text):
                findings.append({"type": "known_entity", "entity_kind": ent.kind, "match": "contact digits"})
            ent_tokens = [norm_token(t) for t, _, _ in _tokens(ent.value) if len(t) >= 4 and not t.isdigit()]
            ent_tokens = [t for t in ent_tokens if t not in GENERIC_PLACE_WORDS]
            for tt, s, e, nt in text_tokens:
                if any(_token_match(nt, et) and len(et) >= 5 for et in ent_tokens):
                    findings.append({"type": "known_entity", "entity_kind": "contact", "match": tt, "start": s, "end": e})
            continue

        raw_tokens = [t for t, _, _ in _tokens(ent.value)]
        if ent.kind == "person":
            ent_tokens = [norm_token(t) for t in raw_tokens if t.lower() not in NAME_STOPWORDS]
            ent_tokens = [t for t in ent_tokens if len(t) >= 3]
            for tt, s, e, nt in text_tokens:
                if tt.lower() in NAME_STOPWORDS:
                    continue
                if any(_token_match(nt, et) for et in ent_tokens):
                    findings.append({"type": "known_entity", "entity_kind": "person", "match": tt, "start": s, "end": e})
        else:
            # Organisation / place: flag distinctive words (not generic ones like "school" or the city).
            distinct = [norm_token(t) for t in raw_tokens if t.lower() not in GENERIC_PLACE_WORDS and len(t) >= 3]
            for tt, s, e, nt in text_tokens:
                if tt.lower() in GENERIC_PLACE_WORDS:
                    continue
                if any(_token_match(nt, et) for et in distinct):
                    findings.append({"type": "known_entity", "entity_kind": ent.kind, "match": tt, "start": s, "end": e})
            # whole-phrase fuzzy check catches transliterated multi-word names
            if len(ent.value) >= 8 and fuzz.partial_ratio(translit(ent.value).lower(), translit(text).lower()) >= 92:
                if not any(f.get("entity_kind") == ent.kind for f in findings):
                    findings.append({"type": "known_entity", "entity_kind": ent.kind, "match": ent.value})

    return ScanResult(clean=not findings, findings=findings)


def entities_from_record(rec: dict[str, Any]) -> list[Entity]:
    """Known entities for leak checks, built from intake slots."""
    ents: list[Entity] = []

    def add(val: Any, kind: str):
        if not val:
            return
        if isinstance(val, list):
            for v in val:
                add(v, kind)
            return
        for part in re.split(r"[,;/]| and | aur ", str(val)):
            if part.strip():
                ents.append(Entity(part.strip(), kind))

    add(rec.get("complainant_name"), "person")
    add(rec.get("accused_name"), "person")
    add(rec.get("witness_names"), "person")
    add(rec.get("other_names"), "person")
    add(rec.get("institution_name"), "org")
    add(rec.get("complainant_contact"), "contact")
    add(rec.get("complainant_address"), "contact")
    return ents
