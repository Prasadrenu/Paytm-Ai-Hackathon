"""Stall location: place search through Open-Meteo's free geocoding API (no key).

Only the text the merchant typed (a place name) leaves the machine. Weather is then looked up by
coordinates, so the same coordinates are used for every forecast."""
import re

import requests

DEFAULT = {"name": "Hyderabad, Telangana", "lat": 17.385, "lon": 78.4867}   # used until a location is set
URL = "https://geocoding-api.open-meteo.com/v1/search"


def _label(r):
    """'Madhapur, Ranga Reddy, Telangana': name, district, state. The state always stays, since many names repeat."""
    out = []
    for b in (r.get("name"), r.get("admin2") or r.get("admin3"), r.get("admin1")):
        if b and b not in out and not any(b in o for o in out):
            out.append(b)
    return ", ".join(out)


def search(q):
    """'Madhapur', 'Madhapur, Hyderabad' or 'near Charminar' -> up to 6 places with coordinates.

    The geocoder only matches one name, so each comma-separated part is tried, and results are ranked by how
    many of the OTHER words in the query appear in their district or state."""
    q = re.sub(r"\s+", " ", q or "").strip()[:80]
    if len(q) < 2:
        return []
    parts = [p.strip() for p in q.split(",") if p.strip()]
    words = {w for w in re.findall(r"[a-z]{3,}", q.lower())}
    found, seen = [], set()
    for name in dict.fromkeys(parts + ([q] if len(parts) > 1 else [])):
        try:
            r = requests.get(URL, timeout=10, params={"name": name, "count": 10, "language": "en",
                                                      "format": "json", "countryCode": "IN"})
            r.raise_for_status()
        except requests.RequestException:
            raise RuntimeError("Place search is not available right now. Use \"Use my current location\" instead.")
        for x in r.json().get("results", []):
            key = (round(x["latitude"], 2), round(x["longitude"], 2))
            if key in seen:
                continue
            seen.add(key)
            text = " ".join(str(x.get(k, "")) for k in ("name", "admin1", "admin2", "admin3")).lower()
            found.append((sum(1 for w in words if w in text), len(found), x))
    found.sort(key=lambda t: (-t[0], t[1]))
    return [{"name": _label(x), "lat": round(x["latitude"], 4), "lon": round(x["longitude"], 4)} for _, _, x in found[:6]]


def clean(loc):
    """Validate a location from the browser. Returns {name, lat, lon} or None."""
    if not loc:
        return None
    try:
        lat, lon = float(loc["lat"]), float(loc["lon"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("The stall location is not valid. Search for it again.")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("The stall location is not valid. Search for it again.")
    name = re.sub(r"\s+", " ", str(loc.get("name") or "My stall")).strip()[:80] or "My stall"
    return {"name": name, "lat": round(lat, 4), "lon": round(lon, 4)}
