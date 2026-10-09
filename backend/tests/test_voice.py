"""Tests for voice ASR endpoint — no network, SDK fully mocked.

Run from repo root:
    python -m pytest backend/tests/test_voice.py -v --noconftest
"""

from __future__ import annotations

import base64
import io
import sys
import wave
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))

from trtc_asr import ASRError  # noqa: E402

from backend.shared.voice_asr import (  # noqa: E402
    parse_audio_data_url,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_wav_bytes(
    seconds: float = 2.0,
    sample_rate: int = 16000,
    n_channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    """Generate ``seconds`` of silence as a WAV bytes blob."""
    n_frames = int(seconds * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(n_channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n_frames)
    return buf.getvalue()


def _make_wav_data_url(seconds: float = 2.0) -> str:
    raw = _make_wav_bytes(seconds)
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:audio/wav;base64,{b64}"


def _make_data_url(mime: str, payload: bytes) -> str:
    b64 = base64.b64encode(payload).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _make_mock_response(
    *,
    code: int = 0,
    text: str = "hello world",
    duration_ms: int = 2000,
    language: str = "en",
    request_id: str = "req-123",
) -> Any:
    """Return a mock object with the same fields as TranscribeResponse."""
    resp = MagicMock()
    resp.code = code
    resp.result = text
    resp.audio_duration = duration_ms
    resp.language = language
    resp.request_id = request_id
    resp.message = ""
    return resp


def _make_mock_sdk(
    *,
    recognizer: MagicMock | None = None,
) -> dict[str, Any]:
    """Build a fake SDK dict as returned by ``_import_sdk()``.

    ``recognizer`` is the mock SentenceRecognizer instance to return.
    If omitted, a default mock with a successful response is created.
    """
    if recognizer is None:
        recognizer = MagicMock()
        recognizer.recognize_data_with_options.return_value = _make_mock_response()

    def fake_sentence_recognizer(credential):
        return recognizer

    return {
        "ASRError": ASRError,
        "SITE_INTL": "intl",
        "SentenceRecognizer": fake_sentence_recognizer,
        "TranscribeRequest": MagicMock,
        "new_credential": MagicMock(),
    }


@pytest.fixture()
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _patch_env(monkeypatch):
    """Provide fake ASR credentials for every test by default."""
    monkeypatch.setenv("TRTC_ASR_SDK_APP_ID", "1234567890")
    monkeypatch.setenv("TRTC_ASR_SECRET_KEY", "fake-secret-key-for-testing")


# ---------------------------------------------------------------------------
# (a) Successful WAV transcription
# ---------------------------------------------------------------------------


def test_wav_transcription_success(client):
    mock_resp = _make_mock_response(text="hello world")
    mock_recognizer = MagicMock()
    mock_recognizer.recognize_data_with_options.return_value = mock_resp
    mock_sdk = _make_mock_sdk(recognizer=mock_recognizer)

    with patch("backend.shared.voice_asr._import_sdk", return_value=mock_sdk):
        data_url = _make_wav_data_url(seconds=2.0)
        r = client.post(
            "/api/voice/transcribe",
            json={"audio": data_url, "language": "en"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] == "hello world"
    assert body["duration_ms"] == 2000
    assert body["language"] == "en"

    # Verify the mock received correct parameters.
    call_args = mock_recognizer.recognize_data_with_options.call_args
    audio_arg = call_args[0][0]  # first positional = audio bytes
    req_arg = call_args[0][1]  # second positional = TranscribeRequest
    assert isinstance(audio_arg, bytes)
    assert req_arg.engine_model_type == "bigmodel"
    assert req_arg.voice_format == "wav"
    assert req_arg.language == "en"


# ---------------------------------------------------------------------------
# (b) Unsupported mime → 415
# ---------------------------------------------------------------------------


def test_unsupported_mime_webm(client):
    data_url = _make_data_url("audio/webm;codecs=opus", b"\x00" * 100)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 415
    assert "Unsupported audio format" in r.json()["detail"]


# ---------------------------------------------------------------------------
# (c) Too big / too long
# ---------------------------------------------------------------------------


def test_too_big_3mb(client):
    # 4 MB payload (base64-encoded)
    big_payload = b"\x00" * (4 * 1024 * 1024)
    data_url = _make_data_url("audio/wav", big_payload)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()


def test_wav_too_long_61s(client):
    data_url = _make_wav_data_url(seconds=61.0)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()


# ---------------------------------------------------------------------------
# (d) Bad data URL / bad base64
# ---------------------------------------------------------------------------


def test_broken_base64(client):
    data_url = "data:audio/wav;base64,!!!not-base64!!!"
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Invalid audio data"


def test_not_a_data_url(client):
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": "hello", "language": "en"},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Invalid audio data"


# ---------------------------------------------------------------------------
# (e) Env missing → 503
# ---------------------------------------------------------------------------


def test_env_missing_503(client, monkeypatch):
    monkeypatch.delenv("TRTC_ASR_SDK_APP_ID", raising=False)
    monkeypatch.delenv("TRTC_ASR_SECRET_KEY", raising=False)

    data_url = _make_wav_data_url(seconds=2.0)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "Voice input is not configured"


# ---------------------------------------------------------------------------
# (f) SDK raises ASRError → 502, no secret in response
# ---------------------------------------------------------------------------


def test_sdk_raises_asr_error_502(client):
    err = ASRError(4001, "auth failed with secret_key=sk-xxx")

    mock_recognizer = MagicMock()
    mock_recognizer.recognize_data_with_options.side_effect = err
    mock_sdk = _make_mock_sdk(recognizer=mock_recognizer)

    with patch("backend.shared.voice_asr._import_sdk", return_value=mock_sdk):
        data_url = _make_wav_data_url(seconds=2.0)
        r = client.post(
            "/api/voice/transcribe",
            json={"audio": data_url, "language": "en"},
        )

    assert r.status_code == 502
    body_text = r.text.lower()
    assert "secret" not in body_text


# ---------------------------------------------------------------------------
# (g) SDK returns non-zero code → 502
# ---------------------------------------------------------------------------


def test_sdk_nonzero_code_502(client):
    mock_resp = _make_mock_response(code=4001, text="")
    mock_recognizer = MagicMock()
    mock_recognizer.recognize_data_with_options.return_value = mock_resp
    mock_sdk = _make_mock_sdk(recognizer=mock_recognizer)

    with patch("backend.shared.voice_asr._import_sdk", return_value=mock_sdk):
        data_url = _make_wav_data_url(seconds=2.0)
        r = client.post(
            "/api/voice/transcribe",
            json={"audio": data_url, "language": "en"},
        )

    assert r.status_code == 502
    assert r.json()["detail"] == "Voice recognition failed"


# ---------------------------------------------------------------------------
# (h) mime → voice_format mapping
# ---------------------------------------------------------------------------


def test_x_m4a_maps_to_m4a():
    raw = b"\x00" * 100
    raw_b64 = base64.b64encode(raw).decode("ascii")
    data_url = f"data:audio/x-m4a;base64,{raw_b64}"

    audio_bytes, voice_format = parse_audio_data_url(data_url)
    assert voice_format == "m4a"
    assert audio_bytes == raw


def test_ogg_maps_to_ogg_opus():
    raw = b"\x00" * 100
    raw_b64 = base64.b64encode(raw).decode("ascii")
    data_url = f"data:audio/ogg;base64,{raw_b64}"

    audio_bytes, voice_format = parse_audio_data_url(data_url)
    assert voice_format == "ogg-opus"
    assert audio_bytes == raw


# ---------------------------------------------------------------------------
# (i) trtc-asr not importable → 503
# ---------------------------------------------------------------------------


def test_sdk_not_installed_503(client, monkeypatch):
    """Simulate trtc_asr not being installed by poisoning sys.modules."""
    # Setting a module to None in sys.modules causes ImportError on import.
    monkeypatch.setitem(sys.modules, "trtc_asr", None)
    monkeypatch.setitem(sys.modules, "trtc_asr.v3", None)

    data_url = _make_wav_data_url(seconds=2.0)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "Voice input is not configured"


# ---------------------------------------------------------------------------
# (j) App ID not an integer → 503
# ---------------------------------------------------------------------------


def test_app_id_not_integer_503(client, monkeypatch):
    monkeypatch.setenv("TRTC_ASR_SDK_APP_ID", "abc")

    data_url = _make_wav_data_url(seconds=2.0)
    r = client.post(
        "/api/voice/transcribe",
        json={"audio": data_url, "language": "en"},
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "Voice input is not configured"


# ---------------------------------------------------------------------------
# (k) SDK raises RuntimeError → 502, no secret in response
# ---------------------------------------------------------------------------


def test_sdk_raises_runtime_error_502(client):
    err = RuntimeError("internal error with secret=sk-xxx")

    mock_recognizer = MagicMock()
    mock_recognizer.recognize_data_with_options.side_effect = err
    mock_sdk = _make_mock_sdk(recognizer=mock_recognizer)

    with patch("backend.shared.voice_asr._import_sdk", return_value=mock_sdk):
        data_url = _make_wav_data_url(seconds=2.0)
        r = client.post(
            "/api/voice/transcribe",
            json={"audio": data_url, "language": "en"},
        )

    assert r.status_code == 502
    body_text = r.text.lower()
    assert "secret" not in body_text
