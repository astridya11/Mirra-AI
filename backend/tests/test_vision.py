"""Standalone tests for DeepSeek vision integration (receipt OCR + photo analysis).

Monkeypatches ``call_vision_json`` in the modules that import it so no
network calls are made.  Run from backend/:

    python -m tests.test_vision

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import copy
import json
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

_SCHEMAS_PATH = _BACKEND_DIR.parent / "shared" / "schemas.json"


# ---------------------------------------------------------------------------
# Lightweight JSON-schema validator (type, enum, required, additionalProperties,
# $ref, properties, number min/max, array maxItems)
# ---------------------------------------------------------------------------

def _validate_against_schema(instance: Any, schema: dict[str, Any], defs: dict[str, Any], path: str = "root") -> list[str]:
    """Return a list of validation errors (empty = valid).

    Supports: type, enum, required, additionalProperties, $ref, properties,
    number min/max, array maxItems.  This is a minimal validator — not a full
    jsonschema impl.
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
    elif schema_type == "array":
        if not isinstance(instance, list):
            errors.append(f"{path}: expected array, got {type(instance).__name__}")
            return errors
        # maxItems
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(instance) > max_items:
            errors.append(f"{path}: {len(instance)} items > maxItems {max_items}")
        # recurse into items
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(instance):
                errors.extend(_validate_against_schema(item, item_schema, defs, f"{path}[{i}]"))
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
    elif schema_type == "boolean":
        if not isinstance(instance, bool):
            errors.append(f"{path}: expected boolean, got {type(instance).__name__}")

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


def _validate_image_evidence(data: dict[str, Any]) -> list[str]:
    """Validate *data* against ImageEvidenceInput in schemas.json."""
    try:
        with open(_SCHEMAS_PATH, "r", encoding="utf-8") as f:
            all_defs = json.load(f)
    except Exception as exc:
        return [f"(could not load schemas.json: {exc})"]
    defs = all_defs.get("$defs", {})
    schema = defs.get("ImageEvidenceInput", {})
    return _validate_against_schema(data, schema, defs)

import backend.shared.receipt_evidence as receipt_mod  # noqa: E402
import backend.shared.photo_evidence as photo_mod  # noqa: E402
import backend.shared.vision_client as vision_mod  # noqa: E402
from backend.shared.receipt_evidence import build_receipt_evidence  # noqa: E402
from backend.shared.photo_evidence import build_image_evidence  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to create test images
# ---------------------------------------------------------------------------

def _make_jpeg(path: Path) -> Path:
    img = Image.new("RGB", (80, 80), (200, 200, 200))
    img.save(path, format="JPEG")
    return path


def _make_jpeg_with_software(path: Path, software: str) -> Path:
    img = Image.new("RGB", (80, 80), (200, 200, 200))
    exif = Image.Exif()
    exif[0x0131] = software  # Software tag
    img.save(path, format="JPEG", exif=exif)
    return path


# ---------------------------------------------------------------------------
# Fake call_vision_json factory
# ---------------------------------------------------------------------------

def _make_fake_vision(return_value: dict | None, *, count: list | None = None):
    """Return a fake call_vision_json that returns *return_value*.

    If *count* is a list, increments count[0] on each call.
    """
    def _fake(system_prompt, user_text, image_path, **kwargs):
        if count is not None:
            count[0] += 1
        return return_value
    return _fake


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    tmp_dir = tempfile.mkdtemp(prefix="mirra_vision_test_")
    try:
        # ===================================================================
        # CHECK a: receipt, vision readable amount 55 -> ocr_result amount 55
        # ===================================================================
        print("=" * 70)
        print("CHECK a: receipt, vision readable amount 55 -> ocr_result amount 55")
        print("=" * 70)
        check_a_errors: list[str] = []

        path_a = _make_jpeg(Path(tmp_dir) / "a.jpg")
        fake_a = _make_fake_vision({
            "readable": True,
            "amount": 55,
            "currency": "SGD",
            "merchant_name": "X",
            "receipt_date": "2026-09-26T09:00:00",
        })
        original = receipt_mod.call_vision_json
        receipt_mod.call_vision_json = fake_a
        try:
            result_a = build_receipt_evidence(
                str(path_a), "RCP-A", "mock://a.jpg",
                use_vision=True,
            )
        finally:
            receipt_mod.call_vision_json = original

        ocr = result_a.get("ocr_result")
        if not isinstance(ocr, dict):
            check_a_errors.append(f"ocr_result missing, got {ocr!r}")
        else:
            if ocr.get("amount") != 55:
                check_a_errors.append(f"amount: got {ocr.get('amount')!r}, expected 55")
            if ocr.get("receipt_date") != "2026-09-26T09:00:00+08:00":
                check_a_errors.append(
                    f"receipt_date: got {ocr.get('receipt_date')!r}, "
                    f"expected 2026-09-26T09:00:00+08:00"
                )

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - ocr_result: {json.dumps(ocr)}")

        # ===================================================================
        # CHECK b: receipt, vision readable false -> no ocr_result
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: receipt, vision readable false -> no ocr_result")
        print("=" * 70)
        check_b_errors: list[str] = []

        path_b = _make_jpeg(Path(tmp_dir) / "b.jpg")
        fake_b = _make_fake_vision({"readable": False})
        original = receipt_mod.call_vision_json
        receipt_mod.call_vision_json = fake_b
        try:
            result_b = build_receipt_evidence(
                str(path_b), "RCP-B", "mock://b.jpg",
                use_vision=True,
            )
        finally:
            receipt_mod.call_vision_json = original

        if "ocr_result" in result_b:
            check_b_errors.append(
                f"ocr_result should be absent, got {result_b['ocr_result']!r}"
            )

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print("  - ocr_result absent (readable=false)")

        # ===================================================================
        # CHECK c: receipt, vision returns None but annotation given -> annotation used
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: receipt, vision None + annotation -> annotation used")
        print("=" * 70)
        check_c_errors: list[str] = []

        path_c = _make_jpeg(Path(tmp_dir) / "c.jpg")
        annotation_c = {
            "amount": 42.0,
            "currency": "SGD",
            "merchant_name": "Annotation Merchant",
        }
        fake_c = _make_fake_vision(None)
        original = receipt_mod.call_vision_json
        receipt_mod.call_vision_json = fake_c
        try:
            result_c = build_receipt_evidence(
                str(path_c), "RCP-C", "mock://c.jpg",
                annotation=annotation_c,
                use_vision=True,
            )
        finally:
            receipt_mod.call_vision_json = original

        ocr_c = result_c.get("ocr_result")
        if not isinstance(ocr_c, dict):
            check_c_errors.append(f"ocr_result missing, got {ocr_c!r}")
        else:
            if ocr_c.get("amount") != 42.0:
                check_c_errors.append(
                    f"amount: got {ocr_c.get('amount')!r}, expected 42.0 (annotation)"
                )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - ocr_result amount: {ocr_c['amount']} (from annotation)")

        # ===================================================================
        # CHECK d: receipt, vision amount "abc" -> no ocr_result
        # ===================================================================
        print("\n" + "=" * 70)
        print('CHECK d: receipt, vision amount "abc" -> no ocr_result')
        print("=" * 70)
        check_d_errors: list[str] = []

        path_d = _make_jpeg(Path(tmp_dir) / "d.jpg")
        fake_d = _make_fake_vision({
            "readable": True,
            "amount": "abc",
            "currency": "SGD",
            "merchant_name": "Bad",
        })
        original = receipt_mod.call_vision_json
        receipt_mod.call_vision_json = fake_d
        try:
            result_d = build_receipt_evidence(
                str(path_d), "RCP-D", "mock://d.jpg",
                use_vision=True,
            )
        finally:
            receipt_mod.call_vision_json = original

        if "ocr_result" in result_d:
            check_d_errors.append(
                f"ocr_result should be absent (invalid amount), got {result_d['ocr_result']!r}"
            )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print("  - ocr_result absent (amount 'abc' invalid)")

        # ===================================================================
        # CHECK e: image, vision VOMIT/SEVERE -> provider_result matches
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK e: image, vision VOMIT/SEVERE -> provider_result matches")
        print("=" * 70)
        check_e_errors: list[str] = []

        path_e = _make_jpeg(Path(tmp_dir) / "e.jpg")
        fake_e = _make_fake_vision({
            "stain_damage_classification": "VOMIT",
            "damage_severity": "SEVERE",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_e
        try:
            result_e = build_image_evidence(
                str(path_e), "IMG-E", "mock://e.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        pr = result_e.get("provider_result")
        if not isinstance(pr, dict):
            check_e_errors.append(f"provider_result missing, got {pr!r}")
        else:
            if pr.get("stain_damage_classification") != "VOMIT":
                check_e_errors.append(
                    f"classification: got {pr.get('stain_damage_classification')!r}, expected VOMIT"
                )
            if pr.get("damage_severity") != "SEVERE":
                check_e_errors.append(
                    f"severity: got {pr.get('damage_severity')!r}, expected SEVERE"
                )
            if pr.get("is_ai_generated") is not False:
                check_e_errors.append(
                    f"is_ai_generated: got {pr.get('is_ai_generated')!r}, expected False"
                )
            if pr.get("ai_generated_confidence") != 0.1:
                check_e_errors.append(
                    f"ai_generated_confidence: got {pr.get('ai_generated_confidence')!r}, expected 0.1"
                )

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - provider_result: {json.dumps(pr)}")

        # ===================================================================
        # CHECK f: image, vision classification "BLOOD" -> no provider_result
        # ===================================================================
        print("\n" + "=" * 70)
        print('CHECK f: image, vision classification "BLOOD" -> no provider_result')
        print("=" * 70)
        check_f_errors: list[str] = []

        path_f = _make_jpeg(Path(tmp_dir) / "f.jpg")
        fake_f = _make_fake_vision({
            "stain_damage_classification": "BLOOD",
            "damage_severity": "SEVERE",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_f
        try:
            result_f = build_image_evidence(
                str(path_f), "IMG-F", "mock://f.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        if "provider_result" in result_f:
            check_f_errors.append(
                f"provider_result should be absent (invalid classification), "
                f"got {result_f['provider_result']!r}"
            )

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print("  - provider_result absent (classification BLOOD invalid)")

        # ===================================================================
        # CHECK g: EXIF Software Midjourney + vision is_ai_generated false
        #          -> provider_result.is_ai_generated True, confidence 0.9
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK g: EXIF Midjourney + vision is_ai_generated false -> True, 0.9")
        print("=" * 70)
        check_g_errors: list[str] = []

        path_g = _make_jpeg_with_software(Path(tmp_dir) / "g.jpg", "Midjourney")
        fake_g = _make_fake_vision({
            "stain_damage_classification": "OTHER",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_g
        try:
            result_g = build_image_evidence(
                str(path_g), "IMG-G", "mock://g.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        pr_g = result_g.get("provider_result")
        if not isinstance(pr_g, dict):
            check_g_errors.append(f"provider_result missing, got {pr_g!r}")
        else:
            if pr_g.get("is_ai_generated") is not True:
                check_g_errors.append(
                    f"is_ai_generated: got {pr_g.get('is_ai_generated')!r}, expected True"
                )
            if pr_g.get("ai_generated_confidence") != 0.9:
                check_g_errors.append(
                    f"ai_generated_confidence: got {pr_g.get('ai_generated_confidence')!r}, expected 0.9"
                )

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print(f"  - is_ai_generated: {pr_g['is_ai_generated']}")
            print(f"  - ai_generated_confidence: {pr_g['ai_generated_confidence']}")

        # ===================================================================
        # CHECK h: use_vision False -> fake never called (count calls)
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK h: use_vision False -> fake never called")
        print("=" * 70)
        check_h_errors: list[str] = []

        path_h = _make_jpeg(Path(tmp_dir) / "h.jpg")
        call_count = [0]
        fake_h = _make_fake_vision(
            {"stain_damage_classification": "VOMIT"},
            count=call_count,
        )

        # Patch both modules
        orig_photo = photo_mod.call_vision_json
        orig_receipt = receipt_mod.call_vision_json
        photo_mod.call_vision_json = fake_h
        receipt_mod.call_vision_json = fake_h
        try:
            result_h = build_image_evidence(
                str(path_h), "IMG-H", "mock://h.jpg",
                use_vision=False,
            )
        finally:
            photo_mod.call_vision_json = orig_photo
            receipt_mod.call_vision_json = orig_receipt

        if call_count[0] != 0:
            check_h_errors.append(
                f"call_vision_json called {call_count[0]} times, expected 0"
            )

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print(f"  - call_vision_json called {call_count[0]} times")

        # ===================================================================
        # CHECK i: call_vision_json with no API key -> None, no exception
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK i: call_vision_json with no API key -> None, no exception")
        print("=" * 70)
        check_i_errors: list[str] = []

        path_i = _make_jpeg(Path(tmp_dir) / "i.jpg")

        original_key = vision_mod._API_KEY
        vision_mod._API_KEY = None
        try:
            result_i = vision_mod.call_vision_json(
                "system", "user", str(path_i),
            )
        except Exception as exc:
            check_i_errors.append(f"call_vision_json raised {type(exc).__name__}: {exc}")
            result_i = "ERROR"
        finally:
            vision_mod._API_KEY = original_key

        if result_i is not None:
            check_i_errors.append(f"expected None, got {result_i!r}")

        if check_i_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_i_errors:
                print(f"  - {e}")
            errors.extend(check_i_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print("  - call_vision_json returned None (no API key)")

        # ===================================================================
        # CHECK j: fake vision with 2 valid boxes -> stain_regions, no provider_result leak
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK j: vision 2 valid boxes -> stain_regions has 2, provider_result clean")
        print("=" * 70)
        check_j_errors: list[str] = []

        path_j = _make_jpeg(Path(tmp_dir) / "j.jpg")
        fake_j = _make_fake_vision({
            "stain_damage_classification": "VOMIT",
            "damage_severity": "SEVERE",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
            "stain_regions": [
                {"x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4},
                {"x1": 0.5, "y1": 0.6, "x2": 0.7, "y2": 0.8},
            ],
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_j
        try:
            result_j = build_image_evidence(
                str(path_j), "IMG-J", "mock://j.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        sr_j = result_j.get("stain_regions")
        if not isinstance(sr_j, list) or len(sr_j) != 2:
            check_j_errors.append(
                f"stain_regions: got {sr_j!r}, expected list of 2"
            )
        else:
            for i, box in enumerate(sr_j):
                if set(box.keys()) != {"x1", "y1", "x2", "y2"}:
                    check_j_errors.append(
                        f"box {i}: keys {set(box.keys())}, expected {{x1,y1,x2,y2}}"
                    )

        pr_j = result_j.get("provider_result")
        if isinstance(pr_j, dict) and "stain_regions" in pr_j:
            check_j_errors.append(
                "provider_result must NOT contain stain_regions"
            )

        if check_j_errors:
            print("\nCHECK j RESULT: FAIL")
            for e in check_j_errors:
                print(f"  - {e}")
            errors.extend(check_j_errors)
        else:
            print("\nCHECK j RESULT: PASS")
            print(f"  - stain_regions: {json.dumps(sr_j)}")
            print("  - provider_result has no stain_regions key")

        # ===================================================================
        # CHECK k: invalid boxes (x1>x2, 1.5, string, bool) -> dropped; all invalid -> no key
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK k: invalid boxes -> dropped; all invalid -> no stain_regions")
        print("=" * 70)
        check_k_errors: list[str] = []

        path_k = _make_jpeg(Path(tmp_dir) / "k.jpg")
        fake_k = _make_fake_vision({
            "stain_damage_classification": "VOMIT",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
            "stain_regions": [
                {"x1": 0.5, "y1": 0.2, "x2": 0.3, "y2": 0.4},   # x1 > x2
                {"x1": 0.0, "y1": 0.0, "x2": 1.5, "y2": 1.0},     # x2 > 1
                {"x1": "a", "y1": 0.0, "x2": 0.5, "y2": 1.0},      # string
                {"x1": True, "y1": 0.0, "x2": 0.5, "y2": 1.0},     # bool
                {"x1": 0.0, "y1": 0.5, "x2": 0.5, "y2": 0.2},     # y1 > y2
            ],
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_k
        try:
            result_k = build_image_evidence(
                str(path_k), "IMG-K", "mock://k.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        if "stain_regions" in result_k:
            check_k_errors.append(
                f"stain_regions should be absent (all invalid), "
                f"got {result_k['stain_regions']!r}"
            )

        if check_k_errors:
            print("\nCHECK k RESULT: FAIL")
            for e in check_k_errors:
                print(f"  - {e}")
            errors.extend(check_k_errors)
        else:
            print("\nCHECK k RESULT: PASS")
            print("  - stain_regions absent (all boxes invalid)")

        # ===================================================================
        # CHECK l: 5 valid boxes -> only first 3 kept
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK l: 5 valid boxes -> only first 3 kept")
        print("=" * 70)
        check_l_errors: list[str] = []

        path_l = _make_jpeg(Path(tmp_dir) / "l.jpg")
        fake_l = _make_fake_vision({
            "stain_damage_classification": "VOMIT",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.1,
            "stain_regions": [
                {"x1": 0.0, "y1": 0.0, "x2": 0.1, "y2": 0.1},
                {"x1": 0.2, "y1": 0.2, "x2": 0.3, "y2": 0.3},
                {"x1": 0.4, "y1": 0.4, "x2": 0.5, "y2": 0.5},
                {"x1": 0.6, "y1": 0.6, "x2": 0.7, "y2": 0.7},
                {"x1": 0.8, "y1": 0.8, "x2": 0.9, "y2": 0.9},
            ],
        })
        original = photo_mod.call_vision_json
        photo_mod.call_vision_json = fake_l
        try:
            result_l = build_image_evidence(
                str(path_l), "IMG-L", "mock://l.jpg",
                use_vision=True,
            )
        finally:
            photo_mod.call_vision_json = original

        sr_l = result_l.get("stain_regions")
        if not isinstance(sr_l, list) or len(sr_l) != 3:
            check_l_errors.append(
                f"stain_regions: got {len(sr_l) if isinstance(sr_l, list) else sr_l!r}, "
                f"expected 3"
            )

        if check_l_errors:
            print("\nCHECK l RESULT: FAIL")
            for e in check_l_errors:
                print(f"  - {e}")
            errors.extend(check_l_errors)
        else:
            print("\nCHECK l RESULT: PASS")
            print(f"  - stain_regions count: {len(sr_l)} (first 3 of 5 kept)")

        # ===================================================================
        # CHECK m: annotation with stain_regions (use_vision False) -> kept after validation
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK m: annotation with stain_regions, use_vision False -> kept")
        print("=" * 70)
        check_m_errors: list[str] = []

        path_m = _make_jpeg(Path(tmp_dir) / "m.jpg")
        annotation_m = {
            "stain_damage_classification": "FOOD_RESIDUE",
            "damage_severity": "MINOR",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.2,
            "stain_regions": [
                {"x1": 0.1, "y1": 0.1, "x2": 0.2, "y2": 0.2},
                {"x1": 0.8, "y1": 0.8, "x2": 0.9, "y2": 0.9},
            ],
        }
        result_m = build_image_evidence(
            str(path_m), "IMG-M", "mock://m.jpg",
            annotation=annotation_m,
            use_vision=False,
        )

        sr_m = result_m.get("stain_regions")
        if not isinstance(sr_m, list) or len(sr_m) != 2:
            check_m_errors.append(
                f"stain_regions: got {sr_m!r}, expected list of 2"
            )
        else:
            # Verify the boxes are validated floats
            for i, box in enumerate(sr_m):
                for key in ("x1", "y1", "x2", "y2"):
                    if not isinstance(box[key], float):
                        check_m_errors.append(
                            f"box {i} {key}: got {type(box[key]).__name__}, expected float"
                        )

        if check_m_errors:
            print("\nCHECK m RESULT: FAIL")
            for e in check_m_errors:
                print(f"  - {e}")
            errors.extend(check_m_errors)
        else:
            print("\nCHECK m RESULT: PASS")
            print(f"  - stain_regions: {json.dumps(sr_m)}")

        # ===================================================================
        # CHECK n: stain_regions in schema properties (not required);
        #           valid image_evidence dict passes lightweight validator
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK n: stain_regions in schema + valid dict validates")
        print("=" * 70)
        check_n_errors: list[str] = []

        with open(_SCHEMAS_PATH, "r", encoding="utf-8") as f:
            all_defs = json.load(f)
        ie_schema = all_defs.get("$defs", {}).get("ImageEvidenceInput", {})
        ie_props = ie_schema.get("properties", {})
        ie_required = ie_schema.get("required", [])

        # stain_regions must be in properties, NOT in required
        if "stain_regions" not in ie_props:
            check_n_errors.append("stain_regions missing from ImageEvidenceInput.properties")
        else:
            sr = ie_props["stain_regions"]
            if sr.get("type") != "array":
                check_n_errors.append(f"stain_regions.type: got {sr.get('type')!r}, expected array")
            if sr.get("maxItems") != 3:
                check_n_errors.append(f"stain_regions.maxItems: got {sr.get('maxItems')!r}, expected 3")
            items = sr.get("items", {})
            if items.get("additionalProperties") is not False:
                check_n_errors.append("stain_regions.items.additionalProperties: expected false")
            if set(items.get("required", [])) != {"x1", "y1", "x2", "y2"}:
                check_n_errors.append(f"stain_regions.items.required: got {items.get('required')!r}")
            item_props = items.get("properties", {})
            for coord in ("x1", "y1", "x2", "y2"):
                cp = item_props.get(coord, {})
                if cp.get("type") != "number":
                    check_n_errors.append(f"{coord}.type: got {cp.get('type')!r}, expected number")
                if cp.get("minimum") != 0:
                    check_n_errors.append(f"{coord}.minimum: got {cp.get('minimum')!r}, expected 0")
                if cp.get("maximum") != 1:
                    check_n_errors.append(f"{coord}.maximum: got {cp.get('maximum')!r}, expected 1")

        if "stain_regions" in ie_required:
            check_n_errors.append("stain_regions must NOT be in ImageEvidenceInput.required")

        # Valid image_evidence dict with stain_regions -> passes validator
        valid_ie = {
            "image_id": "IMG-N",
            "image_url": "/evidence/DISP-001/IMG-N.jpg",
            "stain_regions": [
                {"x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4},
                {"x1": 0.5, "y1": 0.5, "x2": 0.7, "y2": 0.8},
            ],
        }
        val_errors = _validate_image_evidence(valid_ie)
        if val_errors:
            check_n_errors.append(f"valid stain_regions failed validation: {val_errors}")

        if check_n_errors:
            print("\nCHECK n RESULT: FAIL")
            for e in check_n_errors:
                print(f"  - {e}")
            errors.extend(check_n_errors)
        else:
            print("\nCHECK n RESULT: PASS")
            print("  - stain_regions in schema (optional, maxItems 3, coords 0-1)")
            print("  - valid image_evidence with stain_regions validated OK")

        # ===================================================================
        # CHECK o: box with x1 = 1.5 fails lightweight validator
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK o: box with x1=1.5 fails schema validation")
        print("=" * 70)
        check_o_errors: list[str] = []

        invalid_ie = {
            "image_id": "IMG-O",
            "image_url": "/evidence/DISP-001/IMG-O.jpg",
            "stain_regions": [
                {"x1": 1.5, "y1": 0.2, "x2": 0.3, "y2": 0.4},
            ],
        }
        val_errors = _validate_image_evidence(invalid_ie)
        if not val_errors:
            check_o_errors.append("x1=1.5 should have failed validation but passed")
        else:
            # Verify the error mentions maximum
            if not any("maximum" in e for e in val_errors):
                check_o_errors.append(
                    f"expected error about maximum, got: {val_errors}"
                )

        if check_o_errors:
            print("\nCHECK o RESULT: FAIL")
            for e in check_o_errors:
                print(f"  - {e}")
            errors.extend(check_o_errors)
        else:
            print("\nCHECK o RESULT: PASS")
            print("  - x1=1.5 correctly rejected by validator")

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
