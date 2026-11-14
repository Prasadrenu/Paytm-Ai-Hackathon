"""Analytics: what your payments say about busy hours, and what moved sales on past days.

1. Every day of payment history is tagged with its calendar context (festival, public holiday, the day before
   a major festival, weekend) and the real weather that day (Open-Meteo history).
2. From those tags we MEASURE the lift each one gave: a day's revenue is compared with a normal day of the
   same kind (weekday or weekend), then averaged over the days with that tag. A lift is only used once there are
   at least 3 such days AND it is clearly bigger than normal day-to-day swings.
3. For any chosen date we take the hourly payment pattern of comparable normal days (the same weekday when there
   are enough), scale it by the measured lifts for that date's calendar and weather, and mark the busiest hours:
   those within 25% of the busiest hour.

Nothing here is guessed: a calendar or weather effect that your payments cannot yet confirm is listed as
"not measured yet" and applies no change."""
import datetime as dt
import math
import statistics
import threading
import time
from collections import defaultdict

import requests

from . import events as cal, places, store, transactions as tx

WINDOW_DAYS = 60        # matches how much past weather the free API returns
RAIN_MM = 2.0           # a day with at least this much rain counts as rainy
HOT_C = 34.0
RAIN_PROB = 60          # forecast: this chance of rain or more counts as rainy
MIN_DAYS = 3            # tagged days needed before a lift is used
CLEAR = 2.0             # a lift must be this many standard errors away from zero, so noise is not applied
PEAK_WITHIN = 0.75      # peak hours are those with at least 75% of the busiest hour's payments
HORIZON_DAYS = 90       # how far ahead a date can be picked
LABELS = {"festival": "Festival days", "holiday": "Public holidays", "eve": "Day before a major festival",
          "weekend": "Weekends", "rain": "Rainy days", "hot": "Hot days (34°C and above)"}
DAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
_cache, _lock = {}, threading.Lock()


def weather_days(lat, lon):
    """{date: {max_c, rain_mm, rain_pct}} for the last 60 days (recorded) and the next 7 (forecast)."""
    key = (round(lat, 2), round(lon, 2))
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < 1800:
        return hit[1]
    try:
        r = requests.get("https://api.open-meteo.com/v1/forecast", timeout=15, params={
            "latitude": lat, "longitude": lon, "past_days": WINDOW_DAYS, "forecast_days": 7, "timezone": "auto",
            "daily": "temperature_2m_max,precipitation_sum,precipitation_probability_max"})
        r.raise_for_status()
        d = r.json()["daily"]
    except Exception:
        return {}
    out = {}
    for i, t in enumerate(d["time"]):
        out[dt.date.fromisoformat(t)] = {"max_c": d["temperature_2m_max"][i], "rain_mm": d["precipitation_sum"][i],
                                         "rain_pct": d["precipitation_probability_max"][i]}
    with _lock:
        _cache[key] = (time.time(), out)
    return out


def tags_for(day, wx):
    """Which of festival / holiday / eve / weekend / rain / hot apply to this date."""
    kinds = {k for _, k in cal.EVENTS.get(day, [])}
    nxt = {k for _, k in cal.EVENTS.get(day + dt.timedelta(days=1), [])}
    tags = set()
    if kinds & {"major", "minor"}:
        tags.add("festival")
    if "holiday" in kinds:
        tags.add("holiday")
    if "major" in nxt:
        tags.add("eve")
    if day.weekday() >= 5:
        tags.add("weekend")
    w = wx.get(day)
    if w:
        if (w["rain_mm"] or 0) >= RAIN_MM or (w["rain_pct"] or 0) >= RAIN_PROB:
            tags.add("rain")
        if (w["max_c"] or 0) >= HOT_C:
            tags.add("hot")
    return tags


def _normal(tags):
    return not (tags & {"festival", "holiday", "eve", "rain", "hot"})


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _se(xs):
    return statistics.stdev(xs) / math.sqrt(len(xs)) if len(xs) >= 2 else 0.0


def baselines(days):
    """Average revenue of a normal weekday and a normal weekend day: {False: weekday, True: weekend}."""
    allrev = [d["revenue"] for d in days]
    base = {}
    for wk in (False, True):
        normal = [d["revenue"] for d in days if _normal(d["tags"]) and ("weekend" in d["tags"]) == wk]
        same = [d["revenue"] for d in days if ("weekend" in d["tags"]) == wk]
        base[wk] = _mean(normal) or _mean(same) or _mean(allrev)
    return base


def measure_lifts(days, base):
    """Lift of each tag over a normal day of the same kind (weekday/weekend).

    status: 'measured' (3+ days and clearly above day-to-day noise), 'weak' (3+ days but within the noise),
    or 'few' (under 3 days). Only 'measured' lifts are applied to forecasts."""
    def status(n, m, se):
        if n < MIN_DAYS:
            return "few"
        return "measured" if (se == 0 or abs(m) >= CLEAR * se) else "weak"

    out = {}
    for tag in ("festival", "holiday", "eve", "rain", "hot"):
        hit = [d["revenue"] / base["weekend" in d["tags"]] - 1 for d in days if tag in d["tags"] and base["weekend" in d["tags"]]]
        m = _mean(hit)
        out[tag] = {"days": len(hit), "lift": m, "status": status(len(hit), m, _se(hit))}
    wk_n = [d["revenue"] for d in days if _normal(d["tags"]) and "weekend" not in d["tags"]]
    we_n = [d["revenue"] for d in days if _normal(d["tags"]) and "weekend" in d["tags"]]
    if wk_n and we_n:
        m = _mean(we_n) / _mean(wk_n) - 1
        se = math.sqrt(_se(we_n) ** 2 + _se(wk_n) ** 2) / _mean(wk_n) if len(wk_n) >= 2 and len(we_n) >= 2 else 0.0
        out["weekend"] = {"days": len(we_n), "lift": m, "status": status(min(len(we_n), len(wk_n)), m, se)}
    else:
        out["weekend"] = {"days": len(we_n), "lift": 0.0, "status": "few"}
    for v in out.values():
        v["reliable"] = v["status"] == "measured"
    return out


def profile(days, per_hour, weekend, weekday=None):
    """Average payments and revenue per hour on comparable normal days.

    Returns ({hour: {...}}, text, n) where text reads like '4 past Saturdays'."""
    pool = [d for d in days if _normal(d["tags"]) and weekday is not None and d["date"].weekday() == weekday]
    text = lambda n: f"{n} past {DAYS[weekday]}"
    if len(pool) < MIN_DAYS:
        pool = [d for d in days if _normal(d["tags"]) and ("weekend" in d["tags"]) == weekend]
        text = lambda n: f"{n} comparable {'weekend' if weekend else 'weekday'} days"
    if len(pool) < 2:
        pool = [d for d in days if ("weekend" in d["tags"]) == weekend]
    if len(pool) < 2:
        pool, text = days, (lambda n: f"{n} days")
    out = {}
    for h in range(24):
        rev, cnt = [], []
        for d in pool:
            hrs = per_hour[d["date"]]
            if not hrs or not (min(hrs) <= h <= max(hrs)):
                continue   # not trading that hour on that day
            rev.append(hrs[h][0] if h in hrs else 0.0)
            cnt.append(hrs[h][1] if h in hrs else 0)
        if len(rev) >= 2:
            out[h] = {"revenue": _mean(rev), "payments": _mean(cnt), "days": len(rev)}
    return out, text(len(pool)), len(pool)


def _context(location=None):
    """Everything the page needs from the stored payments, or None when there is not enough history."""
    source, rows = tx.rows()
    loc = location or store.latest_location()
    default_loc = loc is None
    loc = loc or places.DEFAULT
    today = dt.date.today()
    cut = today - dt.timedelta(days=WINDOW_DAYS)
    per_hour = defaultdict(dict)
    for t, a in rows:
        if cut <= t.date() < today:
            cell = per_hour[t.date()].setdefault(t.hour, [0.0, 0])
            cell[0] += a
            cell[1] += 1
    ctx = {"location": {"name": loc["name"], "default": default_loc}, "source": source, "today": today,
           "ndays": len(per_hour)}
    if len(per_hour) < 2:
        return ctx
    wx = weather_days(loc["lat"], loc["lon"])
    days = []
    for d in sorted(per_hour):
        hrs = per_hour[d]
        days.append({"date": d, "revenue": sum(v[0] for v in hrs.values()), "payments": sum(v[1] for v in hrs.values()),
                     "peak_hour": max(hrs, key=lambda h: hrs[h][1]), "tags": tags_for(d, wx), "weather": wx.get(d)})
    base = baselines(days)
    ctx.update(days=days, per_hour=per_hour, wx=wx, base=base, lifts=measure_lifts(days, base))
    return ctx


def _factor_label(tag, d):
    ev = cal.EVENTS.get(d, [])
    nxt = cal.EVENTS.get(d + dt.timedelta(days=1), [])
    if tag == "festival":
        return ", ".join(n for n, k in ev if k in ("major", "minor"))
    if tag == "holiday":
        return ", ".join(n for n, k in ev if k == "holiday")
    if tag == "eve":
        return "Eve of " + next(n for n, k in nxt if k == "major")
    return {"rain": "Rain forecast", "hot": "Hot day forecast"}[tag]


def predict(ctx, d):
    """Busiest hours for date d, from payments on comparable days, scaled by that date's calendar and weather."""
    wx, days, per_hour, lifts = ctx["wx"], ctx["days"], ctx["per_hour"], ctx["lifts"]
    tg = tags_for(d, wx)
    prof, text, npool = profile(days, per_hour, "weekend" in tg, d.weekday())
    factors, level = [], 1.0
    for tag in ("festival", "holiday", "eve", "rain", "hot"):
        if tag not in tg:
            continue
        m = lifts[tag]
        f = {"label": _factor_label(tag, d), "tag": tag, "days": m["days"], "status": m["status"], "measured": m["reliable"],
             "lift": round(m["lift"] * 100) if m["reliable"] else None}
        if m["reliable"]:
            level *= 1 + m["lift"]
        factors.append(f)
    level = max(0.5, min(2.0, level))
    hours = [{"hour": h, "payments": round(v["payments"] * level, 1), "revenue": round(v["revenue"] * level, 1)}
             for h, v in sorted(prof.items())]
    top = max((h["payments"] for h in hours), default=0)
    for h in hours:
        h["peak"] = top > 0 and h["payments"] >= PEAK_WITHIN * top
    runs, cur = [], []
    for h in hours:
        if h["peak"] and (not cur or h["hour"] == cur[-1]["hour"] + 1):
            cur.append(h)
        else:
            if cur:
                runs.append(cur)
            cur = [h] if h["peak"] else []
    if cur:
        runs.append(cur)
    runs = [{"start": r[0]["hour"], "end": r[-1]["hour"] + 1, "payments": round(sum(h["payments"] for h in r))} for r in runs]
    main = max(runs, key=lambda r: r["payments"]) if runs else None
    # Calendar chips: events on the day, plus "Eve of ..." for any festival tomorrow.
    chips = [{"name": n, "kind": k, "eve": False} for n, k in cal.EVENTS.get(d, [])]
    chips += [{"name": "Eve of " + n, "kind": k, "eve": True}
              for n, k in cal.EVENTS.get(d + dt.timedelta(days=1), []) if k in ("major", "minor")]
    w = wx.get(d)
    return {
        "date": d.isoformat(), "weekday": d.strftime("%A"), "is_today": d == ctx["today"], "events": chips,
        "weather": ({"max_c": w["max_c"], "rain_pct": w["rain_pct"], "rain_mm": w["rain_mm"], "recorded": d < ctx["today"]}
                    if w and w["max_c"] is not None else None),
        "hours": hours, "runs": runs, "rush": main, "factors": factors,
        "pattern": {"text": text, "days": npool, "weekday": DAYS[d.weekday()]},
    }


def compute(location=None, date=None):
    ctx = _context(location)
    out = {"has_data": False, "location": ctx["location"], "days": ctx["ndays"], "enough": False}
    if "days" not in ctx:
        return out
    today, days, base, lifts = ctx["today"], ctx["days"], ctx["base"], ctx["lifts"]
    first = days[0]["date"]
    d = date or today
    if not (first <= d <= today + dt.timedelta(days=HORIZON_DAYS)):
        raise ValueError(f"Pick a date between {first.isoformat()} and {(today + dt.timedelta(days=HORIZON_DAYS)).isoformat()}.")
    wk_label = lambda tags: "weekend" if "weekend" in tags else "weekday"
    fest = []
    for x in reversed(days):
        if x["tags"] & {"festival", "holiday"}:
            b = base["weekend" in x["tags"]]
            fest.append({"date": x["date"].isoformat(), "weekday": x["date"].strftime("%a"),
                         "events": [n for n, k in cal.EVENTS.get(x["date"], []) if k in ("major", "minor", "holiday")],
                         "revenue": round(x["revenue"]), "payments": x["payments"], "peak_hour": x["peak_hour"],
                         "vs_normal": round((x["revenue"] / b - 1) * 100) if b else None, "kind": wk_label(x["tags"])})
    out.update({
        "has_data": True, "enough": True, "source": ctx["source"], "first": first.isoformat(), "last": days[-1]["date"].isoformat(),
        "max_date": (today + dt.timedelta(days=HORIZON_DAYS)).isoformat(), "avg_daily": round(_mean([x["revenue"] for x in days])),
        "weather_history": bool(ctx["wx"]),
        "prediction": predict(ctx, d),
        "festival_days": fest,
        "normal_day": {"weekday": round(base[False]), "weekend": round(base[True])},
        "lifts": [{"tag": t, "label": LABELS[t], "days": lifts[t]["days"], "lift": round(lifts[t]["lift"] * 100),
                   "status": lifts[t]["status"], "reliable": lifts[t]["reliable"]}
                  for t in ("festival", "holiday", "eve", "weekend", "rain", "hot")],
    })
    return out
