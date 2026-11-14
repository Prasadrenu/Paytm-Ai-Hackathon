"""Smart Stall Planner: items (text + menu photos) + opening hours -> today's plan.

Models: Gemma 4 reads menu photos and tidies typed items, Prism classifies each item,
code does ALL the arithmetic (so numbers are never invented by an LLM), Sarvam-105B Conversations
writes the short message, Mayura/Sarvam-Translate localises it.

What the numbers are built from:
  * First time (no payment history): weather for each part of the day + festival calendar + a typical
    street-stall traffic curve. These are STARTER ESTIMATES.
  * Once payments exist: the stall's own average revenue for each clock hour (same weekday when there is
    enough data, festival days skipped), split across the items on sale in that hour, then nudged by
    today's weather and calendar. Hours with too little payment data fall back to the starter method,
    so one plan can mix both."""
import datetime as dt
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from . import clients as c, events as cal, forecast as f, transactions as tx
from .config import M

CATEGORIES = {
    "hot_drink": "Tea, coffee, hot milk, soup",
    "cold_drink": "Juice, lassi, soda, shake, cold coffee, ice cream",
    "fried_snack": "Samosa, vada, pakora, bhaji, cutlet, fries",
    "meal": "Rice, thali, roti, biryani, noodles, sandwich, burger, chaat",
    "sweet": "Jalebi, laddu, halwa and other sweets",
    "other": "Anything else",
}
# Relative customer traffic by hour of day for a street stall (shape only, not measured data).
HOUR_WEIGHT = {6: .5, 7: .8, 8: 1.0, 9: 1.0, 10: .8, 11: .9, 12: 1.3, 13: 1.4, 14: 1.0, 15: .8, 16: 1.1,
               17: 1.5, 18: 1.7, 19: 1.6, 20: 1.2, 21: .8, 22: .5, 23: .3}
UNITS_PER_WEIGHT = {"hot_drink": 9, "cold_drink": 5, "fried_snack": 7, "meal": 4, "sweet": 3, "other": 3}
DEFAULT_PRICE = {"hot_drink": 10, "cold_drink": 30, "fried_snack": 15, "meal": 80, "sweet": 20, "other": 30}
WEEKEND_FACTOR = 1.15        # Fri-Sun
PAYMENTS_STRENGTH = 0.5      # payments already reflect this stall's usual weather/crowd, so nudge by half
CORE_LANGS = {"hi-IN", "bn-IN", "ta-IN", "te-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN"}


def _json_list(text):
    a, b = text.find("["), text.rfind("]")
    if a < 0 or b < a:
        return []
    try:
        data = json.loads(text[a:b + 1])
    except ValueError:
        return []
    return [d for d in data if isinstance(d, dict) and str(d.get("name", "")).strip()]


EXTRACT = ("Extract the food or drink items sold at a street stall. Return ONLY a JSON array like "
           '[{"name":"Samosa","price":15}] with price as a number in rupees, or null if no price is given. '
           "Fix obvious spelling mistakes, keep the original language of the name if it is not English, "
           "merge duplicates, and do not invent items.")


def parse_items(text, images):
    """Typed items plus any menu photos -> [{name, price}]."""
    jobs = []
    if text.strip():
        jobs.append((f"{EXTRACT}\n\nItems typed by the merchant:\n{text[:3000]}", None))
    for img in images[:4]:
        jobs.append((f"{EXTRACT}\n\nThe photo shows a menu, price board or the food on the stall.", img))

    def run(job):
        try:
            return _json_list(c.chat(job[0], model=M["gemma"], max_tokens=1200, image_b64=job[1]))
        except Exception:
            return []

    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(run, jobs))
    seen, items = set(), []
    for r in results:
        for d in r:
            name = str(d["name"]).strip()[:40]
            if name.lower() in seen:
                continue
            seen.add(name.lower())
            try:
                price = float(d.get("price")) if d.get("price") is not None else None
            except (TypeError, ValueError):
                price = None
            items.append({"name": name, "price": price})
    return items[:15]


def classify(name):
    """Prism picks a category with a calibrated probability; low confidence falls back to 'other'."""
    try:
        a = c.decide({"menu_item": name}, {"category": {
            "type": "choice", "instructions": "Which category is this stall menu item?", "criteria": CATEGORIES}})
        ans = a["category"]
        top = ans["choice"]
        return (top if ans["probabilities"][top] >= 0.5 else "other"), round(ans["probabilities"][top], 2)
    except Exception:
        return "other", 0.0


def _parse_time(s, default):
    try:
        h, m = (int(x) for x in s.split(":")[:2])
        return h + m / 60
    except Exception:
        return default


def open_hours(open_s, close_s):
    """Whole hours the stall is open, e.g. [16,17,18,19,20]. Handles closing after midnight."""
    o, cl = _parse_time(open_s, 9.0), _parse_time(close_s, 21.0)
    if cl <= o:
        cl += 24
    hrs, h = [], int(o)
    while h < cl:
        hrs.append(h % 24)
        h += 1
    return hrs, o, cl % 24 if cl % 24 else 24


def _fmt_h(h):
    return f"{(h % 12) or 12} {'am' if h % 24 < 12 else 'pm'}"


def peak_window(hours, W=None):
    """Best run of up to 3 consecutive hours by traffic weight (W = per-hour weights, else the typical curve)."""
    W = W or HOUR_WEIGHT
    if len(hours) <= 3:
        return hours[0], (hours[-1] + 1) % 24
    best = max(range(len(hours) - 2), key=lambda i: sum(W.get(h, 1) for h in hours[i:i + 3]))
    return hours[best], (hours[best + 2] + 1) % 24


def hour_weights(stats):
    """Per-hour traffic weights: this stall's own revenue pattern where known, the typical curve elsewhere."""
    W = dict(HOUR_WEIGHT)
    if stats:
        mean = sum(s["rev"] for s in stats.values()) / len(stats)
        if mean > 0:
            for h, s in stats.items():
                W[h] = s["rev"] / mean
    return W


def weather_adjust(cat, wx):
    hot, rain, cool = wx["max_c"] >= 34, wx["rain_pct"] >= 60, wx["max_c"] < 24
    a, why = 1.0, []
    if cat == "cold_drink":
        if hot: a, why = 1.3, ["hot weather"]
        elif wx["max_c"] < 30: a, why = 0.9, ["mild weather"]
    elif cat == "hot_drink":
        if rain or cool: a, why = 1.25, ["rain or cool weather"]
        elif hot: a, why = 0.9, ["hot weather"]
    elif cat == "fried_snack" and rain:
        a, why = 1.2, ["rain expected"]
    return a, why


def slot_weather(wx, hours):
    """Weather for just these hours (hourly forecast), falling back to the day's figures."""
    th, rh = wx.get("temp_h"), wx.get("rain_h")
    if th and rh and hours:
        return {"max_c": round(max(th[h] for h in hours), 1), "rain_pct": max(rh[h] for h in hours)}
    return {"max_c": wx["max_c"], "rain_pct": wx["rain_pct"]}


def build_plan(items, open_s, close_s, wx, day, evs, stats, txn_days=0):
    hours = open_hours(open_s, close_s)[0]
    weekend = day.weekday() >= 4
    with ThreadPoolExecutor(6) as ex:
        cats = list(ex.map(lambda it: classify(it["name"]), items))
    win = [open_hours(it["from"], it["to"])[0] if it.get("from") and it.get("to") else hours for it in items]
    price = [(it.get("price") or DEFAULT_PRICE[cat]) for it, (cat, _) in zip(items, cats)]
    share = [UNITS_PER_WEIGHT[cat] * p for (cat, _), p in zip(cats, price)]   # typical revenue weight of each item
    on_sale = defaultdict(list)
    for i, ih in enumerate(win):
        for h in set(ih):
            on_sale[h].append(i)

    rows = []
    for i, (it, (cat, conf)) in enumerate(zip(items, cats)):
        ih = win[i]
        wa, wwhy = weather_adjust(cat, slot_weather(wx, ih))
        ef, ewhy = cal.factor(cat, evs)
        units, from_pay, wk = 0.0, 0, False
        for h in ih:
            st = stats.get(h) if stats else None
            if st:
                # This stall's own average revenue in this hour, shared among the items on sale then.
                u = st["rev"] * share[i] / sum(share[j] for j in on_sale[h]) / price[i]
                m = 1 + (wa * ef - 1) * PAYMENTS_STRENGTH
                if weekend and not st["samedow"]:   # baseline mixed weekdays, so a weekend still needs the lift
                    m *= WEEKEND_FACTOR
                    wk = True
                from_pay += 1
            else:
                u = UNITS_PER_WEIGHT[cat] * HOUR_WEIGHT.get(h, 1)
                m = wa * ef * (WEEKEND_FACTOR if weekend else 1)
                wk = wk or weekend
            units += u * m
        basis = "payments" if from_pay == len(ih) else "starter" if from_pay == 0 else "mixed"
        why = list(wwhy) + ewhy
        if wk:
            why.append("weekend")
        if basis != "starter":
            why.append(f"{'learned' if basis == 'payments' else 'partly learned'} from {txn_days} days of payments")
        if it.get("from") and it.get("to"):
            why.append(f"sold {_fmt_h(ih[0])} to {_fmt_h(ih[-1] + 1)}")
        rows.append({**it, "category": cat, "confidence": conf, "basis": basis,
                     "make": max(5, int(round(units * 1.05 / 5.0) * 5)),
                     "why": ", ".join(why) or "normal day"})
    if not rows:
        raise ValueError("I could not find any items to plan.")
    # Overall busiest time looks at every hour any item is sold, not only the default opening hours.
    covered = set(hours)
    for r in rows:
        if r.get("from") and r.get("to"):
            covered.update(open_hours(r["from"], r["to"])[0])
    W = hour_weights(stats)
    span = sorted(covered)
    ps, pe = peak_window(span, W)
    return rows, {"start": ps, "end": pe, "hours_open": len(span)}, W


def _weather_line(swx):
    if swx["rain_pct"] >= 60:
        return f"Rain is likely ({swx['rain_pct']}% chance), so keep hot snacks and tea ready."
    if swx["max_c"] >= 34:
        return f"It will be hot, about {round(swx['max_c'])} degrees, so cold drinks will sell well."
    return f"The weather looks normal, about {round(swx['max_c'])} degrees with little rain."


def message(rows, peak, swx, day, label, span, evs):
    """3-sentence message for one part of the day. Numbers come from code; the model only words them."""
    part = "the whole day" if label == "Whole day" else f"the {label.lower()} ({span})" if label.isalpha() else span
    cal_line = "; ".join(f"{e['name']} is {e['when']}" for e in evs) if evs else "no festival today"
    facts = (f"Today is {day:%A}. This message is for {part}.\nQuantities to make: "
             + "; ".join(f"{r['name']} {r['make']}" for r in rows)
             + f".\nBusiest time: {_fmt_h(peak['start'])} to {_fmt_h(peak['end'])}.\nWeather note: {_weather_line(swx)}"
             + f"\nCalendar: {cal_line}.")
    return c.chat(
        "Write exactly 3 short sentences for a stall owner: (1) what to make and how much for this part of the day, "
        "(2) when it will be busiest, (3) the weather note, and mention the festival if the calendar lists one. "
        "Use only the facts below, keep every number as given, and do not mention opening hours.\n\n" + facts,
        model=M["chat"], system="You are a friendly business partner for a small stall. Plain words, no markdown.",
        max_tokens=600).strip()


PART_NAMES = {("06:00", "11:00"): "Morning", ("11:00", "16:00"): "Afternoon",
              ("16:00", "21:00"): "Evening", ("21:00", "00:00"): "Night"}


def group_slots(rows, hours, wx, W, stats=None):
    """Group plan rows by the time window they are sold in -> ordered parts of the day."""
    groups = {}
    for r in rows:
        key = (r["from"], r["to"]) if r.get("from") and r.get("to") else None
        groups.setdefault(key, []).append(r)
    now_h, slots = dt.datetime.now().hour, []
    for key, rs in groups.items():
        sh = hours if key is None else open_hours(*key)[0]
        span = f"{_fmt_h(sh[0])} – {_fmt_h(sh[-1] + 1)}"
        ps, pe = peak_window(sh, W)
        bases = {r["basis"] for r in rs}
        known = sum(1 for h in sh if stats and h in stats)   # hours with enough payment history
        peak_src = "payments" if known == len(sh) else "mixed" if known else "typical"
        slots.append({"label": "Whole day" if key is None else PART_NAMES.get(key, span), "range": span,
                      "peak": {"start": ps, "end": pe}, "peak_src": peak_src, "now": now_h in sh, "items": rs,
                      "weather": slot_weather(wx, sh),
                      "basis": bases.pop() if len(bases) == 1 else "mixed",
                      "_order": sh[0] if key else -1})  # whole-day first, then by clock time
    slots.sort(key=lambda x: x.pop("_order"))
    return slots


def localise(text, lang):
    if lang == "en-IN":
        return text
    return c.translate(text, lang, model=M["mayura"] if lang in CORE_LANGS else M["translate"])


def run(text, images, open_s, close_s, lang="en-IN", items=None):
    """items: already-confirmed [{name, price}] (skips parsing); otherwise parse text + photos."""
    items = items or parse_items(text, images)
    if not items:
        raise ValueError("I could not find any food items. Type them in, or add a clearer menu photo.")
    day = dt.date.today()
    wx = f.weather(day=0)
    evs = cal.events_for(day) if cal.covered(day) else []
    stats, meta = tx.hourly_stats(day.weekday(), cal.event_dates(), day)
    rows, peak, W = build_plan(items, open_s, close_s, wx, day, evs, stats, meta["days"])
    slots = group_slots(rows, open_hours(open_s, close_s)[0], wx, W, stats)

    def one(slot):
        slot["message"] = message(slot["items"], slot["peak"], slot["weather"], day, slot["label"], slot["range"], evs)
        try:
            slot["message_local"] = localise(slot["message"], lang)
        except Exception:
            slot["message_local"] = ""
        return slot

    with ThreadPoolExecutor(4) as ex:
        slots = list(ex.map(one, slots))
    bases = {r["basis"] for r in rows}
    mode = "learned" if bases == {"payments"} else "starter" if bases == {"starter"} else "mixed"
    basis = {"mode": mode, "weather_live": bool(wx.get("live")), "weather_hourly": "temp_h" in wx,
             "events": evs, "calendar_covered": cal.covered(day),
             "payments": {"days": meta["days"], "used": mode != "starter", "source": meta.get("source"),
                          "same_weekday": meta.get("samedow"), "needed": meta["days"] > 0 and mode == "starter"}}
    return {"date": day.isoformat(), "weekday": day.strftime("%A"), "weather": wx, "peak": peak,
            "open": open_s, "close": close_s, "slots": slots, "lang": lang, "basis": basis,
            "note": ("Learned from this stall's payments, adjusted for today's weather and calendar."
                     if mode == "learned" else
                     "Starter estimate from weather and calendar. Add payment history to make it sharper."
                     if mode == "starter" else
                     "Learned from payments where there is enough history, starter estimate for the rest.")}
