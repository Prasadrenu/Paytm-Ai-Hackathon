"""Sudden events (a bandh, a strike, a road closure, a procession) that change how many customers come.

Two ways in:
  * the merchant adds one by hand, or
  * the news is checked (GNews, key in GNEWS_API_KEY) for the stall's city. Sarvam-105B reads the headlines and keeps only
    those that would change a street stall's day, with the date and a guessed effect. These are only SUGGESTIONS: nothing
    changes the plan until the merchant accepts one.

An accepted event is a multiplier on that day's demand (for example 0.6 = 40% fewer customers). The planner treats it like
a festival: it is shown in "Based on", used in the quantities, mentioned in the evening message, and the day is left out of
the "normal day" payment averages and discounted when learning from counts.
Stored in data/stall.db (doc 'special_events' and 'news_suggestions')."""
import datetime as dt
import hashlib
import json
import re
import threading
import time
import uuid

import requests

from . import clients as c, db, store
from .config import GNEWS_KEY, M

KINDS = {"bandh", "strike", "closure", "crowd", "other"}
TTL = 3 * 3600            # the free news plan allows 100 searches a day: look at most every 3 hours
LOOKAHEAD = 3             # only events in the next few days matter
MIN_EFFECT, MAX_EFFECT = -70, 40
TERMS = '(bandh OR hartal OR strike OR curfew OR "road closure" OR "traffic diversion" OR protest OR procession OR rally OR "section 144")'
_lock = threading.Lock()
_refreshing = threading.Lock()


def _today():
    return dt.date.today()


# ---- accepted events
def _events():
    d = db.read_doc("special_events", [])
    return d if isinstance(d, list) else []


def _live(e, today=None):
    today = today or _today()
    return e["date"] >= (today - dt.timedelta(days=1)).isoformat()


def upcoming():
    """Events that are today or later (yesterday's stay one more day so they can still be seen), soonest first."""
    return sorted((e for e in _events() if _live(e)), key=lambda e: e["date"])


def add(date_s, title, effect_pct, kind="other", source="manual", url=None):
    day = dt.date.fromisoformat(str(date_s))
    title = re.sub(r"\s+", " ", str(title or "")).strip()[:80]
    if not title:
        raise ValueError("Say what is happening, for example: Bandh.")
    if day < _today() or day > _today() + dt.timedelta(days=60):
        raise ValueError("Pick a date from today to the next 60 days.")
    pct = max(MIN_EFFECT, min(MAX_EFFECT, int(round(float(effect_pct)))))
    ev = {"id": uuid.uuid4().hex[:8], "date": day.isoformat(), "title": title, "effect_pct": pct,
          "kind": kind if kind in KINDS else "other", "source": source, "url": url}
    with _lock:
        evs = _events()
        evs.append(ev)
        db.write_doc("special_events", evs)
    return ev


def remove(eid):
    with _lock:
        db.write_doc("special_events", [e for e in _events() if e["id"] != eid])


def events_for(day):
    """For the planner: the accepted events on `day`, in the same shape as festival events."""
    return [{"name": e["title"], "kind": "sudden", "when": "today", "mult": round(1 + e["effect_pct"] / 100, 2)}
            for e in _events() if e["date"] == day.isoformat()]


def dates():
    """Dates with a sudden event, so those days are not treated as normal days in the payment averages."""
    return {dt.date.fromisoformat(e["date"]) for e in _events()}


# ---- news suggestions
def _state():
    d = db.read_doc("news_suggestions", {})
    return d if isinstance(d, dict) else {}


def _reverse(lat, lon):
    """City and state for coordinates (OpenStreetMap Nominatim; only the coordinates are sent). Cached on disk."""
    key = f"{round(float(lat), 2)},{round(float(lon), 2)}"
    cache = db.read_doc("geo_cache", {})
    if key in cache:
        return cache[key]
    try:
        r = requests.get("https://nominatim.openstreetmap.org/reverse", timeout=10, headers={"User-Agent": "smart-stall-planner"},
                         params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 12, "accept-language": "en"})
        a = r.json().get("address", {})
    except (requests.RequestException, ValueError):
        return None
    city = a.get("city") or a.get("town") or a.get("village") or a.get("suburb") or a.get("county") or ""
    out = {"city": city, "state": a.get("state", "")} if city else None
    if out:
        cache[key] = out
        db.write_doc("geo_cache", cache)
    return out


def _place():
    """Where the stall is, as search words. A place the merchant searched for ("Madhapur, Ranga Reddy, Telangana") is used
    as it is; a device location ("My current location") is turned into a city and state first."""
    loc = store.latest_location()
    if not loc:
        return None
    parts = [p.strip() for p in str(loc.get("name", "")).split(",") if p.strip()]
    generic = len(parts) < 2 or parts[0].lower().startswith("my current")
    if generic:
        g = _reverse(loc["lat"], loc["lon"])
        if not g:
            return None
        return {"area": g["city"], "state": g["state"], "name": ", ".join(x for x in (g["city"], g["state"]) if x)}
    return {"area": parts[0], "state": parts[-1], "name": loc["name"]}


def _search(place):
    where = " OR ".join(f'"{p}"' for p in dict.fromkeys([place["area"], place["state"]]) if p)
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = requests.get("https://gnews.io/api/v4/search", timeout=12, params={
        "q": f"{TERMS} AND ({where})", "lang": "en", "country": "in", "max": 10, "from": since, "sortby": "publishedAt",
        "apikey": GNEWS_KEY})
    if r.status_code in (401, 403):
        raise PermissionError("The news key was not accepted.")
    if r.status_code == 429:
        raise RuntimeError("The news service limit for today is used up. Try again tomorrow.")
    r.raise_for_status()
    return r.json().get("articles") or []


def _read_news(articles, place):
    """Ask Sarvam-105B which headlines change a street stall's day. Returns only the validated ones."""
    today = _today()
    brief = [{"i": i, "title": a.get("title", "")[:160], "text": (a.get("description") or "")[:260],
              "published": (a.get("publishedAt") or "")[:10]} for i, a in enumerate(articles)]
    prompt = (
        f"Today is {today.isoformat()}. A street-food stall is in {place['name']}, India. Below are recent news items.\n"
        "Keep ONLY items that will happen within the next 3 days (or today) AND are in or very near the stall's city or area AND "
        "would change how many customers walk past: a bandh, hartal, strike, curfew, road closure, traffic diversion, big "
        "procession or rally, a large event. Skip national politics, old events, crime stories and anything far away.\n"
        "For each kept item give: i (its number), kind (bandh, strike, closure, crowd or other), date (YYYY-MM-DD, the day it "
        "affects; use today's date if it is happening now), effect_pct (an integer from -70 to 40: negative means fewer "
        "customers, for example a full bandh -50, a road closure -25, a big rally near the stall +20), short (at most 10 words, "
        "plain English, describing what is happening and where).\n"
        'Return ONLY JSON: {"events": [ ... ]}. Use {"events": []} if nothing qualifies.\n\n' + json.dumps(brief, ensure_ascii=False))
    raw = c.chat(prompt, model=M["chat"], max_tokens=1500)
    a, b = raw.find("{"), raw.rfind("}")
    try:
        data = json.loads(raw[a:b + 1]).get("events", [])
    except ValueError:
        return []
    out = []
    for e in data if isinstance(data, list) else []:
        try:
            art = articles[int(e["i"])]
            day = dt.date.fromisoformat(str(e["date"]))
            pct = max(MIN_EFFECT, min(MAX_EFFECT, int(round(float(e["effect_pct"])))))
        except (KeyError, ValueError, TypeError, IndexError):
            continue
        if not (today <= day <= today + dt.timedelta(days=LOOKAHEAD)):
            continue
        url = art.get("url") or ""
        out.append({"id": hashlib.sha1((url or art.get("title", "")).encode()).hexdigest()[:8], "date": day.isoformat(),
                    "kind": e.get("kind") if e.get("kind") in KINDS else "other", "effect_pct": pct,
                    "title": str(e.get("short") or art.get("title", ""))[:90], "headline": art.get("title", "")[:160],
                    "source": (art.get("source") or {}).get("name", ""), "url": url, "status": "new"})
    return out


def refresh(force=False):
    """Look at the news if it is time (or `force`). Never raises: the outcome is kept in the state for the screen."""
    st = _state()
    if not GNEWS_KEY:
        return st
    if not force and time.time() - st.get("fetched", 0) < TTL:
        return st
    if not _refreshing.acquire(blocking=False):   # another request is already doing it
        return st
    try:
        place = _place()
        if not place:
            st.update(error="Add your stall location in Menu so local news can be checked.", fetched=0)
        else:
            try:
                found = _read_news(_search(place), place)
                old = {x["id"]: x for x in st.get("items", [])}
                st["items"] = [{**x, "status": old[x["id"]]["status"], "announced": old[x["id"]].get("announced", False)} if x["id"] in old else x
                           for x in found]
                st.update(error=None, fetched=time.time(), place=place["name"])
            except PermissionError as e:
                st.update(error=str(e), fetched=time.time())
            except (requests.RequestException, RuntimeError) as e:
                st.update(error=str(e) if isinstance(e, RuntimeError) else "Could not reach the news service.",
                          fetched=time.time() - TTL + 300)   # try again in five minutes
        db.write_doc("news_suggestions", st)
    finally:
        _refreshing.release()
    return st


def view(refresh_now=False):
    st = refresh(force=refresh_now) if refresh_now else _state()
    have = {(e["date"], e["title"].lower()) for e in _events()}
    new = [x for x in st.get("items", []) if x.get("status") == "new" and x["date"] >= _today().isoformat()
           and (x["date"], x["title"].lower()) not in have]
    return {"events": upcoming(), "suggestions": new,
            "news": {"enabled": bool(GNEWS_KEY), "error": st.get("error"), "place": st.get("place"),
                     "stale": bool(GNEWS_KEY) and time.time() - st.get("fetched", 0) >= TTL}}


def _set_status(sid, status):
    with _lock:
        st = _state()
        hit = None
        for x in st.get("items", []):
            if x["id"] == sid:
                x["status"] = status
                hit = x
        db.write_doc("news_suggestions", st)
    return hit


def unannounced():
    """News suggestions not yet sent as an alert (and not ignored)."""
    today = _today().isoformat()
    return [x for x in _state().get("items", []) if not x.get("announced") and x.get("status") != "dismissed" and x["date"] >= today]


def mark_announced(sid):
    with _lock:
        st = _state()
        for x in st.get("items", []):
            if x["id"] == sid:
                x["announced"] = True
        db.write_doc("news_suggestions", st)


def accept(sid):
    st = _state()
    x = next((i for i in st.get("items", []) if i["id"] == sid), None)
    if not x:
        raise ValueError("That suggestion is no longer there.")
    ev = add(x["date"], x["title"], x["effect_pct"], x["kind"], "news", x.get("url"))
    _set_status(sid, "accepted")
    return ev


def dismiss(sid):
    _set_status(sid, "dismissed")
