"""End-to-end demo:  python demo.py [lang_code]   (default te-IN)"""
import sys, datetime as dt
from smart_stall import forecast as f, planner as p

lang = sys.argv[1] if len(sys.argv) > 1 else "te-IN"
path = f.make_sample()
rows = f.load(path)
wx = f.weather()
q, waste = f.plan(rows, dt.date.today() + dt.timedelta(days=1), wx)
print("Weather:", wx, "| Plan:", q, "| Last-7-day wastage Rs", waste)
r = p.run_day(rows, q, wx, lang)
print("\nEN:", r["english"], "\n\nLOCAL:", r["local"], "\n\nAudio:", r["audio"])
print("\nOffer gate (slow day, 55% of usual):", p.should_offer(55, wx["rain_pct"], 15))
