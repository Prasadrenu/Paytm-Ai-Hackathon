"""Indian festival and holiday calendar (2026), used as a demand signal.

Dates come from a published holiday listing (timeanddate.com, cross-checked against other calendars).
Moon-based dates (Eid, Muharram) can move by a day. Covers 2026 only; other years fall back to no events.
The demand FACTORS below are planning assumptions, not measured data."""
import datetime as dt

# kind: "major" = big footfall / shopping days, "minor" = regional or smaller festivals,
#       "holiday" = gazetted public holiday (offices and schools shut: crowd moves, not necessarily bigger)
_E = [
    ("2026-01-13", "Lohri", "minor"), ("2026-01-14", "Makar Sankranti / Pongal", "minor"),
    ("2026-01-23", "Vasant Panchami", "minor"), ("2026-01-26", "Republic Day", "holiday"),
    ("2026-02-15", "Maha Shivaratri", "minor"), ("2026-03-03", "Holika Dahan", "minor"),
    ("2026-03-04", "Holi", "major"), ("2026-03-19", "Ugadi / Gudi Padwa", "minor"),
    ("2026-03-21", "Eid al-Fitr", "major"), ("2026-03-26", "Rama Navami", "holiday"),
    ("2026-03-31", "Mahavir Jayanti", "holiday"), ("2026-04-03", "Good Friday", "holiday"),
    ("2026-04-14", "Vaisakhi / Ambedkar Jayanti", "holiday"), ("2026-05-01", "Buddha Purnima", "holiday"),
    ("2026-05-28", "Bakrid (Eid al-Adha)", "major"), ("2026-06-26", "Muharram", "holiday"),
    ("2026-07-16", "Rath Yatra", "minor"), ("2026-08-15", "Independence Day", "holiday"),
    ("2026-08-26", "Onam / Milad un-Nabi", "major"), ("2026-08-28", "Raksha Bandhan", "major"),
    ("2026-09-04", "Janmashtami", "major"), ("2026-09-14", "Ganesh Chaturthi", "major"),
    ("2026-10-02", "Gandhi Jayanti", "holiday"), ("2026-10-11", "Navratri begins", "minor"),
    ("2026-10-18", "Maha Saptami", "minor"), ("2026-10-19", "Maha Ashtami", "minor"),
    ("2026-10-20", "Dussehra", "major"), ("2026-10-29", "Karwa Chauth", "minor"),
    ("2026-11-06", "Dhanteras", "major"), ("2026-11-08", "Diwali", "major"),
    ("2026-11-09", "Govardhan Puja", "minor"), ("2026-11-11", "Bhai Dooj", "minor"),
    ("2026-11-15", "Chhath Puja", "minor"), ("2026-11-24", "Guru Nanak Jayanti", "holiday"),
    ("2026-12-25", "Christmas", "major"),
]
EVENTS = {}
for d, name, kind in _E:
    EVENTS.setdefault(dt.date.fromisoformat(d), []).append((name, kind))
YEARS = {2026}


def events_for(day):
    """Events on `day` and on the day after (a festival eve changes demand too)."""
    out = [{"name": n, "kind": k, "when": "today"} for n, k in EVENTS.get(day, [])]
    out += [{"name": n, "kind": k, "when": "tomorrow"} for n, k in EVENTS.get(day + dt.timedelta(days=1), [])
            if k in ("major", "minor")]
    return out


def covered(day):
    return day.year in YEARS


def event_dates():
    """Every date with a festival (not a plain holiday), so payment history can skip them as 'normal days'."""
    return {d for d, es in EVENTS.items() if any(k in ("major", "minor") for _, k in es)}


def factor(cat, evs):
    """(multiplier, reasons) for a category on a day with these events. Assumptions, stated plainly."""
    today = [e for e in evs if e["when"] == "today"]
    tomorrow = [e for e in evs if e["when"] == "tomorrow"]
    m, why = 1.0, []
    major = [e for e in today if e["kind"] == "major"]
    minor = [e for e in today if e["kind"] == "minor"]
    if major:
        m = 1.5 if cat == "sweet" else 1.25 if cat in ("fried_snack", "meal") else 1.15
        why.append(major[0]["name"])
    elif minor:
        m = 1.05
        why.append(minor[0]["name"])
    eve = [e for e in tomorrow if e["kind"] == "major"]
    if eve and not major:
        m *= 1.25 if cat == "sweet" else 1.1
        why.append(f"eve of {eve[0]['name']}")
    hol = [e for e in today if e["kind"] == "holiday"]
    if hol:
        why.append(f"public holiday ({hol[0]['name']})")
    return m, why
