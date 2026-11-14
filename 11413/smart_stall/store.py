"""Saves submitted stall details to a JSON file (data/stall_details.json).

The file is a list of submissions, newest last. Photos are NOT stored, only the confirmed details."""
import datetime as dt
import json
import os
import re
import threading
import uuid

from . import db, places

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "stall_details.json")
_lock = threading.Lock()
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def clean(d):
    """Validate and normalise one submission. Raises ValueError with a merchant-readable message."""
    items = []
    for it in d.get("items") or []:
        name = str(it.get("name", "")).strip()[:40]
        if not name:
            continue
        price = it.get("price")
        if price in ("", None):
            price = None
        else:
            try:
                price = float(price)
            except (TypeError, ValueError):
                raise ValueError(f"The price for {name} is not a number.")
            if not 0 <= price <= 100000:
                raise ValueError(f"The price for {name} looks wrong.")
        # Optional selling window for this item. Both ends or neither; null means "whenever the stall is open".
        t_from, t_to = it.get("from") or None, it.get("to") or None
        if bool(t_from) != bool(t_to):
            raise ValueError(f"Set both a start and an end time for {name}, or clear them.")
        if t_from and not (_TIME.match(str(t_from)) and _TIME.match(str(t_to))):
            raise ValueError(f"The selling time for {name} is not valid.")
        items.append({"name": name, "price": price, "from": t_from, "to": t_to})
    if not items:
        raise ValueError("Add at least one item before submitting.")
    if len(items) > 30:
        raise ValueError("Please keep it to 30 items or fewer.")
    open_s, close_s = str(d.get("open", "")), str(d.get("close", ""))
    if not (_TIME.match(open_s) and _TIME.match(close_s)):
        raise ValueError("Opening and closing times are needed.")
    return {"items": items, "open": open_s, "close": close_s, "lang": str(d.get("lang", "en-IN"))[:10],
            "location": places.clean(d.get("location"))}


def _all():
    d = db.read_doc("stall_details", [], PATH)
    return d if isinstance(d, list) else []


def save(d):
    rec = {"id": uuid.uuid4().hex[:8], "saved_at": dt.datetime.now().isoformat(timespec="seconds"), **clean(d)}
    with _lock:
        data = _all()
        data.append(rec)
        db.write_doc("stall_details", data)
    return rec


def latest_location():
    """The stall location from the newest submission that has one, else None."""
    for rec in load():
        if rec.get("location"):
            return rec["location"]
    return None


def load():
    """All saved submissions, newest first."""
    with _lock:
        data = _all()
    return list(reversed(data))


def current_menu():
    """The menu to plan from: everything saved on the most recent day it was saved, with that day's hours,
    language and location. None if nothing has been saved. Used by notifications."""
    recs = load()   # newest first
    if not recs:
        return None
    day = recs[0]["saved_at"][:10]
    seen, items = set(), []
    for r in recs:
        if r["saved_at"][:10] != day:
            continue
        for it in r["items"]:
            k = (it["name"].lower(), it.get("from"), it.get("to"))
            if k not in seen:
                seen.add(k)
                items.append(it)
    head = recs[0]
    return {"items": items, "open": head["open"], "close": head["close"], "lang": head["lang"],
            "location": head.get("location")}
