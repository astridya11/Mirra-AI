"""Receipt → ReceiptEvidenceInput upload adapter.

This module is the **upload → data** step: it reads a receipt image file from
disk and returns a ``ReceiptEvidenceInput`` dict (schema-defined in
``shared/schemas.json``) ready for the orchestrator's
``data_sources.receipt_evidence`` list.

What it does (Pillow only, no external services):
  1. **Image open check** — opens the file with Pillow (JPEG/PNG).  If it
     cannot be opened as an image, the receipt is returned with only
     ``receipt_id``, ``receipt_url`` (and ``uploaded_at`` if given) — no
     ``ocr_result`` — meaning the receipt is present but unreadable.
  2. **uploaded_at normalisation** — if provided, normalised to ISO 8601
     with offset (naive timestamps are assumed +08:00).  Invalid values are
     silently dropped.
  3. **OCR result assembly** — from an *annotation* dict (default: look up
     ``receipt_id`` in ``backend/mock_evidence/receipt_annotations.json``).
     Fields are validated against ``ReceiptOcrResult``: ``amount`` must be a
     finite number ≥ 0 (not bool); ``currency`` defaults to ``"SGD"``;
     ``receipt_date`` must be ISO 8601 parseable (naive assumed +08:00);
     ``ocr_confidence`` must be 0–1; ``merchant_name`` must be non-empty.
     If ``amount`` is missing or invalid, ``ocr_result`` is omitted entirely
     (the receipt is unreadable for pricing purposes).

Amounts come from the annotation file until an OCR provider is connected.
"""

from __future__ import annotations

import io
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from PIL import Image

from backend.shared.photo_evidence import (
    detect_ai_generator_markers,
    extract_exif_software,
)
from backend.shared.vision_client import call_vision_json

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SGT = timezone(timedelta(hours=8))

_DEFAULT_TZ_OFFSET = "+08:00"

# Directory of this module — used for default annotation path.
_THIS_DIR = Path(__file__).resolve().parent  # backend/shared/
_BACKEND_DIR = _THIS_DIR.parent  # backend/
_MOCK_EVIDENCE_DIR = _BACKEND_DIR / "mock_evidence"
_DEFAULT_ANNOTATIONS_PATH = _MOCK_EVIDENCE_DIR / "receipt_annotations.json"

# Known editing-software names to detect in EXIF Software / XMP.
# Used only to record an edit-software fact — NOT a fraud signal.
_EDIT_SOFTWARE_MARKERS = (
    "photoshop",
    "lightroom",
    "canva",
    "snapseed",
    "picsart",
    "gimp",
)


# ---------------------------------------------------------------------------
# JSON loading helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    """Load a JSON object from *path*.  Returns {} on any error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _load_default_annotations() -> dict:
    return _load_json(_DEFAULT_ANNOTATIONS_PATH)


# ---------------------------------------------------------------------------
# Validation helpers (mirrors ReceiptOcrResult schema constraints)
# ---------------------------------------------------------------------------

def _is_strict_bool(value: Any) -> bool:
    return type(value) is bool


def _is_valid_amount(value: Any) -> bool:
    """True when *value* is a finite number >= 0 and not a bool."""
    if _is_strict_bool(value):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(f):
        return False
    return f >= 0


def _is_valid_confidence(value: Any) -> bool:
    """True when *value* is a float/int in [0, 1] and not a bool."""
    if _is_strict_bool(value):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(f):
        return False
    return 0.0 <= f <= 1.0


def _normalise_receipt_date(value: Any) -> str | None:
    """Normalise *value* to an ISO 8601 string with offset.

    Naive datetimes are assumed +08:00.  Returns None if the value cannot
    be parsed by ``datetime.fromisoformat``.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_SGT)
    return dt.isoformat()


def _normalise_uploaded_at(value: Any) -> str | None:
    """Normalise *value* to an ISO 8601 string with offset.

    Naive datetimes are assumed +08:00.  Returns None if invalid.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_SGT)
    return dt.isoformat()


# ---------------------------------------------------------------------------
# OCR result assembly
# ---------------------------------------------------------------------------

def _build_ocr_result(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Assemble a validated ``ocr_result`` dict, or None.

    *raw* is a dict that may contain amount, currency, merchant_name,
    receipt_date, ocr_confidence.  Fields are validated; invalid optional
    fields are dropped.  If ``amount`` is missing or invalid, the entire
    ``ocr_result`` is omitted (unreadable receipt for pricing).
    """
    if not isinstance(raw, dict) or not raw:
        return None

    amount = raw.get("amount")
    if not _is_valid_amount(amount):
        return None

    result: dict[str, Any] = {"amount": float(amount)}

    currency = raw.get("currency")
    if isinstance(currency, str) and currency.strip():
        result["currency"] = currency
    else:
        result["currency"] = "SGD"

    merchant_name = raw.get("merchant_name")
    if isinstance(merchant_name, str) and merchant_name.strip():
        result["merchant_name"] = merchant_name

    receipt_date = raw.get("receipt_date")
    normalised_date = _normalise_receipt_date(receipt_date)
    if normalised_date is not None:
        result["receipt_date"] = normalised_date

    confidence = raw.get("ocr_confidence")
    if _is_valid_confidence(confidence):
        result["ocr_confidence"] = float(confidence)

    return result


# ---------------------------------------------------------------------------
# OCR provider hook
# ---------------------------------------------------------------------------

_RECEIPT_SYSTEM_PROMPT = (
    "You are an OCR engine that reads cleaning and car-wash receipts. "
    "Return ONLY JSON with these keys: "
    '{"readable": bool, "amount": number (total paid), '
    '"currency": ISO 4217 currency code (default "SGD"), '
    '"merchant_name": string, '
    '"receipt_date": ISO 8601 date-time or null, '
    '"ocr_confidence": float between 0 and 1, '
    '"is_ai_generated": bool (true if the receipt image appears to be '
    'AI-generated or synthetically produced rather than a real photo), '
    '"ai_generated_confidence": float between 0 and 1 (confidence that the '
    'receipt is AI-generated; 0 if clearly a real photo)}. '
    "If the image is not a receipt or the total amount is not legible, "
    'return {"readable": false}. Never guess numbers.'
)


def _run_ocr(file_path: str | Path) -> dict[str, Any] | None:
    """Run DeepSeek vision OCR on *file_path* and return a raw result dict.

    Calls ``call_vision_json`` with the receipt system prompt.  If the
    vision API returns None or ``readable`` is false, returns None (no
    usable OCR data).  The ``readable`` key and any null-valued fields are
    dropped before returning.  The result goes through the same validation
    as annotations via ``_build_ocr_result``.

    When the vision response includes ``is_ai_generated`` /
    ``ai_generated_confidence``, those keys are passed through so that
    ``build_receipt_evidence`` can apply them as the VISION source.
    """
    raw = call_vision_json(
        _RECEIPT_SYSTEM_PROMPT,
        "Extract the receipt data from this image.",
        file_path,
    )
    if not isinstance(raw, dict):
        return None
    if raw.get("readable") is False:
        return None
    result: dict[str, Any] = {}
    for key in (
        "amount", "currency", "merchant_name", "receipt_date", "ocr_confidence",
    ):
        val = raw.get(key)
        if val is not None:
            result[key] = val
    # Pass through vision AI fields if present.
    is_ai = raw.get("is_ai_generated")
    if isinstance(is_ai, bool):
        result["is_ai_generated"] = is_ai
    ai_conf = raw.get("ai_generated_confidence")
    if _is_valid_confidence(ai_conf):
        result["ai_generated_confidence"] = float(ai_conf)
    return result or None


# ---------------------------------------------------------------------------
# Receipt AI / edit-software metadata detection (always on, no API)
# ---------------------------------------------------------------------------

def _detect_edit_software(software_str: str | None) -> str | None:
    """Return the matched editing-software name, or None.

    Scans the EXIF Software tag value for known editors (Photoshop,
    Lightroom, Canva, Snapseed, PicsArt, GIMP).  Returns the display
    name (title-cased) of the first match.
    """
    if not isinstance(software_str, str) or not software_str.strip():
        return None
    lowered = software_str.lower()
    for marker in _EDIT_SOFTWARE_MARKERS:
        if marker in lowered:
            # Return a readable display name.
            return marker.title()
    return None


def _detect_receipt_ai_metadata(
    img: Image.Image,
    raw_bytes: bytes,
) -> tuple[bool, str | None]:
    """Run the always-on metadata layer for AI generation and edit software.

    Returns ``(ai_detected, edit_software)``.

    - ``ai_detected``: True when a known AI-generator marker appears in
      the EXIF Software tag or raw bytes (same scan as photos).
    - ``edit_software``: the name of a known editing tool found in the
      EXIF Software tag, or None.
    """
    try:
        ai_detected = detect_ai_generator_markers(img, raw_bytes)
    except Exception:
        ai_detected = False

    try:
        software_str = extract_exif_software(img)
    except Exception:
        software_str = None

    edit_software = _detect_edit_software(software_str)

    return ai_detected, edit_software


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_receipt_evidence(
    file_path: str | Path,
    receipt_id: str,
    receipt_url: str,
    uploaded_at: str | None = None,
    annotation: dict[str, Any] | None = None,
    use_vision: bool = False,
) -> dict[str, Any]:
    """Build a ``ReceiptEvidenceInput`` dict from a receipt image file on disk.

    Never raises: on any read error returns ``{"receipt_id", "receipt_url"}``
    (plus ``uploaded_at`` if normalisable).

    Args:
        file_path: Path to the receipt image file (JPEG/PNG).
        receipt_id: Unique identifier (e.g. "RCP-001").
        receipt_url: URL or storage path for the receipt image.
        uploaded_at: ISO 8601 timestamp of upload.  Naive values are assumed
            +08:00.  Invalid values are silently omitted.
        annotation: OCR stand-in dict for this receipt_id.  Defaults to a
            lookup in ``receipt_annotations.json``.

    Returns:
        A dict conforming to ``ReceiptEvidenceInput`` in ``shared/schemas.json``.
    """
    base: dict[str, Any] = {"receipt_id": receipt_id, "receipt_url": receipt_url}

    # uploaded_at normalisation
    if uploaded_at is not None:
        normalised = _normalise_uploaded_at(uploaded_at)
        if normalised is not None:
            base["uploaded_at"] = normalised

    # 1. Check the file opens as an image with Pillow.
    try:
        raw_bytes = Path(file_path).read_bytes()
    except Exception:
        return base

    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.load()
    except Exception:
        return base

    # 2. AI / edit-software metadata layer (always on, no API).
    ai_metadata_detected, edit_software = _detect_receipt_ai_metadata(img, raw_bytes)

    # 3. OCR result: try _run_ocr first; fall back to annotation.
    #    _run_ocr also returns is_ai_generated / ai_generated_confidence
    #    from the vision layer when use_vision is true.
    ocr_raw: dict[str, Any] | None = None
    vision_ai: dict[str, Any] | None = None

    if use_vision:
        provider_result = _run_ocr(file_path)
        if provider_result is not None:
            ocr_raw = provider_result
            # Extract vision AI fields (if present) before _build_ocr_result
            # strips them (it only keeps OCR fields).
            vision_ai = {}
            if "is_ai_generated" in provider_result:
                vision_ai["is_ai_generated"] = provider_result["is_ai_generated"]
            if "ai_generated_confidence" in provider_result:
                vision_ai["ai_generated_confidence"] = provider_result["ai_generated_confidence"]

    if ocr_raw is None:
        if annotation is None:
            annotations = _load_default_annotations()
            annotation = annotations.get(receipt_id)
        ocr_raw = annotation

    ocr_result = _build_ocr_result(ocr_raw)
    if ocr_result is not None:
        base["ocr_result"] = ocr_result

    # 4. Determine final AI-generated result (metadata overrides vision).
    ai_detected = False
    ai_confidence: float | None = None
    ai_source: str | None = None

    if ai_metadata_detected:
        ai_detected = True
        ai_confidence = 0.9
        ai_source = "METADATA"
    elif (
        isinstance(vision_ai, dict)
        and vision_ai.get("is_ai_generated") is True
    ):
        ai_detected = True
        conf = vision_ai.get("ai_generated_confidence")
        if _is_valid_confidence(conf):
            ai_confidence = float(conf)
        else:
            ai_confidence = 0.5
        ai_source = "VISION"

    if ai_detected:
        base["receipt_ai_generated_detected"] = True
        if ai_confidence is not None:
            base["receipt_ai_generated_confidence"] = ai_confidence
        if ai_source is not None:
            base["receipt_ai_generated_source"] = ai_source

    if edit_software is not None:
        base["receipt_edit_software"] = edit_software

    return base


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build a ReceiptEvidenceInput dict from a receipt image file."
    )
    parser.add_argument("file", help="Path to the receipt image file")
    parser.add_argument("--receipt-id", required=True, help="Receipt identifier (e.g. RCP-001)")
    parser.add_argument("--receipt-url", default=None, help="Receipt URL or storage path")
    parser.add_argument("--uploaded-at", default=None, help="ISO 8601 upload timestamp")
    args = parser.parse_args()

    receipt_url = args.receipt_url if args.receipt_url else args.file
    result = build_receipt_evidence(
        args.file,
        args.receipt_id,
        receipt_url,
        uploaded_at=args.uploaded_at,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
