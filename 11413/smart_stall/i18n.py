"""Translates the app's screen text into the merchant's language, with Sarvam-105B, and remembers the results.

* Short labels are translated WITH context (this is a button in a stall-planning app), many at a time, so wording
  is natural ("Home" becomes the everyday word, not "homeland"). Sarvam's plain translator was tried first and got
  short labels wrong.
* Every {0}, {1} placeholder must come back exactly as it went in, or the translation is discarded and the screen
  keeps its English text. A bad translation is never shown.
* Results are cached per language in data/i18n/, and the server pre-translates every language in the background at
  startup, so choosing a language is instant."""
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from . import clients as c
from .config import M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "i18n")
STRINGS = os.path.join(ROOT, "smart_stall", "ui_strings.json")   # every text in the screens, made by tools/extract_strings.cjs
NAMES = {"hi-IN": "Hindi", "te-IN": "Telugu"}
BATCH = 25
_lock = threading.Lock()
_mem = {}


def _path(lang):
    return os.path.join(CACHE, lang + ".json")


def get(lang):
    """All cached translations for a language: {english: translated}."""
    with _lock:
        if lang not in _mem:
            try:
                with open(_path(lang), encoding="utf-8") as f:
                    _mem[lang] = json.load(f)
            except (FileNotFoundError, ValueError):
                _mem[lang] = {}
        return dict(_mem[lang])


def _store(lang, new):
    with _lock:
        cur = _mem.setdefault(lang, {})
        cur.update(new)
        os.makedirs(CACHE, exist_ok=True)
        tmp = _path(lang) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=0)
        os.replace(tmp, _path(lang))


def _slots(s):
    return sorted(re.findall(r"\{\d+\}", s))


def worth(key):
    """Only text with real words is translated (not numbers, symbols or bare placeholders)."""
    return isinstance(key, str) and 1 < len(key) <= 400 and bool(re.search(r"[A-Za-z]{2}", re.sub(r"\{\d+\}", "", key)))


def _prompt(lang, batch):
    return (
        "You are localizing the user interface of a web app that helps small street-food stall owners in India plan what to "
        f"cook each day. Translate each English UI string into {NAMES[lang]}, written in {NAMES[lang]} script.\n"
        "Rules:\n"
        "- Use short, natural wording a stall owner understands, as real apps in this language do.\n"
        "- Keep placeholders such as {0} and {1} exactly as they are, each used once. You may move them to suit the grammar.\n"
        "- Keep numbers, currency symbols (₹), times like 6 am or 4 pm, and the name 'Smart Planner' unchanged.\n"
        "- Keep festival and place names as proper nouns (transliterate, do not translate them).\n"
        "- Common loan words people really use in apps (Menu, Home, WhatsApp, Soundbox) stay in their usual form.\n"
        "- 'Open' in a phrase about a stall means the stall is open for business. 'Counts' means quantities counted.\n"
        "- Do not add full stops the English does not have. Do not explain anything.\n"
        "Return ONLY a JSON object that maps each id to its translation.\n\n"
        + json.dumps({str(i): s for i, s in enumerate(batch)}, ensure_ascii=False))


KEEP = {"Menu", "Home", "Smart Planner", "Paytm for Business", "Paytm", "OK", "UPI", "CSV"}


def _same(tr, src):
    """A copy of the English is a failed translation, unless the text is one of the words that stay in English."""
    return tr.strip() == src.strip() and src not in KEEP and bool(re.search(r"[A-Za-z]{3}", re.sub(r"\{\d+\}", "", src)))


def _one_batch(lang, batch, accept_same=False):
    """Translate one batch; returns only the translations that passed every check."""
    try:
        raw = c.chat(_prompt(lang, batch), model=M["chat"], max_tokens=4096)
        a, b = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[a:b + 1])
    except Exception:
        return {}
    out = {}
    for i, src in enumerate(batch):
        tr = data.get(str(i))
        if isinstance(tr, str) and tr.strip() and _slots(tr) == _slots(src) and len(tr) <= 4 * len(src) + 40 and (accept_same or not _same(tr, src)):
            out[src] = tr.strip()
    return out


def translate_missing(lang, keys):
    """Translate whatever of `keys` is not cached yet. Returns the cache. Anything that fails stays English."""
    if lang not in NAMES:
        return {}
    have = get(lang)
    todo = [k for k in dict.fromkeys(keys) if worth(k) and k not in have]
    if todo:
        batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
        with ThreadPoolExecutor(4) as ex:
            results = list(ex.map(lambda b: _one_batch(lang, b), batches))
        got = {}
        for r in results:
            got.update(r)
        missed = [k for k in todo if k not in got]
        if missed:   # one retry, in smaller groups: a single odd string should not sink its neighbours
            with ThreadPoolExecutor(4) as ex:
                for r in ex.map(lambda b: _one_batch(lang, b), [missed[i:i + 6] for i in range(0, len(missed), 6)]):
                    got.update(r)
            for k in missed:
                if k not in got:
                    got[k] = k    # tried twice and the model keeps English: remember it so we do not ask again
        if got:
            _store(lang, got)
    return get(lang)


def known_keys():
    """Every screen text: those found in the source, plus any asked for at run time in any language."""
    keys = set()
    try:
        with open(STRINGS, encoding="utf-8") as f:
            keys.update(json.load(f))
    except (FileNotFoundError, ValueError):
        pass
    for lang in NAMES:
        keys.update(get(lang))
    return sorted(k for k in keys if worth(k))


def _warm():
    for lang in NAMES:
        try:
            translate_missing(lang, known_keys())
        except Exception:
            pass


def start_warmup():
    """In the background at startup: translate every language, so picking one later is instant."""
    threading.Thread(target=_warm, daemon=True, name="i18n-warm").start()
