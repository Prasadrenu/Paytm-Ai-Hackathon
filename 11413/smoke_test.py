"""Calls every Sarvam model once with a tiny input and reports OK / FAIL.  python smoke_test.py
Estimated cost: a few rupees. Provisioned models may fail with 403/404 if not enabled for your org."""
import base64, io, time, traceback
from smart_stall import clients as c
from smart_stall.config import M, PROVISIONED

results = []


def check(name, fn):
    t = time.time()
    try:
        out = fn()
        results.append((name, "OK", f"{time.time()-t:.1f}s", str(out)[:70].replace("\n", " ")))
    except Exception as e:
        results.append((name, "FAIL", f"{time.time()-t:.1f}s", str(e)[:110].replace("\n", " ")))


def tiny_png():
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (360, 160), "white"); d = ImageDraw.Draw(im)
    d.text((20, 20), "MENU", fill="black"); d.text((20, 60), "Samosa   Rs 15", fill="black"); d.text((20, 90), "Chai     Rs 10", fill="black")
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def tiny_pdf(path="out/menu.pdf"):
    s = b"BT /F1 24 Tf 72 700 Td (Menu: Samosa Rs 15, Chai Rs 10) Tj ET"
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
            b"<</Length %d>>stream\n" % len(s) + s + b"\nendstream", b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out); out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs: out += b"%010d 00000 n \n" % o
    out += b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, x)
    open(path, "wb").write(out); return path


# 1. Speech: Bulbul v4 Flash and v3 produce audio, then Saaras v4 / v3 transcribe it back.
check("bulbul v4-flash (TTS)", lambda: len(c.tts("Aaj sau samose banaiye", "hi-IN", M["tts"], out_path="out/t1.wav")))
check("bulbul v3 (TTS)", lambda: len(c.tts("Aaj sau samose banaiye", "hi-IN", M["tts_stable"], out_path="out/t2.wav")))
check("saaras v4 (STT)", lambda: c.stt("out/t1.wav", M["stt"]))
check("saaras v3 (STT)", lambda: c.stt("out/t2.wav", M["stt_prev"]))
# 2. Translation
check("mayura (translate)", lambda: c.translate("Make 30 percent more lassi today.", "hi-IN", M["mayura"]))
check("sarvam-translate", lambda: c.translate("Make 30 percent more lassi today.", "mr-IN", M["translate"]))
# 3. Document intelligence
check("sarvam-vision (doc AI)", lambda: c.vision_parse(tiny_pdf())[1].status)
# 4. Sarvam chat LLMs
check("sarvam-105b", lambda: c.chat("Say hi in one word.", M["llm"], max_tokens=300))
check("sarvam-105b-conversations", lambda: c.chat("Say hi in one word.", M["chat"], max_tokens=100))
# 5. Decision models
st = {"sales_vs_usual_pct": 55, "rain_pct": 10}
q = {"slow": {"type": "noul", "instructions": "Is today a slow sales day?"}}
check("sarvam-prism", lambda: c.decide(st, q, M["prism"]))
check("clef", lambda: c.decide(st, q, M["clef"]))
# 6. Open-weight chat LLMs (text)
for k in ("glm", "ds_flash", "ds_pro", "kimi", "qwen"):
    check(M[k], lambda k=k: c.chat("Say hi in one word.", M[k], max_tokens=300))
# 7. Open-weight multimodal: read the menu image
img = None
try: img = base64.b64encode(tiny_png()).decode()
except Exception: pass
for k in ("gemma", "glm_flash"):
    check(M[k] + " (image)", lambda k=k: c.chat("List items and prices.", M[k], max_tokens=400, image_b64=img))
# 8. Embeddings
check("embeddinggemma-2", lambda: len(c.embed(["samosa", "समोसा"])[0]))

w = max(len(r[0]) for r in results)
for n, s, t, d in results:
    print(f"{n:<{w}}  {s:<4}  {t:>6}  {d}")
print(f"\n{sum(r[1]=='OK' for r in results)}/{len(results)} OK.  Failures on provisioned models "
      f"({', '.join(M[k] for k in PROVISIONED)}) usually mean 'not enabled for your org', not a code bug.")
