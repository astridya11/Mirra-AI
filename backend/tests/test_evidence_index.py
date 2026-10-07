"""
Test for the shared evidence-index builder.

Runs with plain Python (no LLM calls, no API key needed):
    python -m backend.tests.test_evidence_index
"""

import copy
import json
import sys
from pathlib import Path

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend.shared...` imports work

from backend.shared.evidence_index import build_evidence_index, format_evidence_for_prompt  # noqa: E402
from backend.shared.claim_evidence import merge_claim_evidence  # noqa: E402


# --- Helpers -------------------------------------------------------------------

_MOCK_DIR = _BACKEND_DIR / "mock_data"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# --- Test 1: DISP-002 assertions ----------------------------------------------


def _test_disp002() -> None:
    raw = _load_json(_MOCK_DIR / "DISP-002.json")
    data_sources = raw["data_sources"]
    snapshot = copy.deepcopy(data_sources)

    index = build_evidence_index(data_sources)

    errors: list[str] = []

    # EVT-003 exists and description contains "driver_arrived".
    evt003 = index.get("EVT-003")
    if evt003 is None:
        errors.append("Expected 'EVT-003' in index, not found")
    elif "driver_arrived" not in evt003["description"]:
        errors.append(f"Expected 'driver_arrived' in EVT-003 description, got: {evt003['description']}")

    # GPS-004 exists and description contains "08:43".
    gps004 = index.get("GPS-004")
    if gps004 is None:
        errors.append("Expected 'GPS-004' in index, not found")
    elif "08:43" not in gps004["description"]:
        errors.append(f"Expected '08:43' in GPS-004 description, got: {gps004['description']}")

    # CHAT-001 to CHAT-006 exist.
    for i in range(1, 7):
        cid = f"CHAT-{i:03d}"
        if cid not in index:
            errors.append(f"Expected '{cid}' in index, not found")

    # TRIP-DATA, PAYMENT-DATA, PROFILE-RIDER, PROFILE-DRIVER exist.
    for required in ("TRIP-DATA", "PAYMENT-DATA", "PROFILE-RIDER", "PROFILE-DRIVER"):
        if required not in index:
            errors.append(f"Expected '{required}' in index, not found")

    # Input must be unchanged.
    if data_sources != snapshot:
        errors.append("data_sources was modified by build_evidence_index (should be read-only)")

    if errors:
        print("\nTEST 1 (DISP-002) RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 1 (DISP-002) RESULT: PASS")
        print(f"  - {len(index)} evidence items indexed")
        print("  - EVT-003 contains 'driver_arrived'")
        print("  - GPS-004 contains '08:43'")
        print("  - CHAT-001 to CHAT-006 present")
        print("  - TRIP-DATA, PAYMENT-DATA, PROFILE-RIDER, PROFILE-DRIVER present")
        print("  - data_sources unchanged")

    # Print the formatted index.
    print("\n" + "=" * 60)
    print("EVIDENCE INDEX for DISP-002")
    print("=" * 60)
    print(format_evidence_for_prompt(index))
    print("=" * 60)


# --- Test 2: DISP-001 ROUTE-SUMMARY ------------------------------------------


def _test_disp001_route_summary() -> None:
    raw = _load_json(_MOCK_DIR / "DISP-001.json")
    index = build_evidence_index(raw["data_sources"])

    errors: list[str] = []

    rs = index.get("ROUTE-SUMMARY")
    if rs is None:
        errors.append("Expected 'ROUTE-SUMMARY' in DISP-001 index, not found")
    else:
        desc = rs["description"]
        if "2.3" not in desc:
            errors.append(f"Expected '2.3' in ROUTE-SUMMARY description, got: {desc}")
        if "35" not in desc:
            errors.append(f"Expected '35' in ROUTE-SUMMARY description, got: {desc}")
        if "28" not in desc:
            errors.append(f"Expected '28' in ROUTE-SUMMARY description, got: {desc}")

    if errors:
        print("\nTEST 2 (DISP-001 ROUTE-SUMMARY) RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 2 (DISP-001 ROUTE-SUMMARY) RESULT: PASS")
        print("  - ROUTE-SUMMARY present")
        print(f"  - description: {rs['description']}")
        print("  - contains '2.3', '35', '28'")


# --- Test 3: DISP-001 and DISP-004 do not raise --------------------------------


def _test_other_cases() -> None:
    errors: list[str] = []

    for case_id in ("DISP-001", "DISP-004"):
        raw = _load_json(_MOCK_DIR / f"{case_id}.json")
        data_sources = merge_claim_evidence(raw["data_sources"], raw.get("dispute_claim", {}))
        try:
            index = build_evidence_index(data_sources)
        except Exception as exc:
            errors.append(f"{case_id}: build_evidence_index raised {exc!r}")
            continue
        if len(index) == 0:
            errors.append(f"{case_id}: expected > 0 items, got 0")

    if errors:
        print("\nTEST 2 (DISP-001 + DISP-004) RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 2 (DISP-001 + DISP-004) RESULT: PASS")
        print("  - DISP-001: index built without errors, > 0 items")
        print("  - DISP-004: index built without errors, > 0 items")


# ---------------------------------------------------------------------------
# Test 4: DISP-004 image, receipt, trip_end_time, no cleaning_fee_claimed ----
# ---------------------------------------------------------------------------


def _test_disp004() -> None:
    raw = _load_json(_MOCK_DIR / "DISP-004.json")
    data_sources = merge_claim_evidence(raw["data_sources"], raw.get("dispute_claim", {}))
    snapshot = copy.deepcopy(data_sources)

    index = build_evidence_index(data_sources)

    errors: list[str] = []

    # IMG-001 exists, source_type IMAGE, description contains date and
    # known-matches case id, and does NOT contain "recycled".
    img001 = index.get("IMG-001")
    if img001 is None:
        errors.append("Expected 'IMG-001' in index, not found")
    else:
        if img001.get("source_type") != "IMAGE":
            errors.append(f"IMG-001 source_type is {img001.get('source_type')!r}, expected IMAGE")
        desc = img001.get("description", "")
        if "2026-08-30" not in desc:
            errors.append(f"Expected '2026-08-30' in IMG-001 description, got: {desc}")
        if "DISP-0871" not in desc:
            errors.append(f"Expected 'DISP-0871' in IMG-001 description, got: {desc}")
        if "recycled" in desc.lower():
            errors.append(f"IMG-001 description must not contain 'recycled', got: {desc}")

    # RCP-001 exists, source_type RECEIPT, description contains "60.00".
    rcp001 = index.get("RCP-001")
    if rcp001 is None:
        errors.append("Expected 'RCP-001' in index, not found")
    else:
        if rcp001.get("source_type") != "RECEIPT":
            errors.append(f"RCP-001 source_type is {rcp001.get('source_type')!r}, expected RECEIPT")
        desc = rcp001.get("description", "")
        if "60.00" not in desc:
            errors.append(f"Expected '60.00' in RCP-001 description, got: {desc}")

    # TRIP-DATA description contains "trip end time".
    trip_data = index.get("TRIP-DATA")
    if trip_data is None:
        errors.append("Expected 'TRIP-DATA' in index, not found")
    elif "trip end time" not in trip_data.get("description", "").lower():
        errors.append(f"Expected 'trip end time' in TRIP-DATA description, got: {trip_data.get('description')}")

    # No "cleaning_fee_claimed" event anywhere in the index.
    for eid, entry in index.items():
        if "cleaning_fee_claimed" in entry.get("description", "").lower():
            errors.append(f"Found 'cleaning_fee_claimed' in index entry {eid}: {entry['description']}")

    # Input must be unchanged.
    if data_sources != snapshot:
        errors.append("data_sources was modified by build_evidence_index (should be read-only)")

    if errors:
        print("\nTEST 4 (DISP-004) RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 4 (DISP-004) RESULT: PASS")
        print("  - IMG-001: source_type IMAGE, contains '2026-08-30' and 'DISP-0871', no 'recycled'")
        print(f"  - RCP-001: source_type RECEIPT, contains '60.00'")
        print("  - TRIP-DATA contains 'trip end time'")
        print("  - no 'cleaning_fee_claimed' event in index")
        print("  - data_sources unchanged")


# ---------------------------------------------------------------------------


def main() -> None:
    _test_disp002()
    _test_disp001_route_summary()
    _test_other_cases()
    _test_disp004()
    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()
