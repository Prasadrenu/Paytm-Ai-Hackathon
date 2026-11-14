"""Payment (transaction) history for the stall: stored in data/transactions.json.

A Soundbox payment only has a time and an amount, so that is all we keep. The planner learns from
these: how busy each hour is on this stall, by weekday, skipping festival days as 'normal' baselines."""
import csv
import datetime as dt
import io
import json
import os
import random
import re
import threading
from collections import defaultdict

from . import db

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "transactions.json")
_lock = threading.Lock()
MIN_DAYS = 3          # an hour needs at least this many days of data before we trust it
WINDOW_DAYS = 56      # how far back we look
MAX_ROWS = 200_000


def _read():
    db.import_legacy_payments(PATH)
    rows = db.all_payments()
    if not rows:
        return None, []
    return db.get_meta("payment_source", "upload"), [(dt.datetime.fromisoformat(t), float(a)) for t, a in rows]


def _write(source, rows):
    db.replace_payments([(t.isoformat(timespec="minutes"), round(a, 2)) for t, a in rows], source)


def parse_csv(text):
    """CSV with a time column (timestamp / time / date / datetime) and an amount column. Returns rows."""
    text = text.lstrip("﻿")
    rd = csv.DictReader(io.StringIO(text))
    if not rd.fieldnames:
        raise ValueError("The file is empty.")
    cols = {re.sub(r"[^a-z]", "", (n or "").lower()): n for n in rd.fieldnames}
    tcol = next((cols[k] for k in ("timestamp", "datetime", "time", "date", "paidat", "createdat") if k in cols), None)
    acol = next((cols[k] for k in ("amount", "amt", "value", "total", "inr", "rs") if k in cols), None)
    if not tcol or not acol:
        raise ValueError("I need two columns: a time (timestamp) and an amount. Found: " + ", ".join(rd.fieldnames)[:120])
    rows, bad = [], 0
    for r in rd:
        try:
            t = dt.datetime.fromisoformat(str(r[tcol]).strip().replace("Z", ""))
            a = float(str(r[acol]).replace(",", "").replace("₹", "").strip())
        except (ValueError, TypeError):
            bad += 1
            continue
        if a > 0:
            rows.append((t.replace(tzinfo=None), a))
        if len(rows) > MAX_ROWS:
            raise ValueError("That file has too many rows. Keep it under 200,000.")
    if not rows:
        raise ValueError("No valid rows found. Use times like 2026-11-10 17:45 and positive amounts.")
    return rows


def replace(rows, source="upload"):
    with _lock:
        _write(source, sorted(rows))


def clear():
    with _lock:
        db.import_legacy_payments(PATH)   # so an old file is not brought back after a clear
        db.clear_payments()


def demo_rows(today=None, days=28):
    """SYNTHETIC history: a believable street stall (morning chai, lunch, evening rush, busier weekends)."""
    today = today or dt.date.today()
    rnd = random.Random(7)
    curve = {7: 4, 8: 9, 9: 8, 10: 5, 11: 6, 12: 11, 13: 12, 14: 7, 15: 6, 16: 9, 17: 15, 18: 19, 19: 17, 20: 11, 21: 5}
    rows = []
    for back in range(days, 0, -1):
        d = today - dt.timedelta(days=back)
        day_f = (1.3 if d.weekday() >= 5 else 1.0) * rnd.uniform(.85, 1.15)
        for h, base in curve.items():
            for _ in range(max(0, round(base * day_f + rnd.uniform(-2, 2)))):
                t = dt.datetime(d.year, d.month, d.day, h, rnd.randrange(60))
                rows.append((t, float(rnd.choice([10, 10, 15, 15, 20, 30, 30, 45, 60, 80, 120]))))
    return rows


def hourly_stats(weekday, skip_dates, today=None):
    """Average revenue per clock hour from past days. Returns (stats, meta) or (None, meta) with no data.

    stats[h] = {rev, txn, days, samedow}. Only hours with >= MIN_DAYS of data are included.
    Same-weekday days are preferred (at least 2 of them), festival days are skipped when enough remain."""
    source, rows = _read()
    today = today or dt.date.today()
    if not rows:
        return None, {"days": 0, "source": None}
    cut = today - dt.timedelta(days=WINDOW_DAYS)
    per = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))   # date -> hour -> [revenue, count]
    for t, a in rows:
        if cut <= t.date() < today:
            cell = per[t.date()][t.hour]
            cell[0] += a
            cell[1] += 1
    dates = sorted(per)
    meta = {"days": len(dates), "source": source}
    if len(dates) < MIN_DAYS:
        return None, meta
    pool = [d for d in dates if d not in skip_dates]
    if len(pool) >= MIN_DAYS:
        dates = pool
    same = [d for d in dates if d.weekday() == weekday]
    use, samedow = (same, True) if len(same) >= 2 else (dates, False)
    stats = {}
    for h in range(24):
        revs, cnts = [], []
        for d in use:
            hrs = per[d]
            if not hrs or not (min(hrs) <= h <= max(hrs)):
                continue  # stall wasn't trading that hour on that day
            revs.append(hrs[h][0] if h in hrs else 0.0)
            cnts.append(hrs[h][1] if h in hrs else 0)
        if len(revs) >= MIN_DAYS or (samedow and len(revs) >= 2):
            stats[h] = {"rev": sum(revs) / len(revs), "txn": sum(cnts) / len(cnts), "days": len(revs), "samedow": samedow}
    meta.update(used_days=len(use), samedow=samedow, hours=len(stats))
    return (stats or None), meta


def summary():
    """For the Payments page: totals plus the average revenue and count per hour over all stored days."""
    source, rows = _read()
    if not rows:
        return {"count": 0, "days": 0, "source": None, "hourly": []}
    per = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for t, a in rows:
        cell = per[t.date()][t.hour]
        cell[0] += a
        cell[1] += 1
    hourly = []
    for h in range(24):
        v = [per[d][h] for d in per if h in per[d]]
        if v:
            hourly.append({"hour": h, "avg_revenue": round(sum(x[0] for x in v) / len(per), 1),
                           "avg_txn": round(sum(x[1] for x in v) / len(per), 1)})
    dates = sorted(per)
    return {"count": len(rows), "days": len(dates), "first": dates[0].isoformat(), "last": dates[-1].isoformat(),
            "total": round(sum(a for _, a in rows)), "source": source, "hourly": hourly,
            "enough": len(dates) >= MIN_DAYS}


def rows():
    """(source, [(datetime, amount)]) for everything stored. Used by analytics."""
    return _read()
