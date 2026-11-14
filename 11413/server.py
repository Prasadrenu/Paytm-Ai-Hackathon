"""Merchant AI: Smart Stall Planner.   python server.py   then open http://localhost:8000
Stdlib HTTP server. The Sarvam key stays on the server; the browser never sees it."""
import base64
import datetime
from urllib.parse import parse_qs, urlparse
import json
import mimetypes
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from smart_stall import clients as c, stallplan, store, transactions
from smart_stall.config import M

ROOT = os.path.dirname(os.path.abspath(__file__))
# Serve the React build (cd ui && npm run build); fall back to the plain-HTML version.
WEB = os.path.join(ROOT, "ui", "dist")
if not os.path.isdir(WEB):
    WEB = os.path.join(ROOT, "web")


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
        if self.path.split("?")[0] == "/api/payments":
            return self._json(200, transactions.summary())
        if self.path.split("?")[0] == "/api/analytics":
            q = parse_qs(urlparse(self.path).query).get("date", [""])[0]
            try:
                day = datetime.date.fromisoformat(q) if q else None
            except ValueError:
                return self._json(422, {"error": "Date must look like 2026-11-20."})
            return self._json(200, transactions.analytics(day))
        if self.path.split("?")[0] == "/api/saved":
            return self._json(200, {"records": store.load(), "file": "data/stall_details.json"})
        p = "index.html" if self.path in ("/", "") else self.path.lstrip("/").split("?")[0]
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
                    items = store.clean(d)["items"] if d.get("confirmed") else None
                    plan = stallplan.run("", [], d.get("open", "09:00"), d.get("close", "21:00"),
                                         d.get("lang", "en-IN"), items=items)
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, plan)
            if self.path == "/api/payments":
                # Upload a CSV of payments (time + amount). Replaces what is stored.
                try:
                    transactions.replace(transactions.parse_csv(str(json.loads(raw).get("csv", ""))), "upload")
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                return self._json(200, transactions.summary())
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
                lang = d.get("lang", "hi-IN")
                kw = {"speaker": "shubh_enhi_ads"} if lang == "hi-IN" else {}
                r = c.sdk().text_to_speech.convert(
                    text=d["text"][:2500], language_code=lang, model=M["tts"], **kw)
                return self._json(200, {"audio": r.audios[0]})
            self._json(404, {"error": "unknown endpoint"})
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    c.sdk()  # fail fast if the key is missing
    print("Merchant AI running at http://localhost:8000", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
