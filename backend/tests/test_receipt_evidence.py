"""Standalone tests for backend/shared/receipt_evidence.py.

Creates all receipt images in a temporary directory with Pillow (no files
written to the repo).  Run from backend/:

    python -m tests.test_receipt_evidence

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import json
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from PIL import Image

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.shared.receipt_evidence import build_receipt_evidence  # noqa: E402

# --- Schema loading -----------------------------------------------------------

_SCHEMAS_PATH = _BACKEND_DIR.parent / "shared" / "schemas.json"
_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"


# ---------------------------------------------------------------------------
# Lightweight JSON-schema validator (type, enum, required, additionalProperties)
# ---------------------------------------------------------------------------

def _validate_against_schema(instance: Any, schema: dict[str, Any], defs: dict[str, Any], path: str = "root") -> list[str]:
    """Return a list of validation errors (empty = valid).

    Supports: type, enum, required, additionalProperties, $ref, properties,
    number min/max.  This is a minimal validator — not a full jsonschema impl.
    """
    errors: list[str] = []

    if "$ref" in schema:
        ref_name = schema["$ref"].split("/")[-1]
        ref_schema = defs.get(ref_name, {})
        return _validate_against_schema(instance, ref_schema, defs, path)

    if "type" not in schema and "enum" not in schema and "properties" not in schema:
        return errors

    schema_type = schema.get("type")
    if schema_type == "object":
        if not isinstance(instance, dict):
            errors.append(f"{path}: expected object, got {type(instance).__name__}")
            return errors
        # required
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(f"{path}: missing required '{req}'")
        # additionalProperties: false
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in instance:
                if key not in props:
                    errors.append(f"{path}: additional property '{key}' not allowed")
        # recurse into properties
        for key, sub_schema in props.items():
            if key in instance:
                errors.extend(_validate_against_schema(instance[key], sub_schema, defs, f"{path}.{key}"))
    elif schema_type == "string":
        if not isinstance(instance, str):
            errors.append(f"{path}: expected string, got {type(instance).__name__}")
    elif schema_type == "number":
        if isinstance(instance, bool) or not isinstance(instance, (int, float)):
            errors.append(f"{path}: expected number, got {type(instance).__name__}")
        else:
            if "minimum" in schema and instance < schema["minimum"]:
                errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
            if "maximum" in schema and instance > schema["maximum"]:
                errors.append(f"{path}: {instance} > maximum {schema['maximum']}")

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not in enum {schema['enum']}")

    # format: date-time — just verify datetime.fromisoformat works.
    fmt = schema.get("format")
    if fmt == "date-time" and isinstance(instance, str):
        try:
            datetime.fromisoformat(instance)
        except Exception:
            errors.append(f"{path}: '{instance}' is not a valid ISO 8601 date-time")

    return errors


def _validate_receipt_evidence(data: dict[str, Any]) -> list[str]:
    """Validate *data* against ReceiptEvidenceInput in schemas.json."""
    try:
        with open(_SCHEMAS_PATH, "r", encoding="utf-8") as f:
            all_defs = json.load(f)
    except Exception as exc:
        return [f"(could not load schemas.json: {exc})"]
    defs = all_defs.get("$defs", {})
    schema = defs.get("ReceiptEvidenceInput", {})
    return _validate_against_schema(data, schema, defs)


# ---------------------------------------------------------------------------
# Helpers to create test receipt images
# ---------------------------------------------------------------------------

def _make_jpeg(path: Path, size: tuple[int, int] = (80, 80)) -> Path:
    """Create a JPEG receipt-like image."""
    img = Image.new("RGB", size, (240, 240, 240))
    img.save(path, format="JPEG")
    return path


def _make_png(path: Path, size: tuple[int, int] = (80, 80)) -> Path:
    """Create a PNG receipt-like image."""
    img = Image.new("RGB", size, (240, 240, 240))
    img.save(path, format="PNG")
    return path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    tmp_dir = tempfile.mkdtemp(prefix="mirra_receipt_evidence_test_")
    try:
        # ===================================================================
        # CHECK a: JPEG + annotation → ocr_result matches
        # ===================================================================
        print("=" * 70)
        print("CHECK a: JPEG + annotation → ocr_result matches")
        print("=" * 70)
        check_a_errors: list[str] = []

        path_a = _make_jpeg(Path(tmp_dir) / "a.jpg")
        annotation_a = {
            "amount": 45.0,
            "currency": "SGD",
            "merchant_name": "Sparkle Car Care Pte Ltd",
            "receipt_date": "2026-09-26T09:30:00+08:00",
            "ocr_confidence": 0.95,
        }
        result_a = build_receipt_evidence(
            str(path_a), "RCP-A", "mock://a.jpg",
            uploaded_at="2026-09-26T10:15:00+08:00",
            annotation=annotation_a,
        )

        ocr = result_a.get("ocr_result")
        if not isinstance(ocr, dict):
            check_a_errors.append(f"ocr_result missing, got {ocr!r}")
        else:
            if ocr.get("amount") != 45.0:
                check_a_errors.append(f"amount: got {ocr.get('amount')!r}, expected 45.0")
            if ocr.get("currency") != "SGD":
                check_a_errors.append(f"currency: got {ocr.get('currency')!r}, expected SGD")
            if ocr.get("merchant_name") != "Sparkle Car Care Pte Ltd":
                check_a_errors.append(f"merchant_name: got {ocr.get('merchant_name')!r}")
            if ocr.get("receipt_date") != "2026-09-26T09:30:00+08:00":
                check_a_errors.append(f"receipt_date: got {ocr.get('receipt_date')!r}")
            if ocr.get("ocr_confidence") != 0.95:
                check_a_errors.append(f"ocr_confidence: got {ocr.get('ocr_confidence')!r}, expected 0.95")

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - ocr_result: {json.dumps(ocr)}")

        # ===================================================================
        # CHECK b: PNG + annotation → works the same
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: PNG + annotation → works the same")
        print("=" * 70)
        check_b_errors: list[str] = []

        path_b = _make_png(Path(tmp_dir) / "b.png")
        annotation_b = {
            "amount": 30.0,
            "currency": "SGD",
            "merchant_name": "Wash & Go",
            "receipt_date": "2026-09-26T08:00:00+08:00",
            "ocr_confidence": 0.88,
        }
        result_b = build_receipt_evidence(
            str(path_b), "RCP-B", "mock://b.png",
            annotation=annotation_b,
        )

        ocr = result_b.get("ocr_result")
        if not isinstance(ocr, dict):
            check_b_errors.append(f"ocr_result missing, got {ocr!r}")
        else:
            if ocr.get("amount") != 30.0:
                check_b_errors.append(f"amount: got {ocr.get('amount')!r}, expected 30.0")

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - ocr_result: {json.dumps(ocr)}")

        # ===================================================================
        # CHECK c: no annotation and _run_ocr returns None → no ocr_result
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: no annotation, _run_ocr None → no ocr_result")
        print("=" * 70)
        check_c_errors: list[str] = []

        path_c = _make_jpeg(Path(tmp_dir) / "c.jpg")
        result_c = build_receipt_evidence(
            str(path_c), "RCP-NO-ANNOT", "mock://c.jpg",
        )

        if "ocr_result" in result_c:
            check_c_errors.append(
                f"ocr_result should be absent, got {result_c['ocr_result']!r}"
            )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - result keys: {sorted(result_c.keys())}")

        # ===================================================================
        # CHECK d: annotation with invalid amount → no ocr_result
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK d: invalid amounts (abc, -5, True) → no ocr_result")
        print("=" * 70)
        check_d_errors: list[str] = []

        path_d = _make_jpeg(Path(tmp_dir) / "d.jpg")
        for label, bad_amount in [("abc", "abc"), ("negative", -5), ("bool", True)]:
            result_d = build_receipt_evidence(
                str(path_d), f"RCP-D-{label}", f"mock://d_{label}.jpg",
                annotation={
                    "amount": bad_amount,
                    "currency": "SGD",
                    "merchant_name": "Test Merchant",
                },
            )
            if "ocr_result" in result_d:
                check_d_errors.append(
                    f"ocr_result should be absent for amount={bad_amount!r}, got {result_d['ocr_result']!r}"
                )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print("  - all invalid amounts correctly omitted ocr_result")

        # ===================================================================
        # CHECK e: naive receipt_date → "+08:00" added; invalid date → dropped
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK e: naive receipt_date → +08:00; invalid date → dropped")
        print("=" * 70)
        check_e_errors: list[str] = []

        path_e = _make_jpeg(Path(tmp_dir) / "e.jpg")

        # e1: naive date → should get +08:00
        result_e1 = build_receipt_evidence(
            str(path_e), "RCP-E1", "mock://e1.jpg",
            annotation={
                "amount": 50.0,
                "currency": "SGD",
                "receipt_date": "2026-09-26T09:30:00",
            },
        )
        ocr_e1 = result_e1.get("ocr_result")
        if not isinstance(ocr_e1, dict):
            check_e_errors.append(f"e1: ocr_result missing")
        else:
            rd = ocr_e1.get("receipt_date")
            if rd != "2026-09-26T09:30:00+08:00":
                check_e_errors.append(f"e1: receipt_date got {rd!r}, expected 2026-09-26T09:30:00+08:00")

        # e2: invalid date → field dropped, ocr_result kept
        result_e2 = build_receipt_evidence(
            str(path_e), "RCP-E2", "mock://e2.jpg",
            annotation={
                "amount": 50.0,
                "currency": "SGD",
                "receipt_date": "not-a-date",
            },
        )
        ocr_e2 = result_e2.get("ocr_result")
        if not isinstance(ocr_e2, dict):
            check_e_errors.append(f"e2: ocr_result should be present (amount valid)")
        else:
            if "receipt_date" in ocr_e2:
                check_e_errors.append(f"e2: receipt_date should be absent, got {ocr_e2.get('receipt_date')!r}")
            if ocr_e2.get("amount") != 50.0:
                check_e_errors.append(f"e2: amount should be 50.0, got {ocr_e2.get('amount')!r}")

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - e1 receipt_date: {ocr_e1.get('receipt_date')}")
            print(f"  - e2 receipt_date: absent (dropped)")
            print(f"  - e2 amount: {ocr_e2.get('amount')}")

        # ===================================================================
        # CHECK f: unreadable file → only receipt_id, receipt_url, uploaded_at
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK f: unreadable file → bare dict, no exception")
        print("=" * 70)
        check_f_errors: list[str] = []

        path_f = Path(tmp_dir) / "f.dat"
        path_f.write_bytes(bytes(range(256)) * 4)  # random-ish bytes

        try:
            result_f = build_receipt_evidence(
                str(path_f), "RCP-F", "mock://f.dat",
                uploaded_at="2026-09-26T10:15:00+08:00",
            )
        except Exception as exc:
            check_f_errors.append(f"build_receipt_evidence raised {type(exc).__name__}: {exc}")
            result_f = {}

        allowed_keys = {"receipt_id", "receipt_url", "uploaded_at"}
        extra = set(result_f.keys()) - allowed_keys
        if extra:
            check_f_errors.append(f"unexpected keys for unreadable file: {extra}")
        if "ocr_result" in result_f:
            check_f_errors.append("ocr_result should be absent for unreadable file")

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print(f"  - result keys: {sorted(result_f.keys())}")

        # ===================================================================
        # CHECK g: every output validates against ReceiptEvidenceInput
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK g: schema validation of all outputs")
        print("=" * 70)
        check_g_errors: list[str] = []

        # CHECK i: monkeypatch _run_ocr → provider result used instead of annotation
        print("\n" + "=" * 70)
        print("CHECK i: _run_ocr monkeypatched → provider result used over annotation")
        print("=" * 70)
        check_i_errors: list[str] = []

        import backend.shared.receipt_evidence as receipt_evidence_mod  # noqa: E402

        path_i = _make_jpeg(Path(tmp_dir) / "i.jpg")
        annotation_i = {
            "amount": 999.0,  # deliberately wrong — should NOT be used
            "currency": "SGD",
            "merchant_name": "Annotation Merchant",
            "receipt_date": "2026-09-26T09:30:00+08:00",
            "ocr_confidence": 0.10,
        }
        provider_result_i = {
            "amount": 75.0,
            "currency": "SGD",
            "merchant_name": "OCR Provider Merchant",
            "receipt_date": "2026-09-26T10:00:00+08:00",
            "ocr_confidence": 0.92,
        }

        original_run_ocr = receipt_evidence_mod._run_ocr
        receipt_evidence_mod._run_ocr = lambda fp: provider_result_i  # type: ignore
        try:
            result_i = build_receipt_evidence(
                str(path_i), "RCP-I", "mock://i.jpg",
                annotation=annotation_i,
                use_vision=True,
            )
        finally:
            receipt_evidence_mod._run_ocr = original_run_ocr  # type: ignore

        ocr_i = result_i.get("ocr_result")
        if not isinstance(ocr_i, dict):
            check_i_errors.append(f"ocr_result missing, got {ocr_i!r}")
        else:
            if ocr_i.get("amount") != 75.0:
                check_i_errors.append(f"amount: got {ocr_i.get('amount')!r}, expected 75.0 (from provider)")
            if ocr_i.get("merchant_name") != "OCR Provider Merchant":
                check_i_errors.append(f"merchant_name: got {ocr_i.get('merchant_name')!r}, expected OCR Provider Merchant")
            if ocr_i.get("ocr_confidence") != 0.92:
                check_i_errors.append(f"ocr_confidence: got {ocr_i.get('ocr_confidence')!r}, expected 0.92")

        if check_i_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_i_errors:
                print(f"  - {e}")
            errors.extend(check_i_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print(f"  - ocr_result: {json.dumps(ocr_i)}")

        all_results = [
            ("a", result_a),
            ("b", result_b),
            ("c", result_c),
            ("d-abc", result_d if 'result_d' in locals() else {}),
            ("e1", result_e1),
            ("e2", result_e2),
            ("f", result_f),
            ("i", result_i if 'result_i' in locals() else {}),
        ]

        for label, res in all_results:
            val_errors = _validate_receipt_evidence(res)
            if val_errors:
                check_g_errors.append(f"({label}) schema validation: {val_errors}")

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print(f"  - all {len(all_results)} outputs validated against ReceiptEvidenceInput")

        # ===================================================================
        # CHECK h: end-to-end with POL-4
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK h: end-to-end POL-4 → APPROVED, fee 40 (min(45, cap 40))")
        print("=" * 70)
        check_h_errors: list[str] = []

        try:
            from backend.policy import precedent_store  # noqa: E402

            # Load DISP-004 mock file and replace its receipt_evidence with
            # the output of check (a).
            with open(_MOCK_DATA_DIR / "DISP-004.json", "r", encoding="utf-8") as f:
                disp004 = json.load(f)

            # Replace receipt_evidence with the output of check (a).
            disp004["data_sources"]["receipt_evidence"] = [result_a]

            # Build a valid LIQUID_SPILL photo analysis within 30 min / 500 m
            # of DISP-004's drop-off.
            trip_end = disp004["data_sources"]["trip_data"]["trip_end_time"]
            dropoff = disp004["data_sources"]["trip_data"]["dropoff_location"]

            # EXIF timestamp 10 min after trip_end, at drop-off coords.
            dt_trip_end = datetime.fromisoformat(trip_end)
            dt_photo = dt_trip_end + timedelta(minutes=10)

            valid_image_analysis = {
                "image_id": "IMG-POL4",
                "image_url": "mock://evidence/DISP-004/IMG-POL4.jpg",
                "exif_timestamp": dt_photo.isoformat(),
                "exif_gps_location": {
                    "latitude": dropoff["lat"],
                    "longitude": dropoff["lng"],
                    "timestamp": dt_photo.isoformat(),
                },
                "is_ai_generated": False,
                "ai_generated_confidence": 0.05,
                "stain_damage_classification": "LIQUID_SPILL",
                "damage_severity": "MODERATE",
                "exif_consistent_with_trip": True,
            }

            ctx = dict(disp004)
            ctx["bonus_modules"] = {"image_exif_analyses": [valid_image_analysis]}

            # Use a temp KB so the real one is never touched.
            tmp_kb = str(Path(tmp_dir) / "kb_h.json")
            precedent_store.reset_for_testing(kb_path=tmp_kb)

            clause = precedent_store._pol4_clause() if hasattr(precedent_store, "_pol4_clause") else None
            if clause is None:
                policy = precedent_store._load_policy()
                clause = policy.get("clauses", {}).get("POL-4", {})
                clause = {**clause, "clause_id": "POL-4"}

            pol4_result = precedent_store._compute_cleaning_fee(clause, ctx)

            if pol4_result.get("computable") is not True:
                check_h_errors.append(f"computable is {pol4_result.get('computable')!r}, expected True")
            if pol4_result.get("ruling_type") != "APPROVED":
                check_h_errors.append(f"ruling_type is {pol4_result.get('ruling_type')!r}, expected APPROVED")
            fee = pol4_result.get("action", {}).get("cleaning_fee_amount")
            if fee != 40.0:
                check_h_errors.append(f"cleaning_fee_amount is {fee!r}, expected 40.0 (min(45, cap 40))")

            # Restore KB path
            precedent_store.reset_for_testing(
                kb_path=precedent_store._DEFAULT_KB_PATH,
                policy_path=precedent_store._DEFAULT_POLICY_PATH,
            )

        except Exception as exc:
            check_h_errors.append(f"unexpected exception: {exc!r}")
            check_h_errors.append(traceback.format_exc())

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print(f"  - ruling_type: {pol4_result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {pol4_result['reason']}")

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

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
