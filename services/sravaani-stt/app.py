"""Private persistent SraVaani STT service for the VDA backend."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from transformers import AutoModel

MODEL_ID = "ARTPARK-IISc/SraVaani-0.5-live"
MAX_AUDIO_BYTES = 10 * 1024 * 1024
asr_model: Any | None = None
load_error: str | None = None
logger = logging.getLogger("sravaani_stt")


class SttFailure(Exception):
    """A safe, structured failure that can cross the private service boundary."""

    def __init__(self, category: str, stage: str, reason: str, status_code: int):
        super().__init__(reason)
        self.category = category
        self.stage = stage
        self.reason = reason
        self.status_code = status_code


def failure_response(failure: SttFailure) -> HTTPException:
    return HTTPException(
        status_code=failure.status_code,
        detail={"category": failure.category, "stage": failure.stage, "reason": failure.reason},
    )


def ffmpeg_reason(error: subprocess.CalledProcessError) -> str:
    """Classify FFmpeg output without returning raw output or temporary paths."""
    message = (error.stderr or b"").decode("utf-8", errors="replace").lower()
    if "ebml header parsing failed" in message:
        return "WEBM_HEADER_INVALID"
    if "invalid data found" in message:
        return "INVALID_CONTAINER_DATA"
    if "moov atom not found" in message:
        return "MP4_METADATA_MISSING"
    return "FFMPEG_DECODE_FAILED"


def load_model() -> None:
    """Loads SraVaani's custom remote-code model once at service startup."""
    global asr_model, load_error
    try:
        options: dict[str, Any] = {"trust_remote_code": True}
        token = os.getenv("HF_TOKEN", "").strip()
        if token:
            options["token"] = token
        # SraVaani publishes a custom streaming model.  The generic ASR pipeline
        # only supports the standard CTC/seq2seq model classes and rejects its
        # SraVaaniStreamingConfig.  Its documented remote-code API is
        # AutoModel.from_pretrained(...).transcribe(...).
        asr_model = AutoModel.from_pretrained(MODEL_ID, **options)
        asr_model.eval()
        load_error = None
    except Exception:
        # Keep model-access details private. The backend converts this into one
        # controlled Sarvam fallback, without exposing model or token details.
        asr_model = None
        load_error = "MODEL_UNAVAILABLE"
        logger.exception("SraVaani model startup failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(load_model)
    yield


app = FastAPI(title="VDA SraVaani STT", docs_url=None, redoc_url=None, lifespan=lifespan)


def extension_for(content_type: str | None) -> str:
    return {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
    }.get((content_type or "").lower(), ".audio")


def decode_to_16khz_mono(audio: bytes, content_type: str | None) -> dict[str, Any]:
    """Use local ffmpeg once per request; the temporary directory is deleted."""
    mime_type = (content_type or "").split(";", 1)[0].lower()
    extension = extension_for(mime_type)
    with tempfile.TemporaryDirectory(prefix="vda-sravaani-") as directory:
        source = Path(directory) / f"source{extension}"
        normalized = Path(directory) / "normalized.wav"
        source.write_bytes(audio)
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(source),
                 "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(normalized)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        except FileNotFoundError as exc:
            logger.warning(
                "SraVaani audio failure category=AUDIO_NORMALIZATION_FAILED "
                "mimeType=%s extension=%s audioBytes=%s failureStage=ffmpeg_normalization reason=FFMPEG_UNAVAILABLE",
                mime_type, extension, len(audio),
            )
            raise SttFailure("AUDIO_DECODE_FAILED", "ffmpeg_normalization", "FFMPEG_UNAVAILABLE", 503) from exc
        except subprocess.TimeoutExpired as exc:
            logger.warning(
                "SraVaani audio failure category=PROVIDER_TIMEOUT "
                "mimeType=%s extension=%s audioBytes=%s failureStage=ffmpeg_normalization",
                mime_type, extension, len(audio),
            )
            raise SttFailure("PROVIDER_TIMEOUT", "ffmpeg_normalization", "FFMPEG_TIMEOUT", 503) from exc
        except subprocess.CalledProcessError as exc:
            reason = ffmpeg_reason(exc)
            logger.warning(
                "SraVaani audio failure category=AUDIO_DECODE_FAILED "
                "mimeType=%s extension=%s audioBytes=%s failureStage=ffmpeg_normalization reason=%s exitCode=%s",
                mime_type, extension, len(audio), reason, exc.returncode,
            )
            raise SttFailure("AUDIO_DECODE_FAILED", "ffmpeg_normalization", reason, 415) from exc
        if not normalized.exists() or normalized.stat().st_size == 0:
            logger.warning(
                "SraVaani audio failure category=INVALID_AUDIO "
                "mimeType=%s extension=%s audioBytes=%s failureStage=normalized_output_validation",
                mime_type, extension, len(audio),
            )
            raise SttFailure("INVALID_AUDIO", "normalized_output_validation", "NORMALIZED_WAV_EMPTY", 415)
        try:
            with wave.open(str(normalized), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getframerate() != 16000 or wav.getsampwidth() != 2:
                    raise SttFailure("INVALID_AUDIO", "wav_validation", "NORMALIZED_WAV_INVALID", 415)
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
        except SttFailure:
            raise
        except (wave.Error, EOFError) as exc:
            logger.warning(
                "SraVaani audio failure category=INVALID_AUDIO "
                "mimeType=%s extension=%s audioBytes=%s failureStage=wav_validation",
                mime_type, extension, len(audio),
            )
            raise SttFailure("INVALID_AUDIO", "wav_validation", "NORMALIZED_WAV_INVALID", 415) from exc
        if samples.size == 0:
            raise SttFailure("INVALID_AUDIO", "waveform_validation", "WAVEFORM_EMPTY", 415)
    logger.info(
        "SraVaani audio normalization result=SUCCESS mimeType=%s extension=%s audioBytes=%s",
        mime_type, extension, len(audio),
    )
    return {"raw": samples.astype(np.float32) / 32768.0, "sampling_rate": 16000}


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ready" if asr_model else "unavailable", "model": MODEL_ID, "reason": load_error}


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language_hint: str | None = Form(default=None),
) -> dict[str, object]:
    if asr_model is None:
        raise failure_response(SttFailure("MODEL_UNAVAILABLE", "model_load", "MODEL_NOT_READY", 503))
    mime_type = (audio.content_type or "").split(";", 1)[0].lower()
    extension = extension_for(mime_type)
    if not mime_type.startswith("audio/"):
        logger.warning(
            "SraVaani audio failure category=UNSUPPORTED_AUDIO mimeType=%s extension=%s "
            "audioBytes=unknown failureStage=input_validation",
            mime_type or "missing", extension,
        )
        raise failure_response(SttFailure("UNSUPPORTED_AUDIO", "input_validation", "AUDIO_MIME_REQUIRED", 415))
    payload = await audio.read(MAX_AUDIO_BYTES + 1)
    if not payload:
        raise failure_response(SttFailure("INVALID_AUDIO", "size_validation", "AUDIO_EMPTY", 415))
    if len(payload) > MAX_AUDIO_BYTES:
        raise failure_response(SttFailure("INVALID_AUDIO", "size_validation", "AUDIO_TOO_LARGE", 413))
    try:
        normalized = await asyncio.to_thread(decode_to_16khz_mono, payload, mime_type)
    except SttFailure as failure:
        raise failure_response(failure) from None
    try:
        # The custom model accepts a batch of waveform arrays.  Supplying a
        # one-item batch keeps the full 16 kHz waveform intact instead of
        # treating individual samples as separate transcription inputs.
        result = await asyncio.to_thread(asr_model.transcribe, [normalized["raw"]])
    except Exception:
        logger.exception(
            "SraVaani inference failure category=INFERENCE_FAILED mimeType=%s "
            "extension=%s audioBytes=%s failureStage=model_inference",
            mime_type, extension, len(payload),
        )
        raise failure_response(SttFailure("MODEL_INFERENCE_FAILED", "model_inference", "MODEL_TRANSCRIBE_ERROR", 503)) from None
    transcript = str(result[0]).strip() if isinstance(result, list) and result else ""
    if not transcript:
        raise failure_response(SttFailure("MODEL_INFERENCE_FAILED", "result_validation", "TRANSCRIPT_EMPTY", 503))
    response: dict[str, object] = {"transcript": transcript, "model": MODEL_ID}
    # Do not manufacture a language detection result from the UI language hint.
    if language_hint:
        response["language_hint_used"] = language_hint
    return response
