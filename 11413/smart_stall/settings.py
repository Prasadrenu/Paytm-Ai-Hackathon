"""App-wide settings, saved in data/settings.json. Right now: the language chosen in the top bar.

The language lives on the server so the 8 pm notification, which the server makes on its own, speaks the same
language the merchant picked on screen."""
import json
import os
import threading

from . import db

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "settings.json")
LANGS = {"en-IN", "hi-IN", "te-IN"}   # languages Bulbul can speak
_lock = threading.Lock()


def _read():
    d = db.read_doc("settings", {}, PATH)
    return d if isinstance(d, dict) else {}


def get_lang():
    """The chosen language code, or None if the merchant has not picked one yet."""
    lang = _read().get("lang")
    return lang if lang in LANGS else None


def set_lang(code):
    if code not in LANGS:
        raise ValueError("That language is not supported.")
    with _lock:
        d = _read()
        d["lang"] = code
        db.write_doc("settings", d)
    return code
