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


# --- Test 2: DISP-001 and DISP-003 do not raise --------------------------------


def _test_other_cases() -> None:
    errors: list[str] = []

    for case_id in ("DISP-001", "DISP-003"):
        raw = _load_json(_MOCK_DIR / f"{case_id}.json")
        try:
            index = build_evidence_index(raw["data_sources"])
        except Exception as exc:
            errors.append(f"{case_id}: build_evidence_index raised {exc!r}")
            continue
        if len(index) == 0:
            errors.append(f"{case_id}: expected > 0 items, got 0")

    if errors:
        print("\nTEST 2 (DISP-001 + DISP-003) RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 2 (DISP-001 + DISP-003) RESULT: PASS")
        print("  - DISP-001: index built without errors, > 0 items")
        print("  - DISP-003: index built without errors, > 0 items")


# ---------------------------------------------------------------------------


def main() -> None:
    _test_disp002()
    _test_other_cases()
    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()
