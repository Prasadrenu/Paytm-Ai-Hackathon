"""Saves submitted stall details to a JSON file (data/stall_details.json).

The file is a list of submissions, newest last. Photos are NOT stored, only the confirmed details."""
import datetime as dt
import json
import os
import re
import threading
import uuid

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
    return {"items": items, "open": open_s, "close": close_s, "lang": str(d.get("lang", "en-IN"))[:10]}


def save(d):
    rec = {"id": uuid.uuid4().hex[:8], "saved_at": dt.datetime.now().isoformat(timespec="seconds"), **clean(d)}
    with _lock:
        try:
            with open(PATH, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, list):
                data = []
        except (FileNotFoundError, ValueError):
            data = []
        data.append(rec)
        os.makedirs(os.path.dirname(PATH), exist_ok=True)
        tmp = PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PATH)  # atomic: a crash never leaves a half-written file
    return rec


def load():
    """All saved submissions, newest first."""
    with _lock:
        try:
            with open(PATH, encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, ValueError):
            return []
    return list(reversed(data)) if isinstance(data, list) else []
