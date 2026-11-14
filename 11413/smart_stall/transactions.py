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

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "transactions.json")
_lock = threading.Lock()
MIN_DAYS = 3          # an hour needs at least this many days of data before we trust it
WINDOW_DAYS = 56      # how far back we look
MAX_ROWS = 200_000


def _read():
    try:
        with open(PATH, encoding="utf-8") as f:
            d = json.load(f)
        return d.get("source", "upload"), [(dt.datetime.fromisoformat(t), float(a)) for t, a in d.get("rows", [])]
    except (FileNotFoundError, ValueError, KeyError):
        return None, []


def _write(source, rows):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": source, "rows": [[t.isoformat(timespec="minutes"), round(a, 2)] for t, a in rows]}, f)
    os.replace(tmp, PATH)


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
        try:
            os.remove(PATH)
        except FileNotFoundError:
            pass


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


def _windows(stats, frac=0.75):
    """Contiguous runs of hours whose expected payments are within `frac` of the busiest hour."""
    if not stats:
        return []
    top = max(v["txn"] for v in stats.values())
    hot = sorted(h for h, v in stats.items() if v["txn"] >= top * frac and top > 0)
    runs = []
    for h in hot:
        if runs and h == runs[-1][1] + 1:
            runs[-1][1] = h
        else:
            runs.append([h, h])
    return [{"start": a, "end": b + 1,
             "txn": round(sum(stats[h]["txn"] for h in range(a, b + 1)), 1)} for a, b in runs]


def past_event_days(today=None):
    """Measured: revenue on past festival/holiday days vs the typical day of the same weekday (festival days excluded)."""
    from . import events as cal
    source, rows = _read()
    today = today or dt.date.today()
    rev = defaultdict(float)
    for t, a in rows:
        if t.date() < today:
            rev[t.date()] += a
    out = []
    for d in sorted(rev):
        evs = cal.EVENTS.get(d)
        if not evs:
            continue
        base = [rev[x] for x in rev if x != d and x.weekday() == d.weekday() and x not in cal.EVENTS]
        base = base or [rev[x] for x in rev if x not in cal.EVENTS]
        if not base:
            continue
        typical = sum(base) / len(base)
        out.append({"date": d.isoformat(), "event": ", ".join(n for n, _ in evs), "revenue": round(rev[d]),
                    "typical": round(typical), "lift_pct": round((rev[d] / typical - 1) * 100) if typical else 0})
    return out


def _weather_factor(w):
    """Footfall multiplier for a day's weather. A planning assumption, stated in the reasons."""
    if not w:
        return 1.0, []
    if w["rain_pct"] >= 60:
        return 0.9, [f"rain likely ({w['rain_pct']}%)"]
    if w["max_c"] >= 38:
        return 0.95, [f"very hot ({round(w['max_c'])}°C)"]
    return 1.0, []


def day_actual(date):
    """Real payments on a past date, per hour. None when there are none."""
    _, rows = _read()
    per = defaultdict(lambda: [0.0, 0])
    for t, a in rows:
        if t.date() == date:
            per[t.hour][0] += a
            per[t.hour][1] += 1
    if not per:
        return None
    return [{"hour": h, "txn": per[h][1], "revenue": round(per[h][0])} for h in sorted(per)]


def analytics(date=None, today=None):
    """Peak-hour view for one chosen date. Future/today: predicted from past payments (same weekday preferred),
    adjusted for calendar and weather. Past date: the actual payments on that day. No data: says so."""
    from . import events as cal, forecast as fc
    today = today or dt.date.today()
    date = date or today
    base = summary()
    out = {"date": date.isoformat(), "weekday": date.strftime("%A"), "count": base["count"],
           "days": base.get("days", 0), "source": base.get("source"), "enough": base.get("enough", False),
           "first": base.get("first"), "last": base.get("last"),
           "past_events": past_event_days(today) if base["count"] else []}
    evs = cal.events_for(date) if cal.covered(date) else []
    w = fc.weather_on(date)
    out.update(events=evs, weather=w, calendar_covered=cal.covered(date), weather_live=w is not None)
    if not base["count"]:
        return {**out, "mode": "none", "hours": [], "windows": [], "message": "No payments added yet."}
    if date < today:
        hours = day_actual(date)
        if not hours:
            return {**out, "mode": "none", "hours": [], "windows": [],
                    "message": "No payments were recorded on this day."}
        stats = {h["hour"]: {"txn": h["txn"], "rev": h["revenue"]} for h in hours}
        return {**out, "mode": "actual", "hours": hours, "windows": _windows(stats),
                "peak_hour": max(hours, key=lambda x: x["txn"])["hour"], "factor": 1.0, "reasons": []}
    # Festival days are left out of the baseline, then the calendar and weather adjust it explicitly.
    stats, meta = hourly_stats(date.weekday(), cal.event_dates(), today)
    if not stats:
        return {**out, "mode": "none", "hours": [], "windows": [],
                "message": f"Not enough payment history to predict a {date.strftime('%A')}. "
                           "Need at least 3 days of payments."}
    ef, ewhy = cal.factor("meal", evs)
    wf, wwhy = _weather_factor(w)
    k = ef * wf
    stats = {h: {**v, "txn": v["txn"] * k, "rev": v["rev"] * k} for h, v in stats.items()}
    hours = [{"hour": h, "txn": round(v["txn"], 1), "revenue": round(v["rev"]), "days": v["days"]}
             for h, v in sorted(stats.items())]
    return {**out, "mode": "predicted", "hours": hours, "windows": _windows(stats),
            "peak_hour": max(hours, key=lambda x: x["txn"])["hour"], "samedow": meta.get("samedow", False),
            "basis_days": meta.get("used_days", 0), "factor": round(k, 2), "reasons": ewhy + wwhy}
