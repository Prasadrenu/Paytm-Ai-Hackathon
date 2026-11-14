"""Signals + forecast. Deliberately simple and explainable: seasonal-naive by weekday,
adjusted by weather. Swap in a real time-series model once there is real data."""
import csv, datetime as dt, random, time
import requests

MENU = {"samosa": 15, "chai": 10, "lassi": 30, "cold drink": 25, "vada pav": 20}


def make_sample(path="data/sample_payments.csv", days=42, seed=7):
    """Synthetic Soundbox payments + nightly counts for one stall (clearly fake data)."""
    random.seed(seed)
    start = dt.date.today() - dt.timedelta(days=days)
    rows = []
    for d in range(days):
        day = start + dt.timedelta(days=d)
        hot = random.random() < .4
        for item, price in MENU.items():
            base = {"samosa": 90, "chai": 120, "lassi": 40, "cold drink": 35, "vada pav": 60}[item]
            if item in ("lassi", "cold drink") and hot: base *= 1.5
            if item in ("chai", "samosa") and not hot: base *= 1.15
            if day.weekday() >= 4: base *= 1.25
            made = int(base * 1.2); sold = min(made, int(base * random.uniform(.85, 1.1)))
            rows.append([day.isoformat(), item, price, made, made - sold, int(hot)])
    with open(path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["date", "item", "price", "made", "left", "hot"]); w.writerows(rows)
    return path


def load(path):
    with open(path) as f:
        return [dict(r, price=float(r["price"]), made=int(r["made"]), left=int(r["left"]), hot=int(r["hot"]),
                     date=dt.date.fromisoformat(r["date"])) for r in csv.DictReader(f)]


_wx_cache = {}   # (lat, lon, day) -> (fetched at, result); a forecast changes slowly, so 15 minutes is plenty
WX_TTL = 900


def weather(lat=17.385, lon=78.4867, day=1):
    """Open-Meteo, no key. Only coordinates leave the machine. Falls back to neutral on failure."""
    k = (round(float(lat), 2), round(float(lon), 2), day)
    hit = _wx_cache.get(k)
    if hit and time.time() - hit[0] < WX_TTL:
        return dict(hit[1])
    out = _weather(lat, lon, day)
    if out.get("live"):
        _wx_cache[k] = (time.time(), out)
    return dict(out)


def _weather(lat, lon, day):
    try:
        r = requests.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
            "latitude": lat, "longitude": lon, "daily": "temperature_2m_max,precipitation_probability_max",
            "hourly": "temperature_2m,precipitation_probability", "timezone": "auto", "forecast_days": 2}).json()
        j, h = r["daily"], r["hourly"]
        out = {"max_c": j["temperature_2m_max"][day], "rain_pct": j["precipitation_probability_max"][day], "live": True}
        # Per-hour values for the chosen day, so each part of the day gets its own weather.
        t, p = h["temperature_2m"][day * 24:(day + 1) * 24], h["precipitation_probability"][day * 24:(day + 1) * 24]
        if len(t) == 24 and len(p) == 24 and None not in t and None not in p:
            out.update(temp_h=t, rain_h=p)
        return out
    except Exception:
        return {"max_c": 32.0, "rain_pct": 10, "live": False}


def plan(rows, target_date, wx):
    """Per-item make-quantity for target_date, from same-weekday history + weather."""
    hot = wx["max_c"] >= 34
    out, wastage = {}, 0
    for item in MENU:
        h = [r for r in rows if r["item"] == item]
        same = [r for r in h if r["date"].weekday() == target_date.weekday()] or h
        sold = [r["made"] - r["left"] for r in same[-4:]]
        base = sum(sold) / len(sold)
        adj = 1.0
        if item in ("lassi", "cold drink"): adj = 1.3 if hot else 0.9
        if item in ("chai", "samosa") and wx["rain_pct"] >= 60: adj = 1.2
        out[item] = round(base * adj * 1.05)  # 5% buffer so the rush doesn't sell out
    for r in rows[-len(MENU) * 7:]:
        wastage += r["left"] * r["price"]
    return out, round(wastage)
