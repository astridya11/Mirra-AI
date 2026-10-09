"""Standalone tests for backend/shared/photo_evidence.py.

Creates all images in a temporary directory with Pillow (no files written
to the repo).  Run from backend/:

    python -m tests.test_photo_evidence

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import json
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.shared.photo_evidence import build_image_evidence  # noqa: E402

# --- Schema loading -----------------------------------------------------------

_SCHEMAS_PATH = _BACKEND_DIR.parent / "shared" / "schemas.json"


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


# ---------------------------------------------------------------------------
# Helpers to create test images with EXIF
# ---------------------------------------------------------------------------

def _draw_textured_a(img: Image.Image) -> None:
    """Draw a horizontal gradient plus a few shapes (pattern A)."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    # Horizontal gradient.
    for x in range(w):
        gray = int(255 * x / max(w - 1, 1))
        draw.line([(x, 0), (x, h - 1)], fill=(gray, 50, 200 - gray))
    # A few rectangles for extra structure.
    draw.rectangle([10, 10, 30, 40], fill=(255, 128, 0))
    draw.ellipse([40, 20, 70, 60], fill=(0, 200, 100))
    draw.line([(0, 0), (w - 1, h - 1)], fill=(255, 255, 0), width=2)


def _draw_textured_d(img: Image.Image) -> None:
    """Draw a checkerboard / diagonal stripes (pattern D, different from A)."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    # Diagonal stripes.
    for i in range(-h, w + h, 8):
        draw.line([(i, 0), (i + h, h)], fill=(30, 100, 240), width=4)
        draw.line([(i, h), (i + h, 0)], fill=(240, 100, 30), width=4)
    # Checkerboard squares.
    sq = 12
    for y in range(0, h, sq):
        for x in range(0, w, sq):
            if ((x // sq) + (y // sq)) % 2 == 0:
                draw.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(10, 10, 10))


def _draw_textured_e(img: Image.Image) -> None:
    """Draw a vertical gradient with circles (pattern E)."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for y in range(h):
        gray = int(255 * y / max(h - 1, 1))
        draw.line([(0, y), (w - 1, y)], fill=(gray, gray, gray))
    draw.ellipse([20, 20, 50, 50], fill=(200, 0, 0))
    draw.ellipse([60, 60, 90, 90], fill=(0, 0, 200))


def _make_jpeg_with_exif(
    path: Path,
    dt_original: str = "2026:09:25 22:20:00",
    offset_time: str = "+08:00",
    gps_lat: tuple[float, float, float] = (1.0, 21.0, 2.88),    # 1.3508 N
    gps_lat_ref: str = "N",
    gps_lng: tuple[float, float, float] = (103.0, 50.0, 54.6),  # 103.8485 E
    gps_lng_ref: str = "E",
    software: str | None = None,
    size: tuple[int, int] = (100, 100),
    pattern: str = "a",
) -> Path:
    """Create a JPEG with EXIF timestamp, offset, GPS, and a textured pattern.

    Uses ``Image.Exif()`` with the Exif sub-IFD (0x8769) and GPS IFD
    (0x8825) so that reading back via ``getexif().get_ifd(...)`` works.

    *pattern* selects the textured image: "a", "d", "e", or "solid".
    """
    img = Image.new("RGB", size, (128, 128, 128))

    if pattern == "a":
        _draw_textured_a(img)
    elif pattern == "d":
        _draw_textured_d(img)
    elif pattern == "e":
        _draw_textured_e(img)
    # "solid" → leave the flat background.

    exif = Image.Exif()

    # Top-level Software tag (0x0131) — only for the AI test.
    if software:
        exif[0x0131] = software

    # Exif sub-IFD (0x8769): DateTimeOriginal, OffsetTimeOriginal.
    sub = exif.get_ifd(0x8769)
    if dt_original:
        sub[0x9003] = dt_original       # DateTimeOriginal
        sub[0x0132] = dt_original       # DateTime
    if offset_time:
        sub[0x9011] = offset_time       # OffsetTimeOriginal

    # GPS IFD (0x8825): latitude/longitude as DMS tuples.
    gps = exif.get_ifd(0x8825)
    if gps_lat is not None:
        gps[1] = gps_lat_ref            # GPSLatitudeRef
        gps[2] = gps_lat                # GPSLatitude (degrees, minutes, seconds)
    if gps_lng is not None:
        gps[3] = gps_lng_ref            # GPSLongitudeRef
        gps[4] = gps_lng                # GPSLongitude

    img.save(path, format="JPEG", exif=exif)
    return path


def _make_png(path: Path, size: tuple[int, int] = (80, 80), color=(50, 200, 50)) -> Path:
    """Create a PNG without EXIF (solid colour)."""
    img = Image.new("RGB", size, color)
    img.save(path, format="PNG")
    return path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    tmp_dir = tempfile.mkdtemp(prefix="mirra_photo_test_")
    try:
        # ===================================================================
        # CHECK a: JPEG with EXIF DateTimeOriginal + OffsetTimeOriginal + GPS
        # ===================================================================
        print("=" * 70)
        print("CHECK a: JPEG with EXIF timestamp + offset + GPS")
        print("=" * 70)
        check_a_errors: list[str] = []

        path_a = _make_jpeg_with_exif(Path(tmp_dir) / "a.jpg", pattern="a")
        result_a = build_image_evidence(str(path_a), "IMG-A", "mock://a.jpg")

        expected_ts = "2026-09-25T22:20:00+08:00"
        actual_ts = result_a.get("exif_timestamp")
        if actual_ts != expected_ts:
            check_a_errors.append(f"exif_timestamp: got {actual_ts!r}, expected {expected_ts!r}")
        else:
            # Verify datetime.fromisoformat can parse it.
            try:
                datetime.fromisoformat(actual_ts)
            except Exception as exc:
                check_a_errors.append(f"exif_timestamp {actual_ts!r} fails fromisoformat: {exc}")

        gps = result_a.get("exif_gps_location")
        if not isinstance(gps, dict):
            check_a_errors.append(f"exif_gps_location: got {gps!r}, expected dict")
        else:
            lat = gps.get("latitude")
            lng = gps.get("longitude")
            if lat is None or abs(lat - 1.3508) > 0.0001:
                check_a_errors.append(f"latitude: got {lat!r}, expected ~1.3508")
            if lng is None or abs(lng - 103.8485) > 0.0001:
                check_a_errors.append(f"longitude: got {lng!r}, expected ~103.8485")

        if "image_hash" not in result_a:
            check_a_errors.append("image_hash missing")

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - exif_timestamp: {actual_ts}")
            print(f"  - gps: lat={lat}, lng={lng}")
            print(f"  - image_hash: {result_a.get('image_hash')}")

        # ===================================================================
        # CHECK b: PNG without EXIF
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: PNG without EXIF — no timestamp/GPS, has hash")
        print("=" * 70)
        check_b_errors: list[str] = []

        path_b = _make_png(Path(tmp_dir) / "b.png")
        result_b = build_image_evidence(str(path_b), "IMG-B", "mock://b.png")

        if "exif_timestamp" in result_b:
            check_b_errors.append(f"exif_timestamp should be absent, got {result_b['exif_timestamp']!r}")
        if "exif_gps_location" in result_b:
            check_b_errors.append(f"exif_gps_location should be absent, got {result_b['exif_gps_location']!r}")
        if "image_hash" not in result_b:
            check_b_errors.append("image_hash missing")

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - exif_timestamp: absent")
            print(f"  - exif_gps_location: absent")
            print(f"  - image_hash: {result_b.get('image_hash')}")

        # ===================================================================
        # CHECK c: real resized copy of picture A → known_matches DISP-0871
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: resized copy of A → known_matches points to DISP-0871")
        print("=" * 70)
        check_c_errors: list[str] = []

        hash_a = result_a.get("image_hash", "")
        if not hash_a:
            check_c_errors.append("CHECK c needs hash of (a) — image_a has no hash")
        else:
            # Open picture A, resize to half width/height, save as JPEG q=75.
            path_c = Path(tmp_dir) / "c.jpg"
            img_a = Image.open(path_a)
            w, h = img_a.size
            img_c = img_a.resize((w // 2, h // 2), Image.LANCZOS)
            img_c.save(path_c, format="JPEG", quality=75)

            known = {hash_a: "DISP-0871"}
            result_c = build_image_evidence(
                str(path_c), "IMG-C", "mock://c.jpg", known_hashes=known
            )

            hash_c = result_c.get("image_hash", "")
            # Compute Hamming distance for debugging.
            try:
                ha = int(hash_a.split(":", 1)[1], 16)
                hc = int(hash_c.split(":", 1)[1], 16)
                hamming = bin(ha ^ hc).count("1")
            except Exception:
                hamming = "?"

            known_matches = result_c.get("known_matches")
            if not isinstance(known_matches, dict):
                check_c_errors.append(f"known_matches should be a dict, got {known_matches!r}")
            elif known_matches.get(hash_c) != "DISP-0871":
                check_c_errors.append(
                    f"known_matches should point to DISP-0871, got {known_matches!r}"
                )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - hash_a: {hash_a}")
            print(f"  - hash_c: {hash_c}")
            print(f"  - Hamming distance: {hamming}")
            print(f"  - known_matches: {result_c.get('known_matches')}")

        # ===================================================================
        # CHECK d: clearly different picture → known_matches {}
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK d: different picture → known_matches empty")
        print("=" * 70)
        check_d_errors: list[str] = []

        path_d = _make_jpeg_with_exif(
            Path(tmp_dir) / "d.jpg",
            dt_original="2026:09:25 22:20:00",
            offset_time="+08:00",
            size=(120, 80),
            pattern="d",  # checkerboard / diagonal stripes — different from A
        )

        hash_a = result_a.get("image_hash", "")
        if not hash_a:
            check_d_errors.append("CHECK d needs hash of (a)")
        else:
            known = {hash_a: "DISP-0871"}
            result_d = build_image_evidence(
                str(path_d), "IMG-D", "mock://d.jpg", known_hashes=known
            )
            km = result_d.get("known_matches")
            # known_matches should be absent or empty
            if km is not None and km != {}:
                check_d_errors.append(
                    f"known_matches should be empty/absent, got {km!r}"
                )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print(f"  - known_matches: {result_d.get('known_matches', '(absent)')}")

        # ===================================================================
        # CHECK e: JPEG with EXIF Software "Midjourney" → is_ai_generated true
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK e: EXIF Software Midjourney → is_ai_generated true")
        print("=" * 70)
        check_e_errors: list[str] = []

        path_e = _make_jpeg_with_exif(
            Path(tmp_dir) / "e.jpg",
            dt_original="2026:09:25 22:20:00",
            offset_time="+08:00",
            software="Midjourney",
            pattern="e",
        )
        annotation_e = {
            "stain_damage_classification": "OTHER",
            "damage_severity": "MINOR",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.05,
        }
        result_e = build_image_evidence(
            str(path_e), "IMG-E", "mock://e.jpg", annotation=annotation_e
        )
        pr = result_e.get("provider_result")
        if not isinstance(pr, dict):
            check_e_errors.append(f"provider_result missing, got {pr!r}")
        else:
            if pr.get("is_ai_generated") is not True:
                check_e_errors.append(f"is_ai_generated: {pr.get('is_ai_generated')!r}, expected True")
            if pr.get("ai_generated_confidence") != 0.9:
                check_e_errors.append(f"ai_generated_confidence: {pr.get('ai_generated_confidence')!r}, expected 0.9")

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - provider_result.is_ai_generated: True")
            print(f"  - provider_result.ai_generated_confidence: 0.9")

        # ===================================================================
        # CHECK f: annotation only / no annotation + no AI hint
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK f: annotation only vs no annotation + no AI hint")
        print("=" * 70)
        check_f_errors: list[str] = []

        # f1: annotation only (plain JPEG, no AI software)
        path_f1 = _make_jpeg_with_exif(
            Path(tmp_dir) / "f1.jpg",
            dt_original="2026:09:25 22:20:00",
            offset_time="+08:00",
            pattern="a",
        )
        annotation_f1 = {
            "stain_damage_classification": "LIQUID_SPILL",
            "damage_severity": "MODERATE",
            "is_ai_generated": False,
            "ai_generated_confidence": 0.05,
        }
        result_f1 = build_image_evidence(
            str(path_f1), "IMG-F1", "mock://f1.jpg", annotation=annotation_f1
        )
        pr_f1 = result_f1.get("provider_result")
        if not isinstance(pr_f1, dict):
            check_f1_errors = [f"provider_result missing, got {pr_f1!r}"]
        elif pr_f1.get("stain_damage_classification") != "LIQUID_SPILL":
            check_f1_errors = [f"classification: {pr_f1.get('stain_damage_classification')!r}, expected LIQUID_SPILL"]
        elif pr_f1.get("damage_severity") != "MODERATE":
            check_f1_errors = [f"severity: {pr_f1.get('damage_severity')!r}, expected MODERATE"]
        else:
            check_f1_errors = []

        if check_f1_errors:
            check_f_errors.extend(check_f1_errors)
        else:
            print("  - f1 (annotation only): provider_result equals annotation")

        # f2: no annotation, no AI hint → no provider_result
        path_f2 = _make_png(Path(tmp_dir) / "f2.png", color=(90, 160, 110))
        result_f2 = build_image_evidence(
            str(path_f2), "IMG-F2", "mock://f2.png"
        )
        if "provider_result" in result_f2:
            check_f_errors.append(
                f"provider_result should be absent (no annotation, no AI), got {result_f2['provider_result']!r}"
            )
        else:
            print("  - f2 (no annotation, no AI): provider_result absent")

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")

        # ===================================================================
        # CHECK g: unreadable file (random bytes) → only image_id + image_url
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK g: unreadable file (random bytes) → bare dict, no exception")
        print("=" * 70)
        check_g_errors: list[str] = []

        path_g = Path(tmp_dir) / "g.dat"
        path_g.write_bytes(bytes(range(256)) * 4)  # random-ish bytes

        try:
            result_g = build_image_evidence(str(path_g), "IMG-G", "mock://g.dat")
        except Exception as exc:
            check_g_errors.append(f"build_image_evidence raised {type(exc).__name__}: {exc}")
            result_g = {}

        allowed_keys = {"image_id", "image_url"}
        extra = set(result_g.keys()) - allowed_keys
        if extra:
            check_g_errors.append(f"unexpected keys for unreadable file: {extra}")

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print(f"  - result keys: {sorted(result_g.keys())}")

        # ===================================================================
        # CHECK h: every output validates against schemas.json + extract_images
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK h: schema validation + extract_images_from_context")
        print("=" * 70)
        check_h_errors: list[str] = []

        all_results = [
            ("a", result_a),
            ("b", result_b),
            ("c", result_c if 'result_c' in locals() else {"image_id": "IMG-C", "image_url": "mock://c.jpg"}),
            ("d", result_d if 'result_d' in locals() else {"image_id": "IMG-D", "image_url": "mock://d.jpg"}),
            ("e", result_e),
            ("f1", result_f1),
            ("f2", result_f2),
            ("g", result_g),
            ("i", result_i if 'result_i' in locals() else {"image_id": "IMG-I", "image_url": "mock://i.jpg"}),
        ]

        for label, res in all_results:
            # 1. Validate against ImageEvidenceInput schema.
            val_errors = _validate_image_evidence(res)
            if val_errors:
                check_h_errors.append(f"({label}) schema validation: {val_errors}")
            # 2. Test extract_images_from_context where required fields exist.
            #    Build a minimal context wrapping the result.
            context = {"data_sources": {"image_evidence": [res]}}
            try:
                from backend.app.services.verification.image_analysis import extract_images_from_context
                extracted = extract_images_from_context(context)
                if len(extracted) != 1:
                    check_h_errors.append(
                        f"({label}) extract_images_from_context returned {len(extracted)} items, expected 1"
                    )
            except ImportError:
                check_h_errors.append(f"({label}) could not import extract_images_from_context")
            except Exception as exc:
                check_h_errors.append(f"({label}) extract_images_from_context raised {type(exc).__name__}: {exc}")

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print(f"  - all {len(all_results)} outputs validated + extracted")

        # ===================================================================
        # CHECK i: solid-colour image → image_hash present, known_matches {}
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK i: solid-colour image → hash present, known_matches {}")
        print("=" * 70)
        check_i_errors: list[str] = []

        path_i = _make_jpeg_with_exif(
            Path(tmp_dir) / "i.jpg",
            dt_original="2026:09:25 22:20:00",
            offset_time="+08:00",
            pattern="solid",  # flat colour — low-detail dHash
        )
        result_i = build_image_evidence(str(path_i), "IMG-I", "mock://i.jpg")

        if "image_hash" not in result_i:
            check_i_errors.append("image_hash should be present even for low-detail image")
        else:
            hash_i = result_i["image_hash"]
            # The corpus contains the same all-zero hash — must NOT match.
            known = {hash_i: "DISP-9999"}
            result_i2 = build_image_evidence(
                str(path_i), "IMG-I2", "mock://i2.jpg", known_hashes=known
            )
            km = result_i2.get("known_matches")
            if km is not None and km != {}:
                check_i_errors.append(
                    f"known_matches should be empty for low-detail image, got {km!r}"
                )

        if check_i_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_i_errors:
                print(f"  - {e}")
            errors.extend(check_i_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print(f"  - image_hash: {result_i.get('image_hash')}")
            print(f"  - known_matches: {result_i.get('known_matches', '(absent)')}")

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
