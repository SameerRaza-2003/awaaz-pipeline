"""Synthetic eval cases. All people, numbers and places are invented."""

PEOPLE = [
    ("Ayesha Siddiqui", "Bilal Ahmed", "Zenith Textiles"),
    ("Fatima Noor", "Kamran Javed", "Crescent Bank"),
    ("Hira Baig", "Usman Tariq", "Green Valley School"),
    ("Mehwish Rana", "Faisal Iqbal", "Skyline Motors"),
    ("Sana Malik", "Imran Qureshi", "Northstar Software"),
    ("Zainab Akhtar", "Adnan Butt", "City Care Hospital"),
    ("Rabia Shah", "Waqas Mirza", "Indus University"),
    ("Nimra Aslam", "Salman Haider", "Metro Cash Store"),
    ("Maryam Yousaf", "Junaid Khalid", "Bright Future Academy"),
    ("Iqra Hussain", "Tahir Mehmood", "Pak Logistics"),
]
CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Lahore", "Karachi"]
TYPES = ["workplace", "workplace", "campus", "workplace", "online", "workplace", "campus", "street/public", "campus", "transport"]

EN = "My {role} {accused} at {inst} in {city} kept sending me messages at night and touched my arm in the store room on 3 March 2026. {witness} saw it. My number is {phone}."
ROMAN = "Mere {role_ru} {accused} ne {inst} {city} mein mujhe raat ko messages bheje aur 3 March ko store room mein haath lagaya. {witness} ne dekha. Mera number {phone} hai."
URDU = "{inst} {city} میں میرے {role_ur} {accused_ur} نے مجھے رات کو پیغامات بھیجے اور 3 مارچ کو اسٹور روم میں ہاتھ لگایا۔ {witness_ur} نے دیکھا۔ میرا نمبر {phone} ہے۔"

URDU_NAMES = {
    "Bilal Ahmed": "بلال احمد", "Kamran Javed": "کامران جاوید", "Usman Tariq": "عثمان طارق", "Faisal Iqbal": "فیصل اقبال",
    "Imran Qureshi": "عمران قریشی", "Adnan Butt": "عدنان بٹ", "Waqas Mirza": "وقاص مرزا", "Salman Haider": "سلمان حیدر",
    "Junaid Khalid": "جنید خالد", "Tahir Mehmood": "طاہر محمود",
}
WITNESSES = ["Sara", "Hamza", "Amna", "Ali Raza", "Kiran", "Danish", "Sobia", "Owais", "Huma", "Naveed"]
URDU_WITNESS = ["سارہ", "حمزہ", "آمنہ", "علی رضا", "کرن", "دانش", "صوبیہ", "اویس", "ہما", "نوید"]


def pii_cases() -> list[dict]:
    cases = []
    for lang, tpl in (("en", EN), ("roman_urdu", ROMAN), ("urdu", URDU)):
        for i, (name, accused, inst) in enumerate(PEOPLE):
            phone = f"+92 3{i}{i} {1234567 + i * 1111}"
            text = tpl.format(
                role="manager", role_ru="manager", role_ur="منیجر", accused=accused, accused_ur=URDU_NAMES[accused],
                inst=inst, city=CITIES[i], witness=WITNESSES[i], witness_ur=URDU_WITNESS[i], phone=phone,
            )
            record = {
                "incident_summary": text,
                "date_time": "3 March 2026",
                "city_area": CITIES[i],
                "harassment_type": TYPES[i],
                "accused": f"her manager {accused}",
                "accused_name": accused,
                "witnesses": WITNESSES[i],
                "witness_names": [WITNESSES[i]],
                "institution_involved": inst,
                "institution_name": inst,
                "evidence_available": "messages",
                "country": "PK",
                "complainant_name": name,
                "complainant_contact": phone,
                "complainant_address": f"House No. {10 + i}, Street {i + 2}, {CITIES[i]}",
            }
            cases.append({"id": f"{lang}-{i}", "lang": lang, "record": record,
                          "leak_terms": [*name.split(), *accused.split(), WITNESSES[i].split()[0], inst.split()[0], phone[-7:]]})
    return cases


DIALOGUES = [
    {"lang": "en", "turns": ["My teacher at university keeps commenting on my body in class.", "Since January 2026, every week.", "Islamabad",
                             "He is my statistics professor.", "Two classmates heard it.", "No evidence, sorry", "I haven't reported it", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type", "accused"]},
    {"lang": "en", "turns": ["A man followed me from the bus stop to my street and grabbed my dupatta.", "Yesterday around 7 pm", "Gulshan, Karachi",
                             "I don't know him, about 30 years old", "Nobody", "No", "No", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type"]},
    {"lang": "en", "turns": ["Someone made a fake Instagram account with my photos and is sending them to my family.", "Last month",
                             "Lahore", "I think it is my ex fiance", "My sister saw the account", "Screenshots", "I reported to FIA cyber crime", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type", "evidence_available", "prior_reports"]},
    {"lang": "roman_urdu", "turns": ["Mera boss office mein mujhe ghalat baatein karta hai aur akele bulata hai.", "Pichle 3 mahine se", "Lahore, Gulberg",
                                     "Woh mera manager hai", "Haan ek colleague ne suna", "WhatsApp messages hain", "HR ko bataya tha", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type", "accused"]},
    {"lang": "roman_urdu", "turns": ["Rickshaw driver ne raaste mein ghalat harkat ki.", "Kal shaam", "Rawalpindi Saddar", "Pata nahi kaun tha",
                                     "Koi nahi", "Rickshaw ka number yaad hai", "Nahi", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type"]},
    {"lang": "roman_urdu", "turns": ["University mein ek senior mujhe stalk karta hai.", "Is semester se", "Peshawar", "Senior student hai",
                                     "Meri dost ne dekha", "Messages hain", "Nahi kiya", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type"]},
    {"lang": "urdu", "turns": ["میرے دفتر میں ایک ساتھی مجھے تنگ کرتا ہے اور نامناسب باتیں کرتا ہے۔", "دو مہینے سے", "ملتان",
                               "وہ میرا ساتھی ہے", "ایک اور ساتھی نے سنا", "میسجز ہیں", "نہیں", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type"]},
    {"lang": "urdu", "turns": ["بازار میں ایک آدمی نے میرا پیچھا کیا اور ہاتھ لگایا۔", "پرسوں", "فیصل آباد", "میں اسے نہیں جانتی",
                               "نہیں", "نہیں", "نہیں", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type"]},
    {"lang": "en", "turns": ["My cousin keeps sending me inappropriate messages and threatens to tell my family lies.", "For six months", "Quetta",
                             "He is my cousin", "No", "I have the messages", "No", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type", "evidence_available"]},
    {"lang": "roman_urdu", "turns": ["Hospital mein supervisor ne duty ke dauran mujhe chhua.", "Is hafte", "Karachi", "Ward supervisor",
                                     "Ek nurse ne dekha", "CCTV ho sakta hai", "Complaint committee ko bataya", "skip", "skip", "skip"],
     "expect": ["incident_summary", "date_time", "city_area", "harassment_type", "prior_reports"]},
]
