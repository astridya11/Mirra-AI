"""Standalone tests for timing-fact checks.

No network.  Temp dir only.  Plain script style.

Run:
    python -m pytest backend/tests/test_timing_facts.py -q --noconftest
"""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

# --- Path setup -------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from backend.shared.claim_evidence import merge_claim_evidence  # noqa: E402
from backend.shared.time_rules import trip_end_time, parse_ts  # noqa: E402
from app.services.verification.checks_cleaning_fee import (  # noqa: E402
    check_cleaning_claim_submission_delay,
    check_cleaning_receipt_timing,
    check_cleaning_photo_timing,
)

_MOCK_DATA_DIR = _REPO_ROOT / "backend" / "mock_data"


def _load_disp004() -> dict[str, Any]:
    with open(_MOCK_DATA_DIR / "DISP-004.json", "r", encoding="utf-8") as f:
        return json.load(f)


def _merged(data: dict[str, Any]) -> dict[str, Any]:
    """Return data with dispute_claim evidence merged into data_sources."""
    ds = merge_claim_evidence(data.get("data_sources"), data.get("dispute_claim"))
    merged = dict(data)
    merged["data_sources"] = ds
    return merged


def main() -> None:
    errors: list[str] = []

    # ===================================================================
    # CHECK a: receipt fact contains "11 h 25 min after trip end"
    # ===================================================================
    print("=" * 70)
    print('CHECK a: receipt fact contains "11 h 25 min after trip end"')
    print("=" * 70)
    check_a_errors: list[str] = []

    raw = _load_disp004()
    data = _merged(raw)
    result = check_cleaning_receipt_timing(data)

    if result["status"] != "VERIFIED":
        check_a_errors.append(f"status: got {result['status']!r}, expected VERIFIED")
    desc = result.get("description", "")
    if "11 h 25 min after trip end" not in desc:
        check_a_errors.append(f"description missing '11 h 25 min after trip end': {desc!r}")
    # Should mention the receipt ID and amount
    if "RCP-001" not in desc:
        check_a_errors.append(f"description missing 'RCP-001': {desc!r}")
    if "SGD 60.00" not in desc and "60.00" not in desc:
        check_a_errors.append(f"description missing amount: {desc!r}")

    if check_a_errors:
        print("\nCHECK a RESULT: FAIL")
        for e in check_a_errors:
            print(f"  - {e}")
        errors.extend(check_a_errors)
    else:
        print("\nCHECK a RESULT: PASS")
        print(f"  - status: {result['status']}")
        print(f"  - description: {desc}")

    # ===================================================================
    # CHECK b: DISP-004 is a BEFORE-trip photo -> DISPUTED
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK b: DISP-004 is a BEFORE-trip photo -> DISPUTED")
    print("=" * 70)
    check_b_errors: list[str] = []

    raw = _load_disp004()
    # DISP-004's image exif_timestamp is 2026-08-30T15:12:00+08:00,
    # 26 days BEFORE trip end 2026-09-25T22:05:00+08:00.
    # GPS 1.3496,103.9568 (~12 km from drop-off Bishan 1.3508,103.8485).
    data = _merged(raw)
    result = check_cleaning_photo_timing(data)

    if result["status"] != "DISPUTED":
        check_b_errors.append(f"status: got {result['status']!r}, expected DISPUTED")
    desc = result.get("description", "")
    if "before trip end" not in desc:
        check_b_errors.append(f"description missing 'before trip end': {desc!r}")
    if "km from the drop-off point" not in desc:
        check_b_errors.append(f"description missing 'km from the drop-off point': {desc!r}")
    if "IMG-001" not in desc:
        check_b_errors.append(f"description missing 'IMG-001': {desc!r}")

    if check_b_errors:
        print("\nCHECK b RESULT: FAIL")
        for e in check_b_errors:
            print(f"  - {e}")
        errors.extend(check_b_errors)
    else:
        print("\nCHECK b RESULT: PASS")
        print(f"  - status: {result['status']}")
        print(f"  - description: {desc}")

    # ===================================================================
    # CHECK c: claim delay description has no raw seconds
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK c: claim delay description has no raw seconds")
    print("=" * 70)
    check_c_errors: list[str] = []

    raw = _load_disp004()
    data = _merged(raw)
    result = check_cleaning_claim_submission_delay(data)

    if result["status"] != "VERIFIED":
        check_c_errors.append(f"status: got {result['status']!r}, expected VERIFIED")
    desc = result.get("description", "")
    if "seconds" in desc.lower():
        check_c_errors.append(f"description contains 'seconds': {desc!r}")
    # Should contain "after trip end"
    if "after trip end" not in desc:
        check_c_errors.append(f"description missing 'after trip end': {desc!r}")
    # Details should still have delta_seconds and delta_minutes
    details = result.get("details", {})
    if "delta_seconds" not in details:
        check_c_errors.append(f"details missing 'delta_seconds': {details!r}")
    if "delta_minutes" not in details:
        check_c_errors.append(f"details missing 'delta_minutes': {details!r}")

    if check_c_errors:
        print("\nCHECK c RESULT: FAIL")
        for e in check_c_errors:
            print(f"  - {e}")
        errors.extend(check_c_errors)
    else:
        print("\nCHECK c RESULT: PASS")
        print(f"  - status: {result['status']}")
        print(f"  - description: {desc}")
        print(f"  - delta_seconds: {details['delta_seconds']}")
        print(f"  - delta_minutes: {details['delta_minutes']}")

    # ===================================================================
    # CHECK d: missing data -> MISSING
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK d: missing data -> MISSING")
    print("=" * 70)
    check_d_errors: list[str] = []

    # No trip_end_time, no app_events
    empty_data: dict[str, Any] = {"data_sources": {"trip_data": {}}}
    result_receipt = check_cleaning_receipt_timing(empty_data)
    if result_receipt["status"] != "MISSING":
        check_d_errors.append(f"receipt timing (no trip end): status {result_receipt['status']!r}, expected MISSING")

    result_photo = check_cleaning_photo_timing(empty_data)
    if result_photo["status"] != "MISSING":
        check_d_errors.append(f"photo timing (no trip end): status {result_photo['status']!r}, expected MISSING")

    # Trip end present but no receipts
    data_no_receipts: dict[str, Any] = {
        "data_sources": {
            "trip_data": {"trip_end_time": "2026-09-25T22:05:00+08:00"},
            "receipt_evidence": [],
        }
    }
    result = check_cleaning_receipt_timing(data_no_receipts)
    if result["status"] != "MISSING":
        check_d_errors.append(f"receipt timing (no receipts): status {result['status']!r}, expected MISSING")

    # Trip end present but no images
    data_no_images: dict[str, Any] = {
        "data_sources": {
            "trip_data": {"trip_end_time": "2026-09-25T22:05:00+08:00"},
        }
    }
    result = check_cleaning_photo_timing(data_no_images)
    if result["status"] != "MISSING":
        check_d_errors.append(f"photo timing (no images): status {result['status']!r}, expected MISSING")

    if check_d_errors:
        print("\nCHECK d RESULT: FAIL")
        for e in check_d_errors:
            print(f"  - {e}")
        errors.extend(check_d_errors)
    else:
        print("\nCHECK d RESULT: PASS")
        print(f"  - receipt timing (no trip end): {result_receipt['status']}")
        print(f"  - photo timing (no trip end): {result_photo['status']}")
        print(f"  - receipt timing (no receipts): MISSING")
        print(f"  - photo timing (no images): MISSING")

    # ===================================================================
    # CHECK e: receipt before trip end -> DISPUTED
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK e: receipt before trip end -> DISPUTED")
    print("=" * 70)
    check_e_errors: list[str] = []

    raw = _load_disp004()
    # Set receipt_date before trip end
    raw["dispute_claim"]["receipt_evidence"][0]["ocr_result"]["receipt_date"] = "2026-09-25T20:00:00+08:00"
    data = _merged(raw)
    result = check_cleaning_receipt_timing(data)

    if result["status"] != "DISPUTED":
        check_e_errors.append(f"status: got {result['status']!r}, expected DISPUTED")
    desc = result.get("description", "")
    if "before trip end" not in desc:
        check_e_errors.append(f"description missing 'before trip end': {desc!r}")

    if check_e_errors:
        print("\nCHECK e RESULT: FAIL")
        for e in check_e_errors:
            print(f"  - {e}")
        errors.extend(check_e_errors)
    else:
        print("\nCHECK e RESULT: PASS")
        print(f"  - status: {result['status']}")
        print(f"  - description: {desc}")

    # ===================================================================
    # CHECK f: synthetic case with a photo 10 min after trip end at drop-off
    #          -> VERIFIED "10 min after trip end, 0 m"
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK f: photo 10 min after trip end at drop-off -> VERIFIED")
    print("=" * 70)
    check_f_errors: list[str] = []

    raw = _load_disp004()
    trip_end_str = raw["data_sources"]["trip_data"]["trip_end_time"]
    trip_end_dt = parse_ts(trip_end_str)
    photo_dt = trip_end_dt + timedelta(minutes=10)
    raw["dispute_claim"]["image_evidence"][0]["exif_timestamp"] = photo_dt.isoformat()
    dropoff = raw["data_sources"]["trip_data"]["dropoff_location"]
    raw["dispute_claim"]["image_evidence"][0]["exif_gps_location"] = {
        "latitude": dropoff["lat"],
        "longitude": dropoff["lng"],
    }

    data = _merged(raw)
    result = check_cleaning_photo_timing(data)

    if result["status"] != "VERIFIED":
        check_f_errors.append(f"status: got {result['status']!r}, expected VERIFIED")
    desc = result.get("description", "")
    if "10 min after trip end" not in desc:
        check_f_errors.append(f"description missing '10 min after trip end': {desc!r}")
    if "0 m from the drop-off point" not in desc:
        check_f_errors.append(f"description missing '0 m from the drop-off point': {desc!r}")

    if check_f_errors:
        print("\nCHECK f RESULT: FAIL")
        for e in check_f_errors:
            print(f"  - {e}")
        errors.extend(check_f_errors)
    else:
        print("\nCHECK f RESULT: PASS")
        print(f"  - status: {result['status']}")
        print(f"  - description: {desc}")

    # ===================================================================
    # CHECK g: no description anywhere contains "before before" or "before after"
    # ===================================================================
    print("\n" + "=" * 70)
    print('CHECK g: no description contains "before before" or "before after"')
    print("=" * 70)
    check_g_errors: list[str] = []

    # Run all the checks we have on DISP-004 (original and modified) and
    # verify no double-word phrasing appears.
    all_descs: list[str] = []

    # Original DISP-004 (before-trip photo)
    raw = _load_disp004()
    data = _merged(raw)
    all_descs.append(check_cleaning_receipt_timing(data).get("description", ""))
    all_descs.append(check_cleaning_photo_timing(data).get("description", ""))
    all_descs.append(check_cleaning_claim_submission_delay(data).get("description", ""))

    # Modified: receipt before trip end
    raw = _load_disp004()
    raw["dispute_claim"]["receipt_evidence"][0]["ocr_result"]["receipt_date"] = "2026-09-25T20:00:00+08:00"
    data = _merged(raw)
    all_descs.append(check_cleaning_receipt_timing(data).get("description", ""))

    # Modified: photo 10 min after trip end at drop-off
    raw = _load_disp004()
    trip_end_str = raw["data_sources"]["trip_data"]["trip_end_time"]
    trip_end_dt = parse_ts(trip_end_str)
    photo_dt = trip_end_dt + timedelta(minutes=10)
    raw["dispute_claim"]["image_evidence"][0]["exif_timestamp"] = photo_dt.isoformat()
    dropoff = raw["data_sources"]["trip_data"]["dropoff_location"]
    raw["dispute_claim"]["image_evidence"][0]["exif_gps_location"] = {
        "latitude": dropoff["lat"],
        "longitude": dropoff["lng"],
    }
    data = _merged(raw)
    all_descs.append(check_cleaning_photo_timing(data).get("description", ""))

    for i, desc in enumerate(all_descs):
        if "before before" in desc.lower():
            check_g_errors.append(f"desc[{i}] contains 'before before': {desc!r}")
        if "before after" in desc.lower():
            check_g_errors.append(f"desc[{i}] contains 'before after': {desc!r}")

    if check_g_errors:
        print("\nCHECK g RESULT: FAIL")
        for e in check_g_errors:
            print(f"  - {e}")
        errors.extend(check_g_errors)
    else:
        print("\nCHECK g RESULT: PASS")
        print("  - no 'before before' or 'before after' in any description")

    # ===================================================================
    # Summary
    # ===================================================================
    if errors:
        print("\n" + "=" * 70)
        print("SOME CHECKS FAILED")
        print("=" * 70)
        sys.exit(1)
    else:
        print("\n" + "=" * 70)
        print("ALL TESTS PASSED")
        print("=" * 70)


if __name__ == "__main__":
    main()
