"""Daily notifications: at 8 pm the evening before, tell the stall what to make tomorrow.

* A background thread creates the notification every evening at 8 pm (and catches up if the server was off then).
* The text is built by code from tomorrow's plan, so every number is the plan's number. It lists what to make
  and reminds the merchant to keep the ingredients ready.
* It is translated into the merchant's language and spoken with Bulbul. The audio is saved, so it can be played
  again at any time from the Notifications tab.
* A notification cannot be dismissed. It stays active until the event it is for is over: the shop closing on an
  ordinary day, or the end of the day when a festival falls on it. Then it moves to "Earlier" (still playable) and is
  deleted after 14 days.
Stored in data/notifications.json; audio in data/notification_audio/."""
import datetime as dt
import json
import os
import re
import threading
import time
import uuid

from . import clients as c, db, settings, special, stallplan, store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "notifications.json")
AUDIO = os.path.join(os.environ.get("DATA_DIR") or os.path.join(ROOT, "data"), "notification_audio")
NOTIFY_HOUR = 20          # 8 pm
KEEP_DAYS = 14
MAX_ITEMS = 8             # items named in the message; the rest are counted
_lock, _gen_lock = threading.Lock(), threading.Lock()


def _read():
    d = db.read_doc("notifications", [], PATH)
    return d if isinstance(d, list) else []


def _write(recs):
    db.write_doc("notifications", recs)


def _closing(day, open_s, close_s):
    """When the shop closes on `day`; a closing time at or before opening means it closes after midnight."""
    ch, cm = (int(x) for x in close_s.split(":")[:2])
    oh, om = (int(x) for x in open_s.split(":")[:2])
    end = dt.datetime.combine(day, dt.time(ch, cm))
    return end + dt.timedelta(days=1) if (ch, cm) <= (oh, om) else end


def _expiry(day, open_s, close_s, fests):
    """(when the notification stops being active, why). Ordinary day: when the shop closes. Festival day: the
    festival is the event, so it stays until that day is over."""
    shop = _closing(day, open_s, close_s)
    if fests:
        end = dt.datetime.combine(day, dt.time(23, 59, 59))
        if end > shop:
            return end, "event"
    return shop, "shop"


def compose(plan):
    """(items, english text) from tomorrow's plan. Quantities are summed per item across the parts of the day."""
    totals = {}
    for slot in plan["slots"]:
        for it in slot["items"]:
            k = it["name"].strip().lower()
            totals.setdefault(k, [it["name"].strip(), 0])[1] += it["make"]
    items = sorted(totals.values(), key=lambda t: -t[1])
    parts = [f"{q} {n}" for n, q in items[:MAX_ITEMS]]
    phrase = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
    extra = len(items) - MAX_ITEMS
    if extra > 0:
        phrase += f" and {extra} more {'item' if extra == 1 else 'items'}"
    fests = [e["name"] for e in plan["basis"]["events"] if e["when"] == "tomorrow" and e["kind"] in ("major", "minor")]
    text = f"Tomorrow, {plan['weekday']}, you will need to make {phrase}."
    if fests:
        text += f" {' and '.join(fests)} is tomorrow, so it may be busier."
    for e in plan["basis"]["events"]:
        if e["kind"] == "sudden" and e["when"] == "tomorrow":
            text += f" Because of {e['name']}, expect {'fewer' if e['mult'] < 1 else 'more'} customers, so the amounts are adjusted."
    text += " Please keep the ingredients ready for tomorrow."
    return [{"name": n, "make": q} for n, q in items], text, fests


def generate():
    """Create (or replace) tomorrow's notification from the saved menu. Raises ValueError if there is no menu."""
    menu = store.current_menu()
    if not menu:
        raise ValueError("Save your menu first, then notifications can tell you what to make tomorrow.")
    with _gen_lock:
        try:
            special.refresh()   # a bandh announced this evening should be in tonight's message (suggestions need accepting)
        except Exception:
            pass
        today = dt.date.today()
        day = today + dt.timedelta(days=1)
        want = settings.get_lang() or menu["lang"]
        plan = stallplan.run("", [], menu["open"], menu["close"], want, items=menu["items"], when="tomorrow",
                             location=menu["location"], with_messages=False)
        items, en, fests = compose(plan)
        expires, until = _expiry(day, menu["open"], menu["close"], fests)
        lang, local = want, ""
        if lang != "en-IN":
            try:
                local = stallplan.localise(en, lang)
            except Exception:
                local = ""
        spoken, spoken_lang = (local, lang) if local else (en, "en-IN")
        nid = uuid.uuid4().hex[:8]
        has_audio = False
        try:
            os.makedirs(AUDIO, exist_ok=True)
            with open(os.path.join(AUDIO, nid + ".wav"), "wb") as f:
                f.write(c.tts(spoken, spoken_lang))
            has_audio = True
        except Exception:
            pass
        rec = {"id": nid, "for_date": day.isoformat(), "weekday": plan["weekday"],
               "created_at": dt.datetime.now().isoformat(timespec="seconds"),
               "expires_at": expires.isoformat(timespec="seconds"), "until": until,
               "message_en": en, "message_local": local, "lang": spoken_lang, "items": items, "events": fests,
               "audio": has_audio, "seen": False}
        with _lock:
            recs = _read()
            same = lambda n: n["for_date"] == rec["for_date"] and n.get("kind", "plan") == "plan"
            for old in [n for n in recs if same(n)]:   # one plan per day: replace
                _drop_audio(old["id"])
            recs = [n for n in recs if not same(n)] + [rec]
            _write(recs)
    return _public(rec)


def _day_word(day):
    d = (day - dt.date.today()).days
    return "today" if d <= 0 else "tomorrow" if d == 1 else f"on {day.strftime('%A')}"


def alert(item):
    """A notification for a bandh, strike or road closure found in the news: what, when, and what it does to sales.
    Spoken and written in the merchant's language, like the evening plan."""
    day = dt.date.fromisoformat(item["date"])
    fewer = item["effect_pct"] < 0
    en = (f"Alert: {item['title']} {_day_word(day)}. Expect {'fewer' if fewer else 'more'} customers, "
          f"about {abs(item['effect_pct'])}% {'less' if fewer else 'more'} than usual. "
          f"Open Smart Planner and press Use in plan, so the amounts are {'reduced' if fewer else 'increased'}.")
    menu = store.current_menu()
    want = settings.get_lang() or (menu or {}).get("lang") or "en-IN"
    local = ""
    if want != "en-IN":
        try:
            local = stallplan.localise(en, want)
        except Exception:
            local = ""
    spoken, spoken_lang = (local, want) if local else (en, "en-IN")
    nid, has_audio = uuid.uuid4().hex[:8], False
    try:
        os.makedirs(AUDIO, exist_ok=True)
        with open(os.path.join(AUDIO, nid + ".wav"), "wb") as f:
            f.write(c.tts(spoken, spoken_lang))
        has_audio = True
    except Exception:
        pass
    rec = {"id": nid, "kind": "alert", "for_date": day.isoformat(), "weekday": day.strftime("%A"),
           "created_at": dt.datetime.now().isoformat(timespec="seconds"),
           "expires_at": dt.datetime.combine(day, dt.time(23, 59, 59)).isoformat(timespec="seconds"), "until": "event",
           "message_en": en, "message_local": local, "lang": spoken_lang, "items": [], "events": [item["title"]],
           "audio": has_audio, "seen": False}
    with _lock:
        _write(_read() + [rec])
    return _public(rec)


def check_alerts():
    """Look at the news (at most every few hours) and send one alert for each new bandh or strike found for the stall's area."""
    special.refresh()
    for item in special.unannounced():
        try:
            alert(item)
            special.mark_announced(item["id"])
        except Exception:
            pass   # try again on the next pass


def _drop_audio(nid):
    try:
        os.remove(os.path.join(AUDIO, nid + ".wav"))
    except OSError:
        pass


def _public(n):
    out = {k: n[k] for k in ("id", "for_date", "weekday", "created_at", "expires_at", "message_en", "message_local",
                             "lang", "items", "events", "audio", "seen")}
    out["kind"] = n.get("kind", "plan")   # "plan" = tomorrow's quantities, "alert" = a bandh or strike near the stall
    out["until"] = n.get("until", "shop")   # "event" = kept until the festival day is over, "shop" = until closing time
    return out


def snapshot():
    """Active notifications (before the shop closes on their day) and earlier ones, newest first."""
    now = dt.datetime.now()
    with _lock:
        recs = _read()
        keep = [n for n in recs if dt.datetime.fromisoformat(n["expires_at"]) + dt.timedelta(days=KEEP_DAYS) > now]
        if len(keep) != len(recs):
            for n in recs:
                if n not in keep:
                    _drop_audio(n["id"])
            _write(keep)
        recs = keep
    active = sorted((n for n in recs if dt.datetime.fromisoformat(n["expires_at"]) > now), key=lambda n: n["for_date"])
    earlier = sorted((n for n in recs if dt.datetime.fromisoformat(n["expires_at"]) <= now), key=lambda n: n["for_date"], reverse=True)
    return {"active": [_public(n) for n in active], "earlier": [_public(n) for n in earlier],
            "unseen": sum(1 for n in active if not n["seen"]), "notify_hour": NOTIFY_HOUR}


def mark_seen():
    with _lock:
        recs = _read()
        for n in recs:
            n["seen"] = True
        _write(recs)


def audio_path(nid):
    if not re.fullmatch(r"[0-9a-f]{8}", nid or ""):
        return None
    p = os.path.join(AUDIO, nid + ".wav")
    return p if os.path.isfile(p) else None


def needs_generation(now, recs):
    """True from 8 pm onwards when tomorrow has no notification yet (so a late start still catches up)."""
    tomorrow = (now.date() + dt.timedelta(days=1)).isoformat()
    return now.hour >= NOTIFY_HOUR and not any(n["for_date"] == tomorrow and n.get("kind", "plan") == "plan" for n in recs)


def _loop():
    retry_after = 0.0
    while True:
        try:
            check_alerts()
        except Exception:
            pass
        try:
            if time.time() >= retry_after:
                with _lock:
                    due = needs_generation(dt.datetime.now(), _read())
                if due:
                    try:
                        generate()
                    except ValueError:
                        retry_after = time.time() + 600     # no menu saved yet: look again in 10 minutes
                    except Exception:
                        retry_after = time.time() + 300     # e.g. offline: try again in 5 minutes
        except Exception:
            pass
        time.sleep(30)


def start_scheduler():
    """Runs for the life of the server: every evening from 8 pm, make sure tomorrow's notification exists."""
    threading.Thread(target=_loop, daemon=True, name="notifier").start()
