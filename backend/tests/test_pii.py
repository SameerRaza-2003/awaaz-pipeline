import pytest

from app.tools.pii import Entity, entities_from_record, scan

CLEAN = [
    "On 12 March 2026 at around 6 pm, a woman was harassed by a senior colleague at a private company in Lahore.",
    "The incident happened on 2026-03-12 10:30 near a market in Karachi. She has screenshots of messages.",
    "A university student in Islamabad reports repeated unwanted messages from a staff member over three months.",
    "Ek private company mein manager ne baar baar ghalat comments kiye. Yeh Lahore ka waqia hai.",
]

DIRTY = [
    ("Call her on +92 300 1234567 for details.", "phone"),
    ("Her number is 0300-1234567.", "phone"),
    ("Contact: survivor.lahore@gmail.com", "email"),
    ("CNIC 35202-1234567-1 was shown.", "cnic"),
    ("CNIC 3520212345671 was shown.", "cnic"),
    ("See https://facebook.com/someone", "url"),
    ("He messaged from @bad_boss_99 on Instagram.", "handle"),
    ("She lives at House No. 42, Gulberg.", "street_address"),
    ("Employee ID 7781234 was used.", "id_number"),
]


@pytest.mark.parametrize("text", CLEAN)
def test_clean_texts(text):
    res = scan(text, [])
    assert res.clean, res.findings


@pytest.mark.parametrize("text,kind", DIRTY)
def test_regex_findings(text, kind):
    res = scan(text, [])
    assert not res.clean
    assert any(f["type"] == kind for f in res.findings), res.findings


def test_known_person_exact_and_fuzzy():
    ents = [Entity("Ayesha Siddiqui"), Entity("Bilal Ahmed")]
    assert not scan("The accused, Bilal, followed her.", ents).clean
    assert not scan("Aisha was afraid to go back.", ents).clean  # transliteration variant
    assert not scan("Mr. Ahmad shouted at her.", ents).clean  # Ahmed ~ Ahmad
    assert scan("A senior manager shouted at her.", ents).clean


def test_known_person_in_urdu_script():
    ents = [Entity("Bilal")]
    assert not scan("بلال نے اسے دھمکی دی", ents).clean


def test_known_org_generalised_is_clean():
    ents = [Entity("Zenith Textiles Lahore", "org")]
    assert not scan("She worked at Zenith Textiles.", ents).clean
    assert scan("She worked at a private company in Lahore.", ents).clean


def test_known_contact_digits():
    ents = [Entity("+92 321 7654321", "contact")]
    assert not scan("reach at 321 7654321", ents).clean


def test_entities_from_record():
    rec = {
        "complainant_name": "Ayesha Siddiqui",
        "accused_name": "Bilal Ahmed",
        "witness_names": ["Sana", "Hamza"],
        "institution_name": "Zenith Textiles",
        "complainant_contact": "+923001234567",
    }
    ents = entities_from_record(rec)
    kinds = {(e.value, e.kind) for e in ents}
    assert ("Sana", "person") in kinds and ("Zenith Textiles", "org") in kinds


def test_eval_cases_raw_text_is_always_flagged():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
    from cases import pii_cases

    for c in pii_cases():
        res = scan(c["record"]["incident_summary"], entities_from_record(c["record"]))
        kinds = {f.get("entity_kind") or f["type"] for f in res.findings}
        assert {"person", "phone"} <= kinds, c["id"]


def test_cross_script_names_without_latin_false_positives():
    ents = [Entity("Tahir Mehmood")]
    assert not scan("طاہر محمود نے پیغامات بھیجے", ents).clean
    assert scan("Three people were there and the tour was over.", ents).clean


def test_similarity_threshold_applies(monkeypatch):
    from app.tools.similarity import select_recipients

    scores = [{"community_id": i, "name": str(i), "score": s, "provider": "openrouter:x"} for i, s in enumerate([0.8, 0.5, 0.45, 0.44, 0.1])]
    chosen = select_recipients(scores)
    assert [c["score"] for c in chosen] == [0.8, 0.5, 0.45]
    assert len(select_recipients(scores, top_k=1)) == 1
