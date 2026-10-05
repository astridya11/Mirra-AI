"""
Standalone tests for backend/shared/claim_evidence.py.

Verifies that merge_claim_evidence builds the agent-facing data_sources
view correctly: evidence lists from dispute_claim override data_sources,
empty/missing lists preserve existing values, inputs are never mutated,
and None / non-dict inputs are handled safely.

Run from backend/:
    python -m tests.test_claim_evidence

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import copy
import json
import sys
from pathlib import Path

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.shared.claim_evidence import merge_claim_evidence  # noqa: E402

_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    # ===================================================================
    # CHECK a: dispute_claim has image + receipt lists -> both appear in result
    # ===================================================================
    print("=" * 70)
    print("CHECK a: dispute_claim has image + receipt lists -> both appear in result")
    print("=" * 70)
    check_a_errors: list[str] = []

    data_sources = {"trip_data": {"trip_id": "T-1"}}
    dispute_claim = {
        "image_evidence": [{"image_id": "IMG-1"}],
        "receipt_evidence": [{"receipt_id": "RCP-1"}],
    }

    result = merge_claim_evidence(data_sources, dispute_claim)

    if not isinstance(result, dict):
        check_a_errors.append(f"result is not a dict, got {type(result).__name__}")
    else:
        if result.get("image_evidence") != [{"image_id": "IMG-1"}]:
            check_a_errors.append(f"image_evidence: got {result.get('image_evidence')!r}")
        if result.get("receipt_evidence") != [{"receipt_id": "RCP-1"}]:
            check_a_errors.append(f"receipt_evidence: got {result.get('receipt_evidence')!r}")
        if result.get("trip_data") != {"trip_id": "T-1"}:
            check_a_errors.append(f"trip_data not preserved: got {result.get('trip_data')!r}")

    if check_a_errors:
        print("\nCHECK a RESULT: FAIL")
        for e in check_a_errors:
            print(f"  - {e}")
        errors.extend(check_a_errors)
    else:
        print("\nCHECK a RESULT: PASS")
        print(f"  - image_evidence: {result.get('image_evidence')}")
        print(f"  - receipt_evidence: {result.get('receipt_evidence')}")

    # ===================================================================
    # CHECK b: dispute_claim lists empty or missing -> data_sources values kept
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK b: dispute_claim lists empty or missing -> data_sources values kept")
    print("=" * 70)
    check_b_errors: list[str] = []

    # b1: dispute_claim has empty lists
    data_sources_b1 = {
        "image_evidence": [{"image_id": "IMG-DS"}],
        "receipt_evidence": [{"receipt_id": "RCP-DS"}],
    }
    dispute_claim_b1 = {
        "image_evidence": [],
        "receipt_evidence": [],
    }
    result_b1 = merge_claim_evidence(data_sources_b1, dispute_claim_b1)

    if result_b1.get("image_evidence") != [{"image_id": "IMG-DS"}]:
        check_b_errors.append(f"b1 image_evidence: got {result_b1.get('image_evidence')!r}, expected data_sources value")
    if result_b1.get("receipt_evidence") != [{"receipt_id": "RCP-DS"}]:
        check_b_errors.append(f"b1 receipt_evidence: got {result_b1.get('receipt_evidence')!r}, expected data_sources value")

    # b2: dispute_claim has no evidence keys at all
    data_sources_b2 = {
        "image_evidence": [{"image_id": "IMG-DS2"}],
        "receipt_evidence": [{"receipt_id": "RCP-DS2"}],
    }
    dispute_claim_b2 = {"description": "some claim"}
    result_b2 = merge_claim_evidence(data_sources_b2, dispute_claim_b2)

    if result_b2.get("image_evidence") != [{"image_id": "IMG-DS2"}]:
        check_b_errors.append(f"b2 image_evidence: got {result_b2.get('image_evidence')!r}, expected data_sources value")
    if result_b2.get("receipt_evidence") != [{"receipt_id": "RCP-DS2"}]:
        check_b_errors.append(f"b2 receipt_evidence: got {result_b2.get('receipt_evidence')!r}, expected data_sources value")

    if check_b_errors:
        print("\nCHECK b RESULT: FAIL")
        for e in check_b_errors:
            print(f"  - {e}")
        errors.extend(check_b_errors)
    else:
        print("\nCHECK b RESULT: PASS")
        print(f"  - b1 image_evidence (empty list in claim): {result_b1.get('image_evidence')}")
        print(f"  - b2 receipt_evidence (missing in claim): {result_b2.get('receipt_evidence')}")

    # ===================================================================
    # CHECK c: inputs are not mutated
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK c: inputs are not mutated")
    print("=" * 70)
    check_c_errors: list[str] = []

    data_sources_c = {
        "trip_data": {"trip_id": "T-C"},
        "image_evidence": [{"image_id": "IMG-OLD"}],
    }
    dispute_claim_c = {
        "image_evidence": [{"image_id": "IMG-NEW"}],
        "receipt_evidence": [{"receipt_id": "RCP-NEW"}],
    }

    ds_snapshot = copy.deepcopy(data_sources_c)
    claim_snapshot = copy.deepcopy(dispute_claim_c)

    result_c = merge_claim_evidence(data_sources_c, dispute_claim_c)

    if data_sources_c != ds_snapshot:
        check_c_errors.append(f"data_sources was mutated: before={ds_snapshot}, after={data_sources_c}")
    if dispute_claim_c != claim_snapshot:
        check_c_errors.append(f"dispute_claim was mutated: before={claim_snapshot}, after={dispute_claim_c}")

    # Also verify the result has the merged values
    if result_c.get("image_evidence") != [{"image_id": "IMG-NEW"}]:
        check_c_errors.append(f"result image_evidence: got {result_c.get('image_evidence')!r}, expected claim value")

    if check_c_errors:
        print("\nCHECK c RESULT: FAIL")
        for e in check_c_errors:
            print(f"  - {e}")
        errors.extend(check_c_errors)
    else:
        print("\nCHECK c RESULT: PASS")
        print(f"  - data_sources unchanged: {data_sources_c == ds_snapshot}")
        print(f"  - dispute_claim unchanged: {dispute_claim_c == claim_snapshot}")
        print(f"  - result image_evidence: {result_c.get('image_evidence')}")

    # ===================================================================
    # CHECK d: None / non-dict inputs -> returns {} without exception
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK d: None / non-dict inputs -> returns {} without exception")
    print("=" * 70)
    check_d_errors: list[str] = []

    # d1: both None
    try:
        result_d1 = merge_claim_evidence(None, None)
    except Exception as exc:
        result_d1 = None
        check_d_errors.append(f"d1 raised {type(exc).__name__}: {exc}")

    if result_d1 != {}:
        check_d_errors.append(f"d1 result: got {result_d1!r}, expected {{}}")

    # d2: data_sources is a list, dispute_claim is None
    try:
        result_d2 = merge_claim_evidence([1, 2], None)
    except Exception as exc:
        result_d2 = None
        check_d_errors.append(f"d2 raised {type(exc).__name__}: {exc}")

    if result_d2 != {}:
        check_d_errors.append(f"d2 result: got {result_d2!r}, expected {{}}")

    # d3: data_sources is None, dispute_claim is a string
    try:
        result_d3 = merge_claim_evidence(None, "not a dict")
    except Exception as exc:
        result_d3 = None
        check_d_errors.append(f"d3 raised {type(exc).__name__}: {exc}")

    if result_d3 != {}:
        check_d_errors.append(f"d3 result: got {result_d3!r}, expected {{}}")

    if check_d_errors:
        print("\nCHECK d RESULT: FAIL")
        for e in check_d_errors:
            print(f"  - {e}")
        errors.extend(check_d_errors)
    else:
        print("\nCHECK d RESULT: PASS")
        print(f"  - merge(None, None) = {result_d1}")
        print(f"  - merge([1,2], None) = {result_d2}")
        print(f"  - merge(None, 'str') = {result_d3}")

    # ===================================================================
    # CHECK e: DISP-004 mock file -> result has evidence; loaded file unchanged
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK e: DISP-004 mock -> merged result has evidence; loaded file clean")
    print("=" * 70)
    check_e_errors: list[str] = []

    try:
        raw_004 = _load_json(_MOCK_DATA_DIR / "DISP-004.json")
        ds_004 = raw_004.get("data_sources", {})
        claim_004 = raw_004.get("dispute_claim", {})

        # The loaded case data_sources should NOT have image_evidence key
        if "image_evidence" in ds_004:
            check_e_errors.append(
                f"loaded DISP-004 data_sources already has image_evidence key "
                f"(expected it to live in dispute_claim only)"
            )

        merged_004 = merge_claim_evidence(ds_004, claim_004)

        img_ev = merged_004.get("image_evidence")
        if not isinstance(img_ev, list) or len(img_ev) < 1:
            check_e_errors.append(
                f"merged result image_evidence: got {img_ev!r}, expected list with >=1 item"
            )

        rcp_ev = merged_004.get("receipt_evidence")
        if not isinstance(rcp_ev, list) or len(rcp_ev) < 1:
            check_e_errors.append(
                f"merged result receipt_evidence: got {rcp_ev!r}, expected list with >=1 item"
            )

        # The original loaded data_sources must still not have image_evidence
        if "image_evidence" in raw_004.get("data_sources", {}):
            check_e_errors.append("raw_004 data_sources was mutated (image_evidence appeared)")

    except Exception as exc:
        check_e_errors.append(f"unexpected exception: {exc!r}")

    if check_e_errors:
        print("\nCHECK e RESULT: FAIL")
        for e in check_e_errors:
            print(f"  - {e}")
        errors.extend(check_e_errors)
    else:
        print("\nCHECK e RESULT: PASS")
        print(f"  - merged image_evidence count: {len(merged_004.get('image_evidence', []))}")
        print(f"  - merged receipt_evidence count: {len(merged_004.get('receipt_evidence', []))}")
        print(f"  - loaded data_sources has no image_evidence key: {'image_evidence' not in raw_004.get('data_sources', {})}")

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
