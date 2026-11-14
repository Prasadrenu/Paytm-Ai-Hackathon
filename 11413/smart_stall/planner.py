"""Orchestrates every Sarvam model into the Smart Stall Partner daily loop."""
import datetime as dt
from . import clients as c
from .config import M


def morning_message(quantities, wx, day, lang_name="Hindi"):
    """105B writes the plan from structured numbers. It may not invent quantities."""
    facts = f"Day: {day:%A}. Max temp {wx['max_c']}C, rain chance {wx['rain_pct']}%. Make today: {quantities}."
    return c.chat(
        "Write a 3-line morning WhatsApp message for a street-food stall owner. Use ONLY these facts, do not "
        f"change any number. Say what to make, how much, and one tip about weather.\n{facts}",
        model=M["llm"], system="You are a friendly business partner for a small stall. Plain words, no markdown.",
        max_tokens=1500)


def should_offer(sales_today_pct_of_usual, rain_pct, hour):
    """Prism gates the one-tap offer. Act only when calibrated confidence is high."""
    state = {"sales_vs_usual_pct": sales_today_pct_of_usual, "rain_pct": rain_pct, "hour": hour}
    a = c.decide(state, {"offer": {"type": "noul", "instructions":
                 "Is it a slow day where sending the stall owner a discount-offer suggestion would help?"}})
    p = a["offer"]["noul"] if isinstance(a["offer"], dict) else a["offer"].noul
    return p, p >= 0.8


def localise(text, lang_code):
    """Mayura for the 10 core languages, Sarvam-Translate for the long tail."""
    core = {"hi-IN", "bn-IN", "ta-IN", "te-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN"}
    return c.translate(text, lang_code, model=M["mayura"] if lang_code in core else M["translate"])


def run_day(rows, quantities, wx, lang="te-IN", out_dir="out"):
    day = dt.date.today() + dt.timedelta(days=1)
    msg = morning_message(quantities, wx, day)
    local = localise(msg, lang)
    c.tts(local, lang=lang, out_path=f"{out_dir}/morning_{lang}.mp3")
    return {"english": msg, "local": local, "audio": f"{out_dir}/morning_{lang}.mp3"}
