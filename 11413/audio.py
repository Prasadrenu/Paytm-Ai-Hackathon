"""Transcribe an audio file with Saaras v4.   python audio.py [path] [lang]
Defaults: audio.wav, auto-detect language. The key is read from .env."""
import sys
from smart_stall.clients import sdk

path = sys.argv[1] if len(sys.argv) > 1 else "audio.wav"
lang = sys.argv[2] if len(sys.argv) > 2 else "unknown"  # e.g. en-IN, hi-IN, te-IN

with open(path, "rb") as f:
    response = sdk().speech_to_text.transcribe(
        file=f,
        model="saaras:v4",
        language_code=lang,
        mode="transcribe",
    )

print(response.transcript)
    