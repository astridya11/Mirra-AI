"""Standalone tests for receipt-reuse detection.

Tests:
  - Case A uploads receipt -> not flagged; Case B uploads same bytes ->
    IDENTICAL_FILE with case A's id.
  - Same case re-uploads -> not flagged.
  - Different bytes, same merchant/amount/date -> SAME_MERCHANT_AMOUNT_DATE.
  - Missing OCR fields -> no crash, no OCR key.
  - Corrupt registry file -> no crash, upload still succeeds.
  - Prosecutor check returns the exact statement.
  - Fraud: photo + receipt recycled -> 2 current signals.

Run:

    python -m pytest backend/tests/test_receipt_reuse.py -q --noconftest
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest
from PIL import Image, ImageDraw

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_DIR.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.shared.receipt_registry import (  # noqa: E402
    find_receipt_match,
    register_receipt,
    _build_ocr_key,
)
from backend.app.services.verification.checks_cleaning_fee import (  # noqa: E402
    check_cleaning_receipt_reuse,
)
from backend.app.services.verification.report import generate_prosecutor_report  # noqa: E402
from backend.app.services.verification.fraud import assess_fraud_risk  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_receipt_image_bytes(
    seed: int = 0,
    size: tuple[int, int] = (120, 200),
) -> bytes:
    """Create a distinctive JPEG image (receipt-like) and return its bytes."""
    img = Image.new("RGB", size, (240, 240, 240))
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for y in range(0, h, 4):
        gray = (seed * 7 + y * 3) % 256
        draw.line([(0, y), (w, y)], fill=(gray, gray, gray))
    draw.rectangle([10, 10, w - 10, h - 10], outline=(0, 0, 0), width=2)
    draw.text((15, 20), f"Receipt #{seed}", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_visually_distinct_image(seed: int = 0) -> bytes:
    """Create images that are visually very different (dHash Hamming >> 6)."""
    size = (120, 200)
    if seed % 3 == 0:
        # Solid dark image.
        img = Image.new("RGB", size, (20, 20, 20))
    elif seed % 3 == 1:
        # Horizontal stripes alternating black/white.
        img = Image.new("RGB", size, (255, 255, 255))
        draw = ImageDraw.Draw(img)
        for y in range(0, size[1], 4):
            color = (0, 0, 0) if (y // 4) % 2 == 0 else (255, 255, 255)
            draw.rectangle([0, y, size[0], y + 3], fill=color)
    else:
        # Left half black, right half white.
        img = Image.new("RGB", size, (255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, size[0] // 2, size[1]], fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _ocr_result(
    merchant: str = "Sparkle Car Care Pte Ltd",
    amount: float = 45.00,
    receipt_date: str = "2026-09-26T09:30:00+08:00",
) -> dict[str, Any]:
    r = {
        "amount": amount,
        "currency": "SGD",
        "merchant_name": merchant,
        "ocr_confidence": 0.93,
    }
    if receipt_date is not None:
        r["receipt_date"] = receipt_date
    return r


def _receipt(
    receipt_id: str = "RCP-001",
    ocr: dict[str, Any] | None = None,
    recycled: bool = False,
    match_case_id: str = "",
    match_reason: str = "",
) -> dict[str, Any]:
    r = {
        "receipt_id": receipt_id,
        "receipt_url": f"mock://evidence/test/{receipt_id}.jpg",
        "uploaded_at": "2026-09-26T10:15:00+08:00",
    }
    if ocr is not None:
        r["ocr_result"] = ocr
    if recycled:
        r["recycled_receipt_detected"] = True
        r["recycled_receipt_match_case_id"] = match_case_id
        r["recycled_receipt_match_reason"] = match_reason
    return r


def _data_with_receipts(receipts: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a data dict for prosecutor / check functions."""
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
# 1. Case A uploads receipt -> not flagged; Case B uploads same bytes
# ---------------------------------------------------------------------------

def test_case_a_not_flagged_case_b_identical_file():
    tmp = Path(tempfile.mkdtemp(prefix="receipt_reuse_1_"))
    reg_path = tmp / "registry.json"

    bytes_a = _make_receipt_image_bytes(seed=1)
    ocr = _ocr_result()

    # Case A uploads first — no match expected.
    match_a = find_receipt_match(bytes_a, ocr, "CASE-A", path=reg_path)
    assert match_a is None
    registered_a = register_receipt(bytes_a, ocr, "CASE-A", "RCP-001", path=reg_path)
    assert registered_a is True

    # Case B uploads the exact same bytes.
    match_b = find_receipt_match(bytes_a, ocr, "CASE-B", path=reg_path)
    assert match_b is not None
    assert match_b["case_id"] == "CASE-A"
    assert match_b["receipt_id"] == "RCP-001"
    assert match_b["reason"] == "IDENTICAL_FILE"


# ---------------------------------------------------------------------------
# 2. Same case re-uploads -> not flagged
# ---------------------------------------------------------------------------

def test_same_case_reupload_not_flagged():
    tmp = Path(tempfile.mkdtemp(prefix="receipt_reuse_2_"))
    reg_path = tmp / "registry.json"

    bytes_a = _make_receipt_image_bytes(seed=2)
    ocr = _ocr_result()

    # Register for case X.
    register_receipt(bytes_a, ocr, "CASE-X", "RCP-001", path=reg_path)

    # Same case re-uploads the same bytes.
    match = find_receipt_match(bytes_a, ocr, "CASE-X", path=reg_path)
    assert match is None


# ---------------------------------------------------------------------------
# 3. Different bytes, same merchant/amount/date -> SAME_MERCHANT_AMOUNT_DATE
# ---------------------------------------------------------------------------

def test_different_bytes_same_mad():
    tmp = Path(tempfile.mkdtemp(prefix="receipt_reuse_3_"))
    reg_path = tmp / "registry.json"

    bytes_a = _make_visually_distinct_image(seed=1)
    bytes_b = _make_visually_distinct_image(seed=2)
    ocr = _ocr_result(merchant="CleanPro Wash", amount=88.50,
                      receipt_date="2026-09-27T14:00:00+08:00")

    # Register case A's receipt.
    register_receipt(bytes_a, ocr, "CASE-MAD-A", "RCP-001", path=reg_path)

    # Case B uploads different bytes but same merchant/amount/date.
    match = find_receipt_match(bytes_b, ocr, "CASE-MAD-B", path=reg_path)
    assert match is not None
    assert match["case_id"] == "CASE-MAD-A"
    assert match["reason"] == "SAME_MERCHANT_AMOUNT_DATE"


# ---------------------------------------------------------------------------
# 4. Missing OCR fields -> no crash, no OCR key
# ---------------------------------------------------------------------------

def test_missing_ocr_fields_no_crash_no_key():
    # _build_ocr_key returns None when any part is missing.
    assert _build_ocr_key(None) is None
    assert _build_ocr_key({}) is None
    assert _build_ocr_key({"amount": 45.0}) is None  # missing merchant
    assert _build_ocr_key({"amount": 45.0, "merchant_name": "Clean"}) is None  # missing date
    assert _build_ocr_key({"merchant_name": "Clean"}) is None  # missing amount

    # Full valid key.
    key = _build_ocr_key({
        "amount": 45.0,
        "merchant_name": "  Sparkle   Car  ",
        "receipt_date": "2026-09-26T09:30:00+08:00",
    })
    assert key == "sparkle car|45.00|2026-09-26"

    # find_receipt_match with missing OCR still works for IDENTICAL_FILE.
    tmp = Path(tempfile.mkdtemp(prefix="receipt_reuse_4_"))
    reg_path = tmp / "registry.json"
    bytes_a = _make_receipt_image_bytes(seed=4)
    register_receipt(bytes_a, None, "CASE-O", "RCP-001", path=reg_path)
    match = find_receipt_match(bytes_a, None, "CASE-P", path=reg_path)
    assert match is not None
    assert match["reason"] == "IDENTICAL_FILE"


# ---------------------------------------------------------------------------
# 5. Corrupt registry file -> no crash, upload still succeeds
# ---------------------------------------------------------------------------

def test_corrupt_registry_file_no_crash():
    tmp = Path(tempfile.mkdtemp(prefix="receipt_reuse_5_"))
    reg_path = tmp / "registry.json"
    # Write corrupt JSON.
    reg_path.parent.mkdir(parents=True, exist_ok=True)
    reg_path.write_text("THIS IS NOT JSON {{{{", encoding="utf-8")

    bytes_a = _make_receipt_image_bytes(seed=5)
    ocr = _ocr_result()

    # find_receipt_match should not crash.
    match = find_receipt_match(bytes_a, ocr, "CASE-CORRUPT-B", path=reg_path)
    assert match is None

    # register_receipt should still succeed (writes fresh file).
    ok = register_receipt(bytes_a, ocr, "CASE-CORRUPT-A", "RCP-001", path=reg_path)
    assert ok is True


# ---------------------------------------------------------------------------
# 6. Prosecutor check returns the exact statement
# ---------------------------------------------------------------------------

def test_prosecutor_check_exact_statement():
    receipts = [
        _receipt(
            receipt_id="RCP-001",
            recycled=True,
            match_case_id="DISP-OLD-001",
            match_reason="IDENTICAL_FILE",
        ),
    ]
    data = _data_with_receipts(receipts)
    result = check_cleaning_receipt_reuse(data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["party_relevance"] == "DRIVER"
    assert result["description"] == (
        "Recycled receipt: RCP-001 matches a receipt already submitted in case DISP-OLD-001."
    )


def test_prosecutor_check_no_recycled_returns_missing():
    receipts = [
        _receipt(receipt_id="RCP-001", ocr=_ocr_result(), recycled=False),
    ]
    data = _data_with_receipts(receipts)
    result = check_cleaning_receipt_reuse(data)
    assert result["status"] == "MISSING"
    assert "No recycled receipt" in result["description"]


def test_prosecutor_check_via_report():
    """The full report pipeline includes the recycled-receipt check."""
    receipts = [
        _receipt(
            receipt_id="RCP-001",
            ocr=_ocr_result(),
            recycled=True,
            match_case_id="DISP-OLD-002",
            match_reason="IDENTICAL_FILE",
        ),
    ]
    data = _data_with_receipts(receipts)
    report = generate_prosecutor_report(data)
    all_text = " ".join(
        f["description"] for f in report["verified_facts"]
    )
    assert "Recycled receipt: RCP-001 matches a receipt already submitted in case DISP-OLD-002." in all_text


# ---------------------------------------------------------------------------
# 7. Fraud: photo + receipt recycled -> 2 current signals
# ---------------------------------------------------------------------------

def test_fraud_photo_plus_receipt_two_signals():
    """A recycled image and a recycled receipt count as 2 independent signals."""
    img = {
        "image_id": "IMG-001",
        "image_url": "mock://evidence/test/IMG-001.jpg",
        "exif_timestamp": "2026-09-25T22:15:00+08:00",
        "exif_gps_location": {"latitude": 1.3508, "longitude": 103.8485},
        "is_ai_generated": False,
        "ai_generated_confidence": 0.05,
        "stain_damage_classification": "LIQUID_SPILL",
        "damage_severity": "MODERATE",
        "exif_consistent_with_trip": True,
        "recycled_image_detected": True,
        "recycled_image_match_case_id": "DISP-OLD-IMG",
    }
    rcp = _receipt(
        receipt_id="RCP-001",
        recycled=True,
        match_case_id="DISP-OLD-RCP",
        match_reason="IDENTICAL_FILE",
    )
    context = {
        "data_sources": {
            "receipt_evidence": [rcp],
            "historical_profiles": [],
        },
    }
    result = assess_fraud_risk(context, [img])

    # Must have at least 2 risk factors mentioning reuse.
    reuse_factors = [f for f in result["risk_factors"] if "reuse" in f.lower()]
    assert len(reuse_factors) >= 2

    # Score must be higher than either alone.
    img_only = assess_fraud_risk({"data_sources": {}}, [img])
    rcp_only = assess_fraud_risk(context, [])
    assert result["fraud_risk_score"] > img_only["fraud_risk_score"]
    assert result["fraud_risk_score"] > rcp_only["fraud_risk_score"]


def test_fraud_receipt_alone_is_one_signal():
    """A recycled receipt alone is 1 signal and contributes risk."""
    rcp = _receipt(
        receipt_id="RCP-001",
        recycled=True,
        match_case_id="DISP-OLD-RCP",
        match_reason="IDENTICAL_FILE",
    )
    context = {
        "data_sources": {
            "receipt_evidence": [rcp],
            "historical_profiles": [],
        },
    }
    result = assess_fraud_risk(context, [])
    assert result["fraud_risk_score"] > 0.0
    assert any("receipt reuse" in f.lower() for f in result["risk_factors"])


def test_fraud_abuse_pattern_receipt():
    """Recycled receipt sets abuse_pattern_detected."""
    rcp = _receipt(
        receipt_id="RCP-001",
        recycled=True,
        match_case_id="DISP-OLD-RCP",
        match_reason="IDENTICAL_FILE",
    )
    context = {
        "data_sources": {
            "receipt_evidence": [rcp],
            "historical_profiles": [],
        },
    }
    result = assess_fraud_risk(context, [])
    assert result["abuse_pattern_detected"] is True
    assert "receipt reuse" in result.get("abuse_pattern_description", "").lower()
