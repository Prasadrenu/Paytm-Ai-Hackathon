"""Thin wrappers: one function per Sarvam capability, with a running rupee estimate."""
import base64, json, time
import requests
from sarvamai import SarvamAI
from .config import BASE, M, require_key

_sdk = None
SPEND = {"inr": 0.0}  # rough local estimate, from the published price list


def sdk() -> SarvamAI:
    global _sdk
    if _sdk is None:
        _sdk = SarvamAI(api_subscription_key=require_key())
    return _sdk


def _post(path, body, tries=3):
    for i in range(tries):
        r = requests.post(f"{BASE}{path}", json=body, timeout=120,
                          headers={"api-subscription-key": require_key()})
        if r.status_code in (429, 502, 503) and i < tries - 1:
            time.sleep(2 ** i); continue
        if not r.ok:
            raise RuntimeError(f"{r.status_code} {r.text[:300]}")
        return r.json()


# ---- speech ---------------------------------------------------------------
def stt(audio_path, model=None, mode="transcribe", lang="unknown"):
    with open(audio_path, "rb") as f:
        r = sdk().speech_to_text.transcribe(file=f, model=model or M["stt"], mode=mode, language_code=lang)
    return r.transcript


VOICE = "simran"   # the app's one voice: Bulbul v3, measured clearly female (pitch ~190-240 Hz) in every supported language
PACE = 1.0         # normal speed


def tts(text, lang="hi-IN", model=None, speaker=None, out_path=None, pace=None):
    """Speak text in the app's one female voice at normal speed (Bulbul v3 speaks every supported language).
    Other models may be requested explicitly, with their own speaker names."""
    model = model or M["voice_model"]
    kw = {}
    if model.endswith("v3"):
        kw = {"speaker": speaker or VOICE, "pace": pace or PACE, "speech_sample_rate": 24000}
    elif speaker:
        kw["speaker"] = speaker
    r = sdk().text_to_speech.convert(text=text[:2500], language_code=lang, model=model, **kw)
    audio = base64.b64decode(r.audios[0])
    SPEND["inr"] += len(text) / 10000 * (3 if model.endswith("v3") else 1)   # per the published per-character prices
    if out_path:
        open(out_path, "wb").write(audio)
    return audio


# ---- translation ----------------------------------------------------------
def translate(text, target, model=None, mode="modern-colloquial"):
    kw = dict(input=text, source_language_code="en-IN", target_language_code=target, model=model or M["mayura"])
    if (model or M["mayura"]).startswith("mayura"):
        kw["mode"] = mode
    return sdk().text.translate(**kw).translated_text


# ---- document intelligence (menu photo / PDF) -----------------------------
def vision_parse(path, lang="en-IN", fmt="md"):
    with open(path, "rb") as f:
        job = sdk().doc_ai.parse(file=[(path.split("/")[-1], f, "application/pdf")], language=lang, output_format=fmt)
    while True:
        st = sdk().doc_ai.get_status(job_id=job.job_id)
        if st.status.lower() in {"completed", "partially_completed", "failed", "rejected"}:
            break
        time.sleep(4)
    return sdk().doc_ai.get_download_url(job_id=job.job_id), st


# ---- LLMs -----------------------------------------------------------------
def chat(prompt, model=None, system=None, max_tokens=600, image_b64=None, json_mode=False):
    """sarvam-105b* use /v1; Token Factory open-weight models use /v2. Both OpenAI-shaped."""
    model = model or M["llm"]
    msgs = ([{"role": "system", "content": system}] if system else [])
    content = prompt if not image_b64 else [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}]
    msgs.append({"role": "user", "content": content})
    body = {"model": model, "messages": msgs, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    path = "/v1/chat/completions" if model.startswith("sarvam-105b") else "/v2/chat/completions"
    j = _post(path, body)
    return j["choices"][0]["message"]["content"] or ""


def decide(state, questions, model=None):
    """Prism / Clef decisions: calibrated probabilities, no generated text."""
    j = _post("/v2/systemone", {"model": model or M["prism"], "state": state, "questions": questions})
    return {k: v for k, v in (j.get("answers") or {}).items()}


def embed(texts):
    j = _post("/v2/embeddings", {"model": M["embed"], "input": texts})
    return [d["embedding"] for d in sorted(j["data"], key=lambda d: d["index"])]


# ---- document scanning: pages (JPEG bytes) -> markdown text via Sarvam Vision ----
def read_document(pages, lang="en-IN", kind="mixed", timeout=120):
    """pages: list of JPEG bytes (max 10). One page goes as a JPG, several as a flat ZIP."""
    import io, zipfile
    if not pages:
        raise ValueError("no pages")
    if len(pages) == 1:
        f = ("page1.jpg", pages[0], "image/jpeg")
    else:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for i, p in enumerate(pages[:10], 1):
                z.writestr(f"page{i:02d}.jpg", p)
        f = ("pages.zip", buf.getvalue(), "application/zip")
    job = sdk().doc_ai.parse(file=[f], language=lang, content_type=kind)
    t0 = time.time()
    while True:
        st = sdk().doc_ai.get_status(job_id=job.job_id)
        s = st.status.lower()
        if s in ("completed", "partially_completed"):
            break
        if s in ("failed", "rejected"):
            raise RuntimeError(f"document job {s}")
        if time.time() - t0 > timeout:
            raise RuntimeError("document job timed out")
        time.sleep(2)
    dl = sdk().doc_ai.get_download_url(job_id=job.job_id)
    r = requests.get(dl.url, timeout=60)
    r.raise_for_status()
    import html, re
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        names = z.namelist()
        for ext in (".md", ".html"):
            hit = sorted(n for n in names if n.lower().endswith(ext))
            if hit:
                text = "\n\n".join(z.read(n).decode("utf-8", "replace") for n in hit)
                if ext == ".html":
                    text = re.sub(r"(?is)<(style|script|head)\b.*?</\1>", "", text)
                    text = re.sub(r"(?i)</(p|div|h\d|tr|li|table)>|<br\s*/?>", "\n", text)
                    text = re.sub(r"(?i)</t[dh]>", " | ", text)
                    text = re.sub(r"<[^>]+>", "", text)
                    text = html.unescape(text)
                    text = re.sub(r"[ \t]+", " ", text)
                    text = re.sub(r"\n\s*\n+", "\n", text)
                return text.strip()
        raise RuntimeError("no text in output: " + ", ".join(names)[:200])
