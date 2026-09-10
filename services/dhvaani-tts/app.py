"""Private persistent DhVaani TTS service for the VDA backend."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoModel

MODEL_ID = "ARTPARK-IISc/DhVaani-0.5"
MAX_TEXT_CHARS = 2500
SERVICE_DIR = Path(__file__).resolve().parent

# Reference-voice configuration belongs only to this private local service.
# It is neither sent to NestJS nor emitted to logs, audits, or telemetry.
load_dotenv(SERVICE_DIR / ".env")

tts_model: Any | None = None
reference_wav: Path | None = None
reference_text: str | None = None
sample_rate: int | None = None
load_error: str | None = None
logger = logging.getLogger("dhvaani_tts")
ffmpeg_dll_directory_handle: Any | None = None


class TtsFailure(Exception):
    def __init__(self, category: str, reason: str, status_code: int):
        super().__init__(reason)
        self.category = category
        self.reason = reason
        self.status_code = status_code


class SynthesisRequest(BaseModel):
    text: str
    language_code: str | None = None


def failure_response(failure: TtsFailure) -> HTTPException:
    return HTTPException(
        status_code=failure.status_code,
        detail={"category": failure.category, "reason": failure.reason},
    )


def configured_reference() -> tuple[Path, str]:
    configured_path = os.getenv("DHVAANI_REFERENCE_WAV", "").strip()
    configured_text = os.getenv("DHVAANI_REFERENCE_TEXT", "").strip()
    if not configured_path or not configured_text:
        raise TtsFailure("REFERENCE_UNAVAILABLE", "REFERENCE_NOT_CONFIGURED", 503)

    path = Path(configured_path).expanduser()
    if path.suffix.lower() != ".wav" or not path.is_file():
        raise TtsFailure("REFERENCE_UNAVAILABLE", "REFERENCE_WAV_UNAVAILABLE", 503)
    try:
        info = sf.info(str(path))
    except Exception as exc:
        raise TtsFailure("REFERENCE_UNAVAILABLE", "REFERENCE_WAV_INVALID", 503) from exc
    if info.frames <= 0 or info.samplerate <= 0 or info.channels <= 0:
        raise TtsFailure("REFERENCE_UNAVAILABLE", "REFERENCE_WAV_INVALID", 503)
    return path, configured_text


def configure_ffmpeg_shared_libraries() -> None:
    """Expose configured FFmpeg shared DLLs to TorchCodec on Windows.

    This is private service configuration rather than a value supplied by
    NestJS or a patient request. Keep the handle for the model-process
    lifetime so Python continues to resolve the native libraries.
    """
    global ffmpeg_dll_directory_handle
    configured_path = os.getenv("DHVAANI_FFMPEG_BIN", "").strip()
    if not configured_path or os.name != "nt":
        return
    path = Path(configured_path).expanduser()
    if not path.is_dir():
        raise RuntimeError("FFMPEG_SHARED_LIBRARIES_UNAVAILABLE")
    ffmpeg_dll_directory_handle = os.add_dll_directory(str(path))


def load_resources() -> None:
    """Validate the approved reference once, then load the model once at startup."""
    global tts_model, reference_wav, reference_text, sample_rate, load_error
    tts_model = None
    reference_wav = None
    reference_text = None
    sample_rate = None
    try:
        configured_wav, configured_text = configured_reference()
    except TtsFailure as failure:
        load_error = failure.reason
        logger.warning("DhVaani startup unavailable category=%s", failure.category)
        return

    try:
        import torch

        configure_ffmpeg_shared_libraries()
        options: dict[str, Any] = {"trust_remote_code": True}
        token = os.getenv("HF_TOKEN", "").strip()
        if token:
            options["token"] = token
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = AutoModel.from_pretrained(MODEL_ID, **options).to(device).eval()
        model_sample_rate = int(model.sampling_rate)
        if model_sample_rate != 24000:
            raise RuntimeError("UNEXPECTED_SAMPLE_RATE")
        tts_model = model
        reference_wav = configured_wav
        reference_text = configured_text
        sample_rate = model_sample_rate
        load_error = None
    except Exception:
        tts_model = None
        reference_wav = None
        reference_text = None
        sample_rate = None
        load_error = "MODEL_UNAVAILABLE"
        logger.exception("DhVaani model startup failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(load_resources)
    yield


app = FastAPI(title="VDA DhVaani TTS", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ready" if tts_model and reference_wav and reference_text and sample_rate else "unavailable",
        "model": MODEL_ID,
        "sample_rate": sample_rate or 24000,
        "reason": load_error,
    }


@app.post("/synthesize")
async def synthesize(request: SynthesisRequest) -> Response:
    text = request.text.strip()
    if not text or len(text) > MAX_TEXT_CHARS:
        raise failure_response(TtsFailure("INVALID_TEXT", "TEXT_INVALID", 400))
    if tts_model is None:
        category = "REFERENCE_UNAVAILABLE" if load_error and load_error.startswith("REFERENCE_") else "MODEL_UNAVAILABLE"
        raise failure_response(TtsFailure(category, load_error or "MODEL_NOT_READY", 503))
    if reference_wav is None or reference_text is None or sample_rate is None:
        raise failure_response(TtsFailure("REFERENCE_UNAVAILABLE", "REFERENCE_NOT_READY", 503))
    try:
        started_at = time.perf_counter()
        # DhVaani's official remote-code API accepts target text, a reference
        # WAV path, and its exact transcript. Patient microphone recordings are
        # never accepted by this local endpoint.
        audio = await asyncio.to_thread(
            tts_model.synthesize,
            text=text,
            prompt_wav=str(reference_wav),
            prompt_text=reference_text,
        )
        waveform = np.asarray(audio, dtype=np.float32).reshape(-1)
        if waveform.size == 0 or not np.isfinite(waveform).all():
            raise ValueError("AUDIO_INVALID")
        output = io.BytesIO()
        sf.write(output, waveform, sample_rate, format="WAV", subtype="PCM_16")
        wav_bytes = output.getvalue()
        if not wav_bytes:
            raise ValueError("AUDIO_EMPTY")
        logger.info("DhVaani synthesis completed latency_ms=%d", (time.perf_counter() - started_at) * 1000)
    except Exception:
        # Do not log response text, generated audio, reference audio, or the
        # reference transcript. The category is enough for one Sarvam fallback.
        logger.exception("DhVaani synthesis failed category=MODEL_INFERENCE_FAILED")
        raise failure_response(TtsFailure("MODEL_INFERENCE_FAILED", "SYNTHESIS_FAILED", 503)) from None
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"X-VDA-TTS-Model": MODEL_ID, "X-VDA-TTS-Sample-Rate": str(sample_rate)},
    )
