"""Central config. The key comes from the environment only; never hard-code it."""
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("SARVAM_API_KEY", "")
BASE = "https://api.sarvam.ai"

# Model IDs, as listed at docs.sarvam.ai/api/getting-started/models
M = dict(
    stt="saaras:v4", stt_prev="saaras:v3",
    tts="bulbul:v4-flash", tts_stable="bulbul:v3",
    mayura="mayura:v1", translate="sarvam-translate:v1",
    llm="sarvam-105b", chat="sarvam-105b-conversations",
    prism="sarvam-prism", clef="clef",
    glm="glm5.3", glm_flash="glm5.3-flash", gemma="gemma4",
    ds_flash="deepseekv4.1-flash-1017", ds_pro="deepseekv4-pro",
    kimi="kimi-k3.1-pro", qwen="qwen38-27b",
    embed="embeddinggemma-2",
)
# Enabled per organisation on Sarvam's side; may return 403/404 on a hackathon key.
PROVISIONED = {"ds_pro", "kimi", "qwen", "clef", "embed"}


def require_key() -> str:
    if not API_KEY:
        raise SystemExit("SARVAM_API_KEY is not set. Copy .env.example to .env and add your key.")
    return API_KEY
