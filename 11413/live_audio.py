"""Speak into the microphone, press Enter to stop, get a Saaras v4 transcript.
    python live_audio.py [lang]        e.g. hi-IN, te-IN, en-IN (default: auto-detect)
    python live_audio.py [lang] loop   keep going until Ctrl+C"""
import sys, threading, wave
import numpy as np
import sounddevice as sd
from smart_stall.clients import sdk

RATE = 16000
lang = sys.argv[1] if len(sys.argv) > 1 else "unknown"
loop = "loop" in sys.argv[2:]


def record(path="out/live.wav"):
    chunks, stop = [], threading.Event()
    threading.Thread(target=lambda: (input(), stop.set()), daemon=True).start()
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", callback=lambda d, *_: chunks.append(d.copy())):
        print("Recording... speak now, press Enter to stop.")
        stop.wait()
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype="int16")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(audio.tobytes())
    return path, len(audio) / RATE


while True:
    path, secs = record()
    if secs < 0.5:
        print("Too short, try again."); continue
    with open(path, "rb") as f:
        r = sdk().speech_to_text.transcribe(file=f, model="saaras:v4", language_code=lang, mode="transcribe")
    print(f"[{secs:.1f}s] -> {r.transcript}\n")
    if not loop:
        break
