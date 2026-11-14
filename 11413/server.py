"""Merchant AI: Smart Stall Planner.   python server.py   then open http://localhost:8000
Stdlib HTTP server. The Sarvam key stays on the server; the browser never sees it."""
import base64
import json
import mimetypes
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import datetime as dt
from urllib.parse import parse_qs, urlparse

from smart_stall import analytics, clients as c, counts, i18n, notifier, places, settings, special, stallplan, store, transactions
from smart_stall.config import M

ROOT = os.path.dirname(os.path.abspath(__file__))
# Serve the React build (cd ui && npm run build); fall back to the plain-HTML version.
WEB = os.path.join(ROOT, "ui", "dist")
if not os.path.isdir(WEB):
    WEB = os.path.join(ROOT, "web")


def known_items():
    """Menu item names the merchant has saved (newest first, no duplicates), used to match spoken names."""
    seen, out = set(), []
    for rec in store.load():
        for it in rec["items"]:
            if counts.key(it["name"]) not in seen:
                seen.add(counts.key(it["name"]))
                out.append(it["name"])
    return out


def menu_for(part):
    """Saved items sold in this part of the day: the time chosen for them overlaps it, or they sell all day.
    If nothing was assigned to this part, fall back to every saved item so the list is never empty."""
    hrs = set(counts.PARTS.get(part, []))
    seen, out, anyone = set(), [], []
    for rec in store.load():                      # newest first, so the latest price wins
        for it in rec["items"]:
            k = counts.key(it["name"])
            sold_here = (part == "Whole day" or not (it.get("from") and it.get("to"))
                         or bool(hrs & set(stallplan.open_hours(it["from"], it["to"])[0])))
            if sold_here and k not in seen:
                seen.add(k)
                out.append({"name": it["name"], "price": it.get("price")})
            if k not in {counts.key(a["name"]) for a in anyone}:
                anyone.append({"name": it["name"], "price": it.get("price")})
    return (out, False) if out else (anyone, bool(anyone))


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode())

    def do_GET(self):
        if self.path.split("?")[0] == "/api/i18n":
            lang = parse_qs(urlparse(self.path).query).get("lang", [""])[0]
            if lang not in i18n.NAMES:
                return self._json(200, {"lang": lang, "tr": {}})   # English: nothing to translate
            return self._json(200, {"lang": lang, "tr": i18n.get(lang)})   # whatever is cached, instantly
        if self.path.split("?")[0] == "/api/home":
            # Everything the Home page shows, in one call: today's quantities (no message writing, so it is quick).
            menu = store.current_menu()
            snap = notifier.snapshot()
            note = {"active": len(snap["active"]), "unseen": snap["unseen"], "hour": snap["notify_hour"]}
            if not menu:
                return self._json(200, {"menu": False, "notifications": note})
            plan = stallplan.run("", [], menu["open"], menu["close"], settings.get_lang() or menu["lang"],
                                 items=menu["items"], when="today", location=menu["location"], with_messages=False)
            return self._json(200, {"menu": True, "plan": plan, "notifications": note})
        if self.path.split("?")[0] == "/api/settings":
            return self._json(200, {"lang": settings.get_lang()})
        if self.path.split("?")[0] == "/api/special":
            # Sudden events (bandh, road closure...): accepted ones, and news suggestions waiting for a yes or no.
            q = parse_qs(urlparse(self.path).query)
            return self._json(200, special.view(refresh_now="refresh" in q))
        if self.path.split("?")[0] == "/api/notifications":
            q = parse_qs(urlparse(self.path).query)
            if q.get("audio"):   # the saved speech for one notification, so it can be replayed any time
                p = notifier.audio_path(q["audio"][0])
                if not p:
                    return self._send(404, b"no audio", "text/plain")
                with open(p, "rb") as fh:
                    return self._send(200, fh.read(), "audio/wav")
            return self._json(200, notifier.snapshot())
        if self.path.split("?")[0] == "/api/analytics":
            try:
                ds = parse_qs(urlparse(self.path).query).get("date", [""])[0]
                return self._json(200, analytics.compute(date=dt.date.fromisoformat(ds) if ds else None))
            except ValueError as e:
                return self._json(422, {"error": str(e) if "Pick a date" in str(e) else "Pick a valid date."})
        if self.path.split("?")[0] == "/api/geocode":
            try:
                found = places.search(parse_qs(urlparse(self.path).query).get("q", [""])[0])
            except RuntimeError as e:
                return self._json(502, {"error": str(e)})
            return self._json(200, {"places": found})
        if self.path.split("?")[0] == "/api/counts":
            q = parse_qs(urlparse(self.path).query)
            if q.get("menu"):   # the items to count for a part of the day
                items, fallback = menu_for(q["menu"][0])
                return self._json(200, {"items": items, "fallback": fallback})
            if q.get("made"):   # items already saved as "made" for a day and part, to prefill the end count
                return self._json(200, {"items": counts.made_for(q.get("date", [""])[0], q["made"][0])})
            return self._json(200, {"records": counts.load(int(q.get("days", ["30"])[0] or 30)),
                                    "known": known_items(), "parts": list(counts.PARTS)})
        if self.path.split("?")[0] == "/api/payments":
            return self._json(200, transactions.summary())
        if self.path.split("?")[0] == "/api/saved":
            return self._json(200, {"records": store.load(), "file": "data/stall_details.json"})
        p = self.path.lstrip("/").split("?")[0] or "index.html"
        fp = os.path.normpath(os.path.join(WEB, p))
        if not fp.startswith(WEB) or not os.path.isfile(fp):
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(fp, "rb") as fh:
            self._send(200, fh.read(), ctype)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            if self.path == "/api/parse":
                # Step 1 -> 2: typed text + photos -> list of items to review.
                d = json.loads(raw)
                images = [i for i in (d.get("images") or []) if isinstance(i, str)][:4]
                items = stallplan.parse_items((d.get("items") or "")[:3000], images)
                if not items:
                    return self._json(422, {"error": "I could not find any food items. Type them in, or add a clearer menu photo."})
                return self._json(200, {"items": items})
            if self.path == "/api/save":
                # Step 2 -> 3: confirmed details go into data/stall_details.json.
                try:
                    rec = store.save(json.loads(raw))
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, {"saved": rec, "file": "data/stall_details.json"})
            if self.path == "/api/plan":
                d = json.loads(raw)
                try:
                    checked = store.clean(d) if d.get("confirmed") else None
                    plan = stallplan.run("", [], d.get("open", "09:00"), d.get("close", "21:00"),
                                         d.get("lang", "en-IN"), items=checked["items"] if checked else None,
                                         when="tomorrow" if d.get("when") == "tomorrow" else "today",
                                         location=checked["location"] if checked else None)
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, plan)
            if self.path == "/api/counts/parse":
                # Spoken or typed counts -> [{name, qty, matched}] for the merchant to confirm.
                d = json.loads(raw)
                text = str(d.get("text", "")).strip()
                if not text:
                    return self._json(422, {"error": "I did not hear anything. Try again, or type your counts."})
                items = counts.parse_spoken(text, "end" if d.get("kind") == "end" else "start", known_items())
                if not items:
                    return self._json(422, {"error": "I could not find any item with a quantity. Say it like: samosa 100, chai 80."})
                return self._json(200, {"items": items})
            if self.path == "/api/counts":
                d = json.loads(raw)
                try:
                    day = dt.date.fromisoformat(str(d.get("date", "")))
                    ctx = stallplan.context_for(day, d.get("part")) if d.get("part") in counts.PARTS else {}
                    rec = counts.save(str(d.get("date", "")), d.get("part"), d.get("kind"), d.get("items"), ctx)
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, {"record": rec})
            if self.path == "/api/payments":
                # Upload a CSV of payments (time + amount). Replaces what is stored.
                try:
                    transactions.replace(transactions.parse_csv(str(json.loads(raw).get("csv", ""))), "upload")
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, transactions.summary())
            if self.path.startswith("/api/special/"):
                d = json.loads(raw or "{}")
                act = self.path.rsplit("/", 1)[1]
                try:
                    if act == "add":
                        special.add(d.get("date"), d.get("title"), d.get("effect_pct", 0), d.get("kind", "other"))
                    elif act == "accept":
                        special.accept(str(d.get("id", "")))
                    elif act == "dismiss":
                        special.dismiss(str(d.get("id", "")))
                    elif act == "remove":
                        special.remove(str(d.get("id", "")))
                    else:
                        return self._json(404, {"error": "not found"})
                except (ValueError, TypeError) as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, special.view())
            if self.path == "/api/settings":
                try:
                    return self._json(200, {"lang": settings.set_lang(str(json.loads(raw).get("lang", "")))})
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
            if self.path == "/api/i18n":
                # Texts the screen asked for that are not cached yet: translate them and send back what passed the checks.
                d = json.loads(raw)
                lang = str(d.get("lang", ""))
                keys = [k for k in (d.get("keys") or [])[:300] if isinstance(k, str)]
                cache = i18n.translate_missing(lang, keys)
                return self._json(200, {"lang": lang, "tr": {k: cache[k] for k in keys if k in cache}})
            if self.path == "/api/notifications/seen":
                notifier.mark_seen()
                return self._json(200, notifier.snapshot())
            if self.path == "/api/notifications/test":
                # Make tomorrow's notification right now (what the 8 pm job does), replacing today's copy.
                try:
                    n = notifier.generate()
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, {"notification": n})
            if self.path == "/api/payments/demo":
                transactions.replace(transactions.demo_rows(), "demo")   # synthetic, flagged as demo
                return self._json(200, transactions.summary())
            if self.path == "/api/payments/clear":
                transactions.clear()
                return self._json(200, transactions.summary())
            if self.path == "/api/stt":
                with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as t:
                    t.write(raw)
                try:
                    with open(t.name, "rb") as fh:
                        r = c.sdk().speech_to_text.transcribe(
                            file=("rec.webm", fh, "audio/webm"), model=M["stt"],
                            mode="transcribe", language_code="unknown")
                finally:
                    os.unlink(t.name)
                return self._json(200, {"text": r.transcript})
            if self.path == "/api/tts":
                d = json.loads(raw)
                audio = c.tts(d["text"], d.get("lang", "hi-IN"))   # the one female voice, at normal speed
                return self._json(200, {"audio": base64.b64encode(audio).decode()})
            self._json(404, {"error": "unknown endpoint"})
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    c.sdk()  # fail fast if the key is missing
    i18n.start_warmup()           # translate every language in the background, so choosing one is instant
    notifier.start_scheduler()   # every evening from 8 pm: make sure tomorrow's notification exists
    print("Merchant AI running at http://localhost:8000", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
