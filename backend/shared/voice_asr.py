"""Tencent TRTC ASR one-sentence recognition client (v3 protocol).

Wraps the synchronous ``SentenceRecognizer`` from ``trtc_asr.v3`` so the
existing blocking endpoints in ``backend.main`` can call it directly.

Env vars (read at call time so tests can monkeypatch):

  TRTC_ASR_SDK_APP_ID  – numeric SDK app id
  TRTC_ASR_SECRET_KEY   – secret key string

This module never logs or returns the secret key.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import wave
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load backend/.env the same way backend.shared.llm_client does.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"
load_dotenv(_ENV_FILE)

logger = logging.getLogger(__name__)

# --- Limits -------------------------------------------------------------------

_MAX_BYTES = 3 * 1024 * 1024  # 3 MB
_MAX_WAV_SECONDS = 60.0


# --- Exceptions ----------------------------------------------------------------


class ASRNotConfigured(Exception):
    """Raised when TRTC_ASR_SDK_APP_ID or TRTC_ASR_SECRET_KEY is missing."""


class AudioRejected(Exception):
    """Raised for 413 / 415 / 422 type rejections (size, format, bad data).

    ``status`` mirrors the HTTP status the caller should return.
    """

    def __init__(self, status: int, message: str = ""):
        self.status = status
        self.message = message
        super().__init__(message)


class VoiceError(Exception):
    """Wraps a non-zero SDK error code (502 territory)."""

    def __init__(self, code: int, request_id: str = ""):
        self.code = code
        self.request_id = request_id
        super().__init__(f"voice error code={code}")


# --- Mime → voice-format mapping ------------------------------------------------

_MIME_MAP: dict[str, str] = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg-opus",
}


# --- Data-URL parsing -----------------------------------------------------------


def parse_audio_data_url(data_url: str) -> tuple[bytes, str]:
    """Parse a ``data:audio/...;base64,...`` URL.

    Returns ``(decoded_bytes, voice_format)``.

    Raises:
        AudioRejected(415): mime not in the allowed set (incl. ``audio/webm``).
        AudioRejected(413): decoded payload exceeds 3 MB.
        AudioRejected(422): not a data URL, bad base64, or empty payload.
    """
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise AudioRejected(422, "Invalid audio data")

    # data:audio/wav;codecs=opus;base64,AAAA
    header, _, b64 = data_url.partition(",")
    if not b64:
        raise AudioRejected(422, "Invalid audio data")

    # header = "data:audio/wav;codecs=opus;base64"
    meta = header[5:]  # strip "data:"
    # Split mime from parameters and flag
    mime_part = meta.split(";")[0].strip().lower()
    # mime_part is like "audio/wav"

    voice_format = _MIME_MAP.get(mime_part)
    if voice_format is None:
        raise AudioRejected(415, "Unsupported audio format")

    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise AudioRejected(422, "Invalid audio data")

    if len(raw) < 1 or len(raw) > _MAX_BYTES:
        raise AudioRejected(413, "Recording too large")

    return raw, voice_format


# --- WAV duration check ---------------------------------------------------------


def _wav_duration_seconds(raw: bytes) -> float:
    """Return the playback duration of a WAV ``bytes`` blob, or raise 422."""
    try:
        with wave.open(io.BytesIO(raw), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                raise AudioRejected(422, "Invalid audio data")
            return frames / rate
    except wave.Error:
        raise AudioRejected(422, "Invalid audio data")
    except Exception:
        raise AudioRejected(422, "Invalid audio data")


# --- Lazy SDK import -----------------------------------------------------------


def _import_sdk() -> Any:
    """Lazily import the trtc_asr SDK so the backend starts without it.

    Returns a dict with ``ASRError``, ``SITE_INTL``, ``SentenceRecognizer``,
    ``TranscribeRequest``, ``new_credential``.

    Raises:
        ASRNotConfigured: if the package is not installed.
    """
    try:
        from trtc_asr import ASRError, SITE_INTL
        from trtc_asr.v3 import SentenceRecognizer, TranscribeRequest, new_credential

        return {
            "ASRError": ASRError,
            "SITE_INTL": SITE_INTL,
            "SentenceRecognizer": SentenceRecognizer,
            "TranscribeRequest": TranscribeRequest,
            "new_credential": new_credential,
        }
    except ImportError:
        logger.warning(
            "trtc-asr not installed: pip install -r backend/requirements.txt"
        )
        raise ASRNotConfigured(
            "trtc-asr not installed: pip install -r backend/requirements.txt"
        )


# --- Credential + transcribe ----------------------------------------------------


def _get_credential() -> Any:
    """Build a Credential at call time from env vars, or raise ASRNotConfigured."""
    app_id = os.getenv("TRTC_ASR_SDK_APP_ID")
    secret_key = os.getenv("TRTC_ASR_SECRET_KEY")
    if not app_id or not secret_key:
        raise ASRNotConfigured("TRTC_ASR_SDK_APP_ID / TRTC_ASR_SECRET_KEY not set")

    sdk = _import_sdk()

    try:
        numeric_app_id = int(app_id)
    except (ValueError, TypeError):
        raise ASRNotConfigured("TRTC_ASR_SDK_APP_ID must be a numeric value")

    credential = sdk["new_credential"](numeric_app_id, secret_key)
    credential.site = sdk["SITE_INTL"]
    return credential, sdk


def transcribe(audio: bytes, voice_format: str, language: str = "en") -> dict:
    """Call TRTC ASR one-sentence recognition on raw audio bytes.

    Returns ``{text, duration_ms, language, request_id}``.

    Raises:
        ASRNotConfigured: env vars missing or SDK not installed.
        VoiceError: SDK error, non-zero response code, or unexpected exception.
    """
    credential, sdk = _get_credential()

    # Enforce size limit before passing to SDK.
    if len(audio) < 1 or len(audio) > _MAX_BYTES:
        raise VoiceError(413)

    recognizer = sdk["SentenceRecognizer"](credential)
    req = sdk["TranscribeRequest"](
        engine_model_type="bigmodel",
        voice_format=voice_format,
        language=language,
        word_info=0,
    )

    try:
        resp = recognizer.recognize_data_with_options(audio, req)
    except sdk["ASRError"] as exc:
        request_id = getattr(exc, "request_id", "") or ""
        logger.warning("ASR error code=%s request_id=%s", exc.code, request_id)
        raise VoiceError(exc.code, request_id) from exc
    except Exception as exc:
        logger.warning("ASR unexpected %s", type(exc).__name__)
        raise VoiceError(-1) from exc

    # Non-zero code → treat as failure (offline requests can return HTTP 200
    # on auth failure).
    if resp.code != 0:
        logger.warning("ASR non-zero code=%s request_id=%s", resp.code, resp.request_id)
        raise VoiceError(resp.code, resp.request_id)

    return {
        "text": resp.result or "",
        "duration_ms": resp.audio_duration or 0,
        "language": resp.language or language,
        "request_id": resp.request_id or "",
    }
