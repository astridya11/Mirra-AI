"""Sync DeepSeek vision client for receipt OCR and photo analysis.

Uses the same API key, model, and base URL as ``backend.shared.llm_client``
but calls the chat-completions endpoint synchronously (``httpx.Client``) so
it can be used from the existing sync ``build_*`` functions in
``receipt_evidence`` and ``photo_evidence``.

The vision model accepts an ``image_url`` content part with a base64 data
URL.  This module never logs the API key or the base64 payload.
"""

from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any

import httpx

from backend.shared.llm_client import _API_KEY, _MODEL, _BASE_URL

logger = logging.getLogger(__name__)

# Magic bytes for JPEG / PNG detection.
_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _detect_mime(raw: bytes) -> str | None:
    """Return ``"image/jpeg"`` or ``"image/png"`` based on magic bytes, else None."""
    if raw.startswith(_JPEG_MAGIC):
        return "image/jpeg"
    if raw.startswith(_PNG_MAGIC):
        return "image/png"
    return None


def _strip_fences(text: str) -> str:
    """Strip ```` ``` ```` and ```` ```json ```` fences from *text*."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Remove opening fence line.
        first_nl = stripped.find("\n")
        if first_nl != -1:
            stripped = stripped[first_nl + 1 :]
        else:
            stripped = stripped[3:]  # "```" only, no newline
    if stripped.rstrip().endswith("```"):
        stripped = stripped.rstrip()[:-3]
    return stripped.strip()


def call_vision_json(
    system_prompt: str,
    user_text: str,
    image_path: str | Path,
    *,
    timeout_s: float = 60.0,
    max_retries: int = 1,
) -> dict[str, Any] | None:
    """Call DeepSeek vision with an image and return parsed JSON dict, or None.

    Sync (``httpx.Client``).  Reuses ``_API_KEY`` / ``_MODEL`` / ``_BASE_URL``
    from ``backend.shared.llm_client``.  If the API key is missing, returns
    None immediately.  On a 400 error, retries once without
    ``response_format``.  Any error, timeout, or non-dict JSON is caught and
    returns None (a one-line warning is logged; the key and base64 are never
    logged).

    Args:
        system_prompt: System message guiding the model.
        user_text: Text instruction for the user message.
        image_path: Path to a JPEG or PNG file on disk.
        timeout_s: Per-request timeout in seconds.
        max_retries: Extra attempts on 400 (1 = one retry without
            ``response_format``).

    Returns:
        Parsed dict from ``choices[0].message.content``, or None.
    """
    if not _API_KEY:
        return None

    # Read file bytes and detect mime.
    try:
        raw = Path(image_path).read_bytes()
    except Exception as exc:
        logger.warning("vision_client: cannot read %s: %s", image_path, exc)
        return None

    mime = _detect_mime(raw)
    if mime is None:
        logger.warning("vision_client: unsupported image format (not JPEG/PNG)")
        return None

    b64 = base64.b64encode(raw).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]

    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }

    def _build_payload(use_response_format: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": _MODEL,
            "messages": messages,
            "thinking": {"type": "disabled"},
            "temperature": 0,
        }
        if use_response_format:
            payload["response_format"] = {"type": "json_object"}
        return payload

    use_response_format = True
    got_400 = False
    for attempt in range(max_retries + 1):
        try:
            with httpx.Client(timeout=timeout_s) as client:
                resp = client.post(
                    _BASE_URL,
                    headers=headers,
                    json=_build_payload(use_response_format),
                )

            if resp.status_code == 400 and use_response_format and attempt < max_retries:
                # Retry once without response_format.
                use_response_format = False
                got_400 = True
                continue

            resp.raise_for_status()

            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            if not content:
                logger.warning("vision_client: empty content in response")
                return None

            parsed = json.loads(_strip_fences(content))
            if not isinstance(parsed, dict):
                logger.warning("vision_client: parsed JSON is not a dict")
                return None
            return parsed

        except Exception as exc:
            logger.warning("vision_client: call failed: %s", exc)
            return None

    return None
