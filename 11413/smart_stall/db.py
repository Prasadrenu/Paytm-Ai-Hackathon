"""The app's storage: one SQLite file (data/stall.db), using only Python's built-in sqlite3.

  doc(name, body)       a small JSON document per name: saved details, daily counts, notifications, settings
  payment(ts, amount)   one row per payment, so hourly sums are done by the database
  meta(key, value)      small facts, such as where the payments came from

On first use, anything found in the older JSON files (data/*.json) is imported once, so nothing is lost.
Each call opens its own short connection, so the web server's threads never share one."""
import json
import os
import sqlite3
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PATH = os.path.join(DATA, "stall.db")
_init_lock = threading.Lock()
_ready = None   # the path the schema was made for


def conn():
    global _ready
    os.makedirs(DATA, exist_ok=True)
    c = sqlite3.connect(PATH, timeout=15)
    if _ready != PATH:
        with _init_lock:
            c.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS doc (name TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS payment (ts TEXT NOT NULL, amount REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS payment_ts ON payment (ts);
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            _ready = PATH
    return c


def read_doc(name, default, legacy=None):
    """The JSON document stored under `name`. If there is none yet, import `legacy` (an old JSON file) once."""
    with conn() as c:
        row = c.execute("SELECT body FROM doc WHERE name=?", (name,)).fetchone()
    if row:
        try:
            return json.loads(row[0])
        except ValueError:
            return default
    if legacy and os.path.exists(legacy):
        try:
            with open(legacy, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return default
        write_doc(name, data)
        return data
    return default


def write_doc(name, obj):
    with conn() as c:
        c.execute("INSERT INTO doc (name, body) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET body=excluded.body",
                  (name, json.dumps(obj, ensure_ascii=False)))


# ---- payments
def get_meta(key, default=None):
    with conn() as c:
        row = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def replace_payments(rows, source):
    """rows: [(iso minute string, amount)]. Replaces every stored payment in one transaction."""
    with conn() as c:
        c.execute("DELETE FROM payment")
        c.executemany("INSERT INTO payment (ts, amount) VALUES (?, ?)", rows)
        c.execute("INSERT INTO meta (key, value) VALUES ('payment_source', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (source,))


def clear_payments():
    with conn() as c:
        c.execute("DELETE FROM payment")
        c.execute("DELETE FROM meta WHERE key='payment_source'")


def all_payments():
    with conn() as c:
        return c.execute("SELECT ts, amount FROM payment ORDER BY ts").fetchall()


def import_legacy_payments(legacy):
    """Once: bring in data/transactions.json if the database has no payments yet and was never cleared on purpose."""
    if get_meta("payments_imported") or not os.path.exists(legacy):
        return
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('payments_imported', '1')")
        have = c.execute("SELECT COUNT(*) FROM payment").fetchone()[0]
    if have:
        return
    try:
        with open(legacy, encoding="utf-8") as f:
            d = json.load(f)
        replace_payments([(t, float(a)) for t, a in d.get("rows", [])], d.get("source", "upload"))
    except (OSError, ValueError, KeyError):
        pass
