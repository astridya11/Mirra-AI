"""Standalone tests for receipt AI-generation and edit-software detection.

Tests:
  - Marker in bytes → METADATA 0.9.
  - Vision says AI 0.8 → VISION 0.8.
  - Photoshop Software tag → edit fact, not a fraud signal.
  - Clean receipt → nothing.
  - Fraud: recycled receipt + AI receipt → 2 signals.
  - Existing tests still pass.

Monkeypatches ``call_vision_json`` so no network calls are made.

Run:

    python -m pytest backend/tests/test_receipt_ai_check.py -q --noconftest
"""

from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_DIR.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import backend.shared.receipt_evidence as receipt_mod  # noqa: E402
from backend.shared.receipt_evidence import build_receipt_evidence  # noqa: E402
from backend.app.services.verification.checks_cleaning_fee import (  # noqa: E402
    check_cleaning_receipt_authenticity,
)
from backend.app.services.verification.fraud import assess_fraud_risk  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_jpeg(path: Path) -> Path:
    """Create a plain JPEG with no EXIF Software tag."""
    img = Image.new("RGB", (80, 80), (200, 200, 200))
    img.save(path, format="JPEG")
    return path


def _make_jpeg_with_software(path: Path, software: str) -> Path:
    """Create a JPEG with the given EXIF Software tag."""
    img = Image.new("RGB", (80, 80), (200, 200, 200))
    exif = Image.Exif()
    exif[0x0131] = software  # Software tag
    img.save(path, format="JPEG", exif=exif)
    return path


def _make_jpeg_with_ai_marker(path: Path, marker: str = "midjourney") -> Path:
    """Create a JPEG whose raw bytes contain a known AI-generator marker.

    We append the marker string after the JPEG end-of-image marker so
    Pillow can still open it but the marker is present in the raw bytes.
    """
    img = Image.new("RGB", (80, 80), (200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    data = buf.getvalue()
    # Append the marker in the raw bytes (after EOI).
    data = data + marker.encode("ascii")
    path.write_bytes(data)
    return path


def _make_fake_vision(return_value: dict | None):
    """Return a fake call_vision_json that returns *return_value*."""
    def _fake(system_prompt, user_text, image_path, **kwargs):
        return return_value
    return _fake


def _receipt(
    receipt_id: str = "RCP-001",
    ai_detected: bool = False,
    ai_confidence: float | None = None,
    ai_source: str | None = None,
    edit_software: str | None = None,
    recycled: bool = False,
) -> dict[str, Any]:
    r = {
        "receipt_id": receipt_id,
        "receipt_url": f"mock://evidence/test/{receipt_id}.jpg",
        "uploaded_at": "2026-09-26T10:15:00+08:00",
    }
    if ai_detected:
        r["receipt_ai_generated_detected"] = True
        if ai_confidence is not None:
            r["receipt_ai_generated_confidence"] = ai_confidence
        if ai_source is not None:
            r["receipt_ai_generated_source"] = ai_source
    if edit_software is not None:
        r["receipt_edit_software"] = edit_software
    if recycled:
        r["recycled_receipt_detected"] = True
        r["recycled_receipt_match_case_id"] = "DISP-OLD-001"
        r["recycled_receipt_match_reason"] = "IDENTICAL_FILE"
    return r


def _data_with_receipts(receipts: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "case_metadata": {
            "case_id": "TEST-001",
            "dispute_type": "CLEANING_FEE",
            "created_at": "2026-09-26T10:00:00+08:00",
        },
        "data_sources": {
            "receipt_evidence": receipts,
        },
    }


# ---------------------------------------------------------------------------
# 1. Marker in bytes → METADATA 0.9
# ---------------------------------------------------------------------------

def test_marker_in_bytes_metadata_09():
    tmp = tempfile.mkdtemp(prefix="receipt_ai_1_")
    path = _make_jpeg_with_ai_marker(Path(tmp) / "ai_marker.jpg", "midjourney")

    result = build_receipt_evidence(str(path), "RCP-001", "mock://ai.jpg")
    assert result.get("receipt_ai_generated_detected") is True
    assert result.get("receipt_ai_generated_source") == "METADATA"
    assert result.get("receipt_ai_generated_confidence") == 0.9


def test_marker_in_exif_software_metadata_09():
    """An AI generator name in the EXIF Software tag should also trigger METADATA."""
    tmp = tempfile.mkdtemp(prefix="receipt_ai_1b_")
    path = _make_jpeg_with_software(Path(tmp) / "ai_exif.jpg", "DALL-E 3")

    result = build_receipt_evidence(str(path), "RCP-001", "mock://ai.jpg")
    assert result.get("receipt_ai_generated_detected") is True
    assert result.get("receipt_ai_generated_source") == "METADATA"
    assert result.get("receipt_ai_generated_confidence") == 0.9


# ---------------------------------------------------------------------------
# 2. Vision says AI 0.8 → VISION 0.8
# ---------------------------------------------------------------------------

def test_vision_ai_08():
    tmp = tempfile.mkdtemp(prefix="receipt_ai_2_")
    path = _make_jpeg(Path(tmp) / "clean.jpg")

    fake_vision = _make_fake_vision({
        "readable": True,
        "amount": 45.0,
        "currency": "SGD",
        "merchant_name": "Sparkle Car Care",
        "receipt_date": "2026-09-26T09:30:00+08:00",
        "ocr_confidence": 0.93,
        "is_ai_generated": True,
        "ai_generated_confidence": 0.8,
    })

    original = receipt_mod.call_vision_json
    receipt_mod.call_vision_json = fake_vision
    try:
        result = build_receipt_evidence(
            str(path), "RCP-001", "mock://vision.jpg",
            use_vision=True,
        )
    finally:
        receipt_mod.call_vision_json = original

    assert result.get("receipt_ai_generated_detected") is True
    assert result.get("receipt_ai_generated_source") == "VISION"
    assert result.get("receipt_ai_generated_confidence") == 0.8


def test_metadata_overrides_vision():
    """When both metadata and vision detect AI, metadata wins (0.9, METADATA)."""
    tmp = tempfile.mkdtemp(prefix="receipt_ai_2b_")
    path = _make_jpeg_with_ai_marker(Path(tmp) / "both.jpg", "stable diffusion")

    fake_vision = _make_fake_vision({
        "readable": True,
        "amount": 45.0,
        "currency": "SGD",
        "merchant_name": "Sparkle",
        "is_ai_generated": True,
        "ai_generated_confidence": 0.3,
    })

    original = receipt_mod.call_vision_json
    receipt_mod.call_vision_json = fake_vision
    try:
        result = build_receipt_evidence(
            str(path), "RCP-001", "mock://both.jpg",
            use_vision=True,
        )
    finally:
        receipt_mod.call_vision_json = original

    assert result.get("receipt_ai_generated_detected") is True
    assert result.get("receipt_ai_generated_source") == "METADATA"
    assert result.get("receipt_ai_generated_confidence") == 0.9


# ---------------------------------------------------------------------------
# 3. Photoshop Software tag → edit fact, not a fraud signal
# ---------------------------------------------------------------------------

def test_photoshop_edit_software_fact():
    tmp = tempfile.mkdtemp(prefix="receipt_ai_3_")
    path = _make_jpeg_with_software(Path(tmp) / "photoshop.jpg", "Adobe Photoshop CC 2024")

    result = build_receipt_evidence(str(path), "RCP-001", "mock://ps.jpg")
    assert result.get("receipt_edit_software") == "Photoshop"
    # No AI detection from just "Photoshop" in the Software tag.
    assert result.get("receipt_ai_generated_detected") is not True


def test_edit_software_not_fraud_signal():
    """Edit software is a fact, NOT a fraud signal."""
    receipt = _receipt(receipt_id="RCP-001", edit_software="Photoshop")
    context = _data_with_receipts([receipt])
    fraud_result = assess_fraud_risk(context, [])
    # Score should be 0 — edit software is not a signal.
    assert fraud_result["fraud_risk_score"] == 0.0
    assert not any("edit" in f.lower() for f in fraud_result["risk_factors"])


def test_edit_software_prosecutor_check():
    """The prosecutor check states the edit-software fact."""
    receipt = _receipt(receipt_id="RCP-001", edit_software="Photoshop")
    data = _data_with_receipts([receipt])
    result = check_cleaning_receipt_authenticity(data)
    assert result["status"] == "DISPUTED"
    assert result["details"]["party_relevance"] == "DRIVER"
    assert (
        "Receipt RCP-001 metadata shows it was edited with Photoshop."
        in result["description"]
    )


# ---------------------------------------------------------------------------
# 4. Clean receipt → nothing
# ---------------------------------------------------------------------------

def test_clean_receipt_nothing():
    tmp = tempfile.mkdtemp(prefix="receipt_ai_4_")
    path = _make_jpeg(Path(tmp) / "clean.jpg")
    result = build_receipt_evidence(str(path), "RCP-001", "mock://clean.jpg")
    assert "receipt_ai_generated_detected" not in result
    assert "receipt_edit_software" not in result


def test_clean_receipt_prosecutor_check_missing():
    """A receipt with no AI/edit findings returns MISSING from the check."""
    receipt = _receipt(receipt_id="RCP-001")
    data = _data_with_receipts([receipt])
    result = check_cleaning_receipt_authenticity(data)
    assert result["status"] == "MISSING"
    assert "No AI-generated" in result["description"]


# ---------------------------------------------------------------------------
# 5. Fraud: recycled receipt + AI receipt → 2 signals
# ---------------------------------------------------------------------------

def test_fraud_recycled_plus_ai_two_signals():
    """A recycled receipt and an AI-generated receipt count as 2 signals."""
    rcp_recycled = _receipt(
        receipt_id="RCP-001",
        recycled=True,
    )
    rcp_ai = _receipt(
        receipt_id="RCP-002",
        ai_detected=True,
        ai_confidence=0.8,
        ai_source="METADATA",
    )
    context = _data_with_receipts([rcp_recycled, rcp_ai])
    result = assess_fraud_risk(context, [])

    reuse_factors = [f for f in result["risk_factors"] if "reuse" in f.lower()]
    ai_factors = [f for f in result["risk_factors"] if "ai-generated" in f.lower()]
    assert len(reuse_factors) >= 1
    assert len(ai_factors) >= 1
    assert len(reuse_factors) + len(ai_factors) >= 2

    # Score should be higher than either alone.
    recycled_only = assess_fraud_risk(
        _data_with_receipts([rcp_recycled]), []
    )
    ai_only = assess_fraud_risk(
        _data_with_receipts([rcp_ai]), []
    )
    assert result["fraud_risk_score"] > recycled_only["fraud_risk_score"]
    assert result["fraud_risk_score"] > ai_only["fraud_risk_score"]


def test_fraud_ai_receipt_alone_is_one_signal():
    """An AI-generated receipt alone is 1 signal."""
    rcp = _receipt(
        receipt_id="RCP-001",
        ai_detected=True,
        ai_confidence=0.8,
        ai_source="METADATA",
    )
    context = _data_with_receipts([rcp])
    result = assess_fraud_risk(context, [])
    assert result["fraud_risk_score"] > 0.0
    assert any("ai-generated receipt" in f.lower() for f in result["risk_factors"])


# ---------------------------------------------------------------------------
# 6. Prosecutor check: AI receipt → DISPUTED with exact statement
# ---------------------------------------------------------------------------

def test_prosecutor_ai_receipt_exact_statement():
    receipt = _receipt(
        receipt_id="RCP-001",
        ai_detected=True,
        ai_confidence=0.9,
        ai_source="METADATA",
    )
    data = _data_with_receipts([receipt])
    result = check_cleaning_receipt_authenticity(data)
    assert result["status"] == "DISPUTED"
    assert result["details"]["party_relevance"] == "DRIVER"
    assert (
        "Receipt RCP-001 shows signs of being AI-generated (METADATA, confidence 0.90)."
        in result["description"]
    )


def test_prosecutor_both_ai_and_edit():
    """Both AI and edit findings in the same receipt → both sentences."""
    receipt = _receipt(
        receipt_id="RCP-001",
        ai_detected=True,
        ai_confidence=0.8,
        ai_source="VISION",
        edit_software="Lightroom",
    )
    data = _data_with_receipts([receipt])
    result = check_cleaning_receipt_authenticity(data)
    assert result["status"] == "DISPUTED"
    assert "AI-generated" in result["description"]
    assert "Lightroom" in result["description"]


# ---------------------------------------------------------------------------
# 7. Never raises on bad input
# ---------------------------------------------------------------------------

def test_check_never_raises_on_bad_input():
    """The check must not raise on malformed data."""
    assert check_cleaning_receipt_authenticity({})["status"] == "MISSING"
    assert check_cleaning_receipt_authenticity({"data_sources": {}})["status"] == "MISSING"
    assert check_cleaning_receipt_authenticity(
        {"data_sources": {"receipt_evidence": None}}
    )["status"] == "MISSING"
    assert check_cleaning_receipt_authenticity(
        {"data_sources": {"receipt_evidence": "not a list"}}
    )["status"] == "MISSING"
    assert check_cleaning_receipt_authenticity(
        {"data_sources": {"receipt_evidence": []}}
    )["status"] == "MISSING"
