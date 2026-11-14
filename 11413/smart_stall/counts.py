"""Daily counts: what the stall MADE before a time period and what was LEFT at its end.

sold = made - left (cash sales included, which a Soundbox cannot see). One record per (date, part of day).
Each record also keeps the conditions of that day (weather for those hours, festivals, weekend) so the
planner can later separate "it sold well because of Diwali" from "it sells well here"."""
import datetime as dt
import difflib
import json
import os
import re
import threading

from . import clients as c, db
from .config import M

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "daily_counts.json")
_lock = threading.Lock()
PARTS = {"Morning": list(range(6, 11)), "Afternoon": list(range(11, 16)), "Evening": list(range(16, 21)),
         "Night": [21, 22, 23], "Whole day": list(range(6, 23))}
STOCKOUT_LIFT = 1.15     # sold out = true demand was at least what sold; lift it a little
MAX_QTY = 100_000
WINDOW_DAYS = 60


def key(name):
    return re.sub(r"\s+", " ", str(name).strip().lower())


def _read():
    d = db.read_doc("daily_counts", [], PATH)
    return d if isinstance(d, list) else []


def _write(recs):
    db.write_doc("daily_counts", recs)


def _items(items):
    """[{name, qty}] -> {key: {name, qty}} with validation. Later duplicates win."""
    out = {}
    for it in items or []:
        name = str(it.get("name", "")).strip()[:40]
        if not name:
            continue
        try:
            q = float(it.get("qty"))
        except (TypeError, ValueError):
            raise ValueError(f"The quantity for {name} is not a number.")
        if q != int(q) or not 0 <= q <= MAX_QTY:
            raise ValueError(f"The quantity for {name} should be a whole number from 0 to {MAX_QTY:,}.")
        out[key(name)] = {"name": name, "qty": int(q)}
    if not out:
        raise ValueError("Add at least one item with a quantity.")
    return out


def _check(rec):
    for k, l in (rec.get("left") or {}).items():
        m = (rec.get("made") or {}).get(k)
        if m and l["qty"] > m["qty"]:
            raise ValueError(f"{l['name']}: {l['qty']} left is more than the {m['qty']} you made.")


def save(date_s, part, kind, items, ctx):
    """kind 'start' stores what was made, 'end' what is left. Re-saving replaces that half."""
    try:
        day = dt.date.fromisoformat(date_s)
    except (TypeError, ValueError):
        raise ValueError("Pick a valid date.")
    if day > dt.date.today():
        raise ValueError("You cannot log counts for a future day.")
    if day < dt.date.today() - dt.timedelta(days=400):
        raise ValueError("That date is too far back.")
    if part not in PARTS:
        raise ValueError("Pick a part of the day.")
    if kind not in ("start", "end"):
        raise ValueError("Count type must be start or end.")
    new = _items(items)
    with _lock:
        recs = _read()
        rec = next((r for r in recs if r["date"] == date_s and r["part"] == part), None)
        if rec is None:
            if kind == "end":
                raise ValueError(f"Save the start count for {part} first (what you made), then the end count.")
            rec = {"date": date_s, "part": part, "made": {}, "left": {}}
            recs.append(rec)
        rec["made" if kind == "start" else "left"] = new
        rec.update(hours=ctx["hours"], weather=ctx.get("weather"), events=ctx.get("events", []),
                   weekend=ctx["weekend"], saved_at=dt.datetime.now().isoformat(timespec="seconds"))
        _check(rec)
        _write(recs)
    return view(rec)


def view(rec):
    """A record as the UI wants it: one row per item with made / left / sold."""
    rows = []
    for k, m in rec["made"].items():
        l = rec["left"].get(k)
        sold = m["qty"] - l["qty"] if l else None
        rows.append({"name": m["name"], "made": m["qty"], "left": l["qty"] if l else None, "sold": sold,
                     "stockout": bool(l and l["qty"] == 0 and m["qty"] > 0)})
    for k, l in rec["left"].items():   # left without a matching made (only if the start was edited later)
        if k not in rec["made"]:
            rows.append({"name": l["name"], "made": None, "left": l["qty"], "sold": None, "stockout": False})
    return {"date": rec["date"], "part": rec["part"], "items": rows, "complete": bool(rec["left"]),
            "saved_at": rec.get("saved_at")}


def load(days=30):
    cut = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    with _lock:
        recs = [r for r in _read() if r["date"] >= cut]
    recs.sort(key=lambda r: (r["date"], list(PARTS).index(r["part"])), reverse=True)
    return [view(r) for r in recs]


def made_for(date_s, part):
    """Names and quantities already saved as 'made' for this day and part (to prefill the end count)."""
    with _lock:
        rec = next((r for r in _read() if r["date"] == date_s and r["part"] == part), None)
    return [{"name": m["name"], "made": m["qty"]} for m in (rec or {}).get("made", {}).values()]


def history(before, today=None):
    """Complete records (start and end both saved) on days before `before`, for the planner to learn from."""
    today = today or dt.date.today()
    cut = (today - dt.timedelta(days=WINDOW_DAYS)).isoformat()
    with _lock:
        recs = _read()
    return [r for r in recs if r.get("left") and r.get("made") and cut <= r["date"] < before.isoformat()]


def parse_spoken(text, kind, known):
    """Free speech or typing -> [{name, qty, matched}]. The model only reads; it must not invent counts."""
    what = ("the quantity MADE (prepared) before the period starts" if kind == "start"
            else "the quantity LEFT (remaining unsold) at the end of the period")
    prompt = ("Read this message from a stall owner about " + what + ". List EVERY item that has a number in the text, "
              "including items that are not in the known list. Return ONLY a JSON array like "
              '[{"name":"Samosa","qty":100}], nothing else. qty is a whole number: convert number words from any Indian '
              "language into digits (ek=1, do=2, teen=3, char=4, paanch=5, das=10, bees=20, tees=30, chalis=40, pachas=50, "
              "saath=60, sattar=70, assi=80, nabbe=90, sau=100, do sau=200, dhai sau=250). "
              "The known list is only for spelling: if an item clearly means the same as a known one (other spelling or "
              "language), use the known name exactly. Never drop an item and never invent one.\n"
              "Known list: " + json.dumps(known[:40], ensure_ascii=False) + "\n\nMessage: " + text[:2000])
    raw = c.chat(prompt, model=M["gemma"], max_tokens=1000)
    a, b = raw.find("["), raw.rfind("]")
    try:
        data = json.loads(raw[a:b + 1]) if a >= 0 and b > a else []
    except ValueError:
        data = []
    low = {key(k): k for k in known}
    out, seen = [], set()
    for d in data:
        if not isinstance(d, dict) or not str(d.get("name", "")).strip():
            continue
        try:
            q = int(round(float(d.get("qty"))))
        except (TypeError, ValueError):
            continue
        if not 0 <= q <= MAX_QTY:
            continue
        name = str(d["name"]).strip()[:40]
        k = key(name)
        if k not in low:   # near-miss spelling -> the menu item it most likely means
            close = difflib.get_close_matches(k, list(low), n=1, cutoff=0.8)
            if close:
                name, k = low[close[0]], close[0]
        if k in seen:
            continue
        seen.add(k)
        out.append({"name": low.get(k, name), "qty": q, "matched": k in low})
    return out


def records_on(date_s):
    """Views of every part logged on this day (what the merchant counted), in time-of-day order."""
    with _lock:
        recs = [r for r in _read() if r["date"] == date_s]
    recs.sort(key=lambda r: list(PARTS).index(r["part"]))
    return [view(r) for r in recs]
