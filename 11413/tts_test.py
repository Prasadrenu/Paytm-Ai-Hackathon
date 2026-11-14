"""Text-to-speech test with Bulbul.   python tts_test.py [text] [lang] [--play]
Writes out/speech_stream.mp3 (streaming) and out/speech_full.mp3 (one-shot) and prints time to first audio."""
import os, sys, time
from smart_stall.clients import sdk

args = [a for a in sys.argv[1:] if not a.startswith("--")]
text = args[0] if args else ("नमस्ते! आज आपके स्टॉल के लिए सुझाव: समोसे सौ बनाइए और लस्सी तीस प्रतिशत ज़्यादा। "
                             "आपका सबसे व्यस्त समय शाम पाँच से आठ बजे रहेगा।")
lang = args[1] if len(args) > 1 else "hi-IN"
SPEAKER = "shubh_enhi_ads" if lang == "hi-IN" else None   # speaker names are model/language specific
kw = dict(text=text, language_code=lang, model="bulbul:v4-flash", pace=1, speech_sample_rate=24000)
if SPEAKER: kw["speaker"] = SPEAKER
os.makedirs("out", exist_ok=True)

# 1. Streaming: audio arrives in chunks, so playback can start before synthesis finishes.
t = time.time(); first = None; data = b""
for chunk in sdk().text_to_speech.convert_stream(**kw):
    if first is None: first = time.time() - t
    data += chunk
open("out/speech_stream.mp3", "wb").write(data)
print(f"stream : first audio {first:.2f}s, total {time.time()-t:.2f}s, {len(data)/1024:.0f} KB -> out/speech_stream.mp3")

# 2. One-shot: whole clip returned base64 in a single response.
import base64
t = time.time(); r = sdk().text_to_speech.convert(**kw)
full = base64.b64decode(r.audios[0]); open("out/speech_full.mp3", "wb").write(full)
print(f"oneshot: total {time.time()-t:.2f}s, {len(full)/1024:.0f} KB -> out/speech_full.mp3")
print(f"~cost: Rs {len(text)/10000*5:.2f} per call at the Bulbul v4 Flash rate (estimate)")

if "--play" in sys.argv:
    os.startfile(os.path.abspath("out/speech_stream.mp3"))   # opens in the default Windows player
