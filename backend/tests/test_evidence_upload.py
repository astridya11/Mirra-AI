"""
Standalone tests for backend/shared/evidence_upload.py.

Creates all evidence images in a temporary directory with Pillow (no
files written to the repo).  Run from backend/:

    python -m tests.test_evidence_upload

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import base64
import json
import sys
import tempfile
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image
from PIL.TiffImagePlugin import IFDRational
from PIL.ExifTags import Base as ExifBase

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.shared.evidence_upload import (  # noqa: E402
    EvidenceUploadError,
    process_uploaded_evidence,
)

_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"
_SCHEMAS_PATH = _BACKEND_DIR.parent / "shared" / "schemas.json"


# ---------------------------------------------------------------------------
# Schema validator (lightweight — same as test_receipt_evidence.py)
# ---------------------------------------------------------------------------

def _validate_against_schema(
    instance: Any, schema: dict[str, Any], defs: dict[str, Any], path: str = "root"
) -> list[str]:
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
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(f"{path}: missing required '{req}'")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in instance:
                if key not in props:
                    errors.append(f"{path}: additional property '{key}' not allowed")
        for key, sub_schema in props.items():
            if key in instance:
                errors.extend(
                    _validate_against_schema(instance[key], sub_schema, defs, f"{path}.{key}")
                )
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
    fmt = schema.get("format")
    if fmt == "date-time" and isinstance(instance, str):
        try:
            datetime.fromisoformat(instance)
        except Exception:
            errors.append(f"{path}: '{instance}' is not a valid ISO 8601 date-time")
    return errors


def _load_defs() -> dict[str, Any]:
    with open(_SCHEMAS_PATH, "r", encoding="utf-8") as f:
        return json.load(f).get("$defs", {})


def _validate_image_evidence(data: dict) -> list[str]:
    defs = _load_defs()
    schema = defs.get("ImageEvidenceInput", {})
    return _validate_against_schema(data, schema, defs)


def _validate_receipt_evidence(data: dict) -> list[str]:
    defs = _load_defs()
    schema = defs.get("ReceiptEvidenceInput", {})
    return _validate_against_schema(data, schema, defs)


# ---------------------------------------------------------------------------
# Helpers: create JPEG/PNG images with EXIF
# ---------------------------------------------------------------------------

_EXIF_SUB_IFD = 0x8769
_TAG_DATE_TIME_ORIG = 0x9003
_TAG_OFFSET_TIME_ORIG = 0x9011


def _make_exif_jpeg(
    path: Path,
    *,
    dt_orig: str = "2026:09:25 22:15:00",
    offset: str = "+08:00",
    lat: float = 1.3508,
    lng: float = 103.8485,
    size: tuple[int, int] = (200, 200),
) -> bytes:
    """Create a JPEG with DateTimeOriginal, OffsetTimeOriginal, and GPS IFD.

    Returns the raw bytes.
    """
    img = Image.new("RGB", size, (180, 120, 60))

    exif = img.getexif()

    # DateTimeOriginal and OffsetTimeOriginal must be set in the Exif sub-IFD
    # (0x8769) — that is where photo_evidence._extract_timestamp reads them.
    sub_ifd = exif.get_ifd(_EXIF_SUB_IFD)
    sub_ifd[_TAG_DATE_TIME_ORIG] = dt_orig
    sub_ifd[_TAG_OFFSET_TIME_ORIG] = offset

    # GPS IFD
    gps_ifd = exif.get_ifd(ExifBase.GPSInfo)
    gps_ifd[1] = "N"
    gps_ifd[2] = _to_dms_rationals(lat)
    gps_ifd[3] = "E"
    gps_ifd[4] = _to_dms_rationals(lng)

    img.save(path, format="JPEG", exif=exif)
    return path.read_bytes()


def _to_dms_rationals(decimal: float) -> tuple[IFDRational, IFDRational, IFDRational]:
    """Convert decimal degrees to (degrees, minutes, seconds) as IFDRationals."""
    d = int(abs(decimal))
    rem = (abs(decimal) - d) * 60
    m = int(rem)
    s = (rem - m) * 60
    # Use a denominator of 1000 for sub-second precision.
    return (
        IFDRational(d, 1),
        IFDRational(m, 1),
        IFDRational(int(s * 1000), 1000),
    )


def _make_png(path: Path, size: tuple[int, int] = (200, 200)) -> bytes:
    """Create a simple PNG.  Returns the raw bytes."""
    img = Image.new("RGB", size, (60, 180, 120))
    img.save(path, format="PNG")
    return path.read_bytes()


def _make_jpeg_bytes(raw_bytes: bytes) -> bytes:
    """Return raw JPEG bytes (no EXIF) for magic-byte tests."""
    return raw_bytes


def _data_url(mime: str, raw: bytes) -> str:
    """Build a data URL from mime + raw bytes."""
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []
    tmp = tempfile.TemporaryDirectory(prefix="mirra_upload_test_")
    tmp_path = Path(tmp.name)

    try:
        # ===================================================================
        # CHECK a: JPEG data URL with EXIF timestamp + GPS
        # ===================================================================
        print("=" * 70)
        print("CHECK a: JPEG data URL with EXIF -> file saved, bytes identical, url correct")
        print("=" * 70)
        check_a_errors: list[str] = []

        jpeg_path = tmp_path / "a.jpg"
        jpeg_bytes = _make_exif_jpeg(jpeg_path, lat=1.3508, lng=103.8485)
        data_url_a = _data_url("image/jpeg", jpeg_bytes)

        try:
            img_ev, rcp_ev = process_uploaded_evidence(
                "DISP-T01", [data_url_a], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            img_ev = None
            check_a_errors.append(f"unexpected exception: {exc!r}")
            check_a_errors.append(traceback.format_exc())

        if img_ev is not None:
            # File saved
            saved = tmp_path / "DISP-T01" / "IMG-001.jpg"
            if not saved.exists():
                check_a_errors.append("saved file does not exist")
            else:
                if saved.read_bytes() != jpeg_bytes:
                    check_a_errors.append("saved bytes != input bytes")

            # URL
            url = img_ev[0].get("image_url") if img_ev else None
            if url != "/evidence/DISP-T01/IMG-001.jpg":
                check_a_errors.append(f"url: got {url!r}, expected /evidence/DISP-T01/IMG-001.jpg")

            # EXIF fields
            if img_ev:
                ev = img_ev[0]
                if "exif_timestamp" not in ev:
                    check_a_errors.append(f"missing exif_timestamp: {ev}")
                if "exif_gps_location" not in ev:
                    check_a_errors.append(f"missing exif_gps_location: {ev}")
                if "image_hash" not in ev:
                    check_a_errors.append(f"missing image_hash: {ev}")

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - url: {img_ev[0]['image_url']}")
            print(f"  - exif_timestamp: {img_ev[0].get('exif_timestamp')}")
            print(f"  - exif_gps_location: {img_ev[0].get('exif_gps_location')}")
            print(f"  - image_hash: {img_ev[0].get('image_hash')}")

        # ===================================================================
        # CHECK b: PNG data URL
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: PNG data URL -> saved as .png, image_hash present")
        print("=" * 70)
        check_b_errors: list[str] = []

        png_path = tmp_path / "b.png"
        png_bytes = _make_png(png_path)
        data_url_b = _data_url("image/png", png_bytes)

        try:
            img_ev_b, _ = process_uploaded_evidence(
                "DISP-T02", [data_url_b], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            img_ev_b = None
            check_b_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_b is not None:
            saved_b = tmp_path / "DISP-T02" / "IMG-001.png"
            if not saved_b.exists():
                check_b_errors.append("saved .png file does not exist")
            elif saved_b.read_bytes() != png_bytes:
                check_b_errors.append("saved bytes != input bytes")

            if img_ev_b:
                if "image_hash" not in img_ev_b[0]:
                    check_b_errors.append(f"missing image_hash: {img_ev_b[0]}")
                url_b = img_ev_b[0].get("image_url")
                if url_b != "/evidence/DISP-T02/IMG-001.png":
                    check_b_errors.append(f"url: got {url_b!r}, expected .png")

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - url: {img_ev_b[0]['image_url']}")
            print(f"  - image_hash: {img_ev_b[0].get('image_hash')}")

        # ===================================================================
        # CHECK c: receipt data URL + annotation -> ocr_result, uploaded_at
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: receipt data URL + annotation -> ocr_result amount 45, uploaded_at")
        print("=" * 70)
        check_c_errors: list[str] = []

        # Use the JPEG as a receipt image (content doesn't matter for OCR)
        rcp_jpeg = tmp_path / "c_rcpt.jpg"
        rcp_bytes = _make_exif_jpeg(rcp_jpeg)
        data_url_c = _data_url("image/jpeg", rcp_bytes)

        receipt_ann = {
            "DISP-T01/RCP-001": {
                "amount": 45.0,
                "currency": "SGD",
                "merchant_name": "Sparkle Car Care Pte Ltd",
                "receipt_date": "2026-09-26T09:30:00+08:00",
                "ocr_confidence": 0.95,
            }
        }

        try:
            _, rcp_ev_c = process_uploaded_evidence(
                "DISP-T01", [], [data_url_c], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                receipt_annotations=receipt_ann,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            rcp_ev_c = None
            check_c_errors.append(f"unexpected exception: {exc!r}")

        if rcp_ev_c is not None:
            ev = rcp_ev_c[0]
            ocr = ev.get("ocr_result")
            if not isinstance(ocr, dict):
                check_c_errors.append(f"ocr_result missing: {ev}")
            else:
                if ocr.get("amount") != 45.0:
                    check_c_errors.append(f"amount: got {ocr.get('amount')!r}, expected 45.0")
            if ev.get("uploaded_at") != "2026-09-26T10:00:00+08:00":
                check_c_errors.append(
                    f"uploaded_at: got {ev.get('uploaded_at')!r}, expected filed_at"
                )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - ocr_result amount: {rcp_ev_c[0]['ocr_result']['amount']}")
            print(f"  - uploaded_at: {rcp_ev_c[0]['uploaded_at']}")

        # ===================================================================
        # CHECK d: photo_annotations keyed "IMG-001" (no case prefix) -> NOT applied
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK d: photo_annotations keyed 'IMG-001' (no case prefix) -> NOT applied")
        print("=" * 70)
        check_d_errors: list[str] = []

        jpeg_d = tmp_path / "d.jpg"
        jpeg_bytes_d = _make_exif_jpeg(jpeg_d)
        data_url_d = _data_url("image/jpeg", jpeg_bytes_d)

        # Annotation keyed by "IMG-001" only (no case_id prefix)
        wrong_ann = {
            "IMG-001": {
                "stain_damage_classification": "LIQUID_SPILL",
                "damage_severity": "MODERATE",
                "is_ai_generated": False,
                "ai_generated_confidence": 0.05,
            }
        }

        try:
            img_ev_d, _ = process_uploaded_evidence(
                "DISP-T03", [data_url_d], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                photo_annotations=wrong_ann,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            img_ev_d = None
            check_d_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_d is not None:
            ev = img_ev_d[0]
            # provider_result should NOT be present (annotation not found,
            # no AI hint in this plain JPEG)
            if "provider_result" in ev:
                check_d_errors.append(
                    f"provider_result should be absent (annotation not applied), got: {ev['provider_result']}"
                )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print(f"  - provider_result absent: {'provider_result' not in img_ev_d[0]}")

        # ===================================================================
        # CHECK e: mime image/gif -> EvidenceUploadError
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK e: mime image/gif -> EvidenceUploadError")
        print("=" * 70)
        check_e_errors: list[str] = []

        try:
            process_uploaded_evidence(
                "DISP-T04", ["data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
            check_e_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            pass
        except Exception as exc:
            check_e_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print("  - EvidenceUploadError raised correctly")

        # ===================================================================
        # CHECK f: invalid base64 -> EvidenceUploadError
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK f: invalid base64 -> EvidenceUploadError")
        print("=" * 70)
        check_f_errors: list[str] = []

        try:
            process_uploaded_evidence(
                "DISP-T05", ["data:image/jpeg;base64,!!!not-valid-b64!!!"], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
            check_f_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            pass
        except Exception as exc:
            check_f_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print("  - EvidenceUploadError raised correctly")

        # ===================================================================
        # CHECK g: too big (monkeypatch MAX_UPLOAD_BYTES small)
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK g: too big (monkeypatch MAX_UPLOAD_BYTES small) -> EvidenceUploadError")
        print("=" * 70)
        check_g_errors: list[str] = []

        import backend.shared.evidence_upload as eu_mod  # noqa: E402

        big_jpeg = tmp_path / "g.jpg"
        big_bytes = _make_exif_jpeg(big_jpeg)
        # Pad to be larger than the small limit
        big_bytes = big_bytes + b"\x00" * 500

        # But wait — the padded bytes won't match magic bytes after JPEG start...
        # Actually the JPEG starts with FF D8 FF, so the prefix is fine.
        # But Pillow won't be able to open padded bytes. That's ok for the
        # size check — it should fail on size before trying to open.

        original_max = eu_mod.MAX_UPLOAD_BYTES
        eu_mod.MAX_UPLOAD_BYTES = 100  # very small
        try:
            try:
                process_uploaded_evidence(
                    "DISP-T06", [_data_url("image/jpeg", big_bytes)], [], "2026-09-26T10:00:00+08:00",
                    uploads_dir=tmp_path,
                    use_vision=False,
                    register_hashes=False,
                )
                check_g_errors.append("expected EvidenceUploadError, got no exception")
            except EvidenceUploadError:
                pass
            except Exception as exc:
                check_g_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")
        finally:
            eu_mod.MAX_UPLOAD_BYTES = original_max

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print("  - EvidenceUploadError raised correctly")

        # ===================================================================
        # CHECK h: mime image/jpeg but PNG bytes -> EvidenceUploadError
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK h: mime image/jpeg but PNG bytes -> EvidenceUploadError")
        print("=" * 70)
        check_h_errors: list[str] = []

        png_bytes_h = _make_png(tmp_path / "h.png")
        mismatched_url = _data_url("image/jpeg", png_bytes_h)

        try:
            process_uploaded_evidence(
                "DISP-T07", [mismatched_url], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
            check_h_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            pass
        except Exception as exc:
            check_h_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print("  - EvidenceUploadError raised correctly")

        # ===================================================================
        # CHECK i: plain URL string and dict entries -> passed through, no files
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK i: plain URL and dict entries -> passed through, no files written")
        print("=" * 70)
        check_i_errors: list[str] = []

        try:
            img_ev_i, rcp_ev_i = process_uploaded_evidence(
                "DISP-T08",
                ["https://example.com/photo1.jpg", {"image_url": "https://example.com/photo2.jpg"}],
                ["https://example.com/rcpt1.jpg", {"receipt_url": "https://example.com/rcpt2.jpg"}],
                "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            img_ev_i = None
            rcp_ev_i = None
            check_i_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_i is not None:
            # Check IDs
            if img_ev_i[0].get("image_id") != "IMG-001":
                check_i_errors.append(f"img 0 id: got {img_ev_i[0].get('image_id')!r}, expected IMG-001")
            if img_ev_i[1].get("image_id") != "IMG-002":
                check_i_errors.append(f"img 1 id: got {img_ev_i[1].get('image_id')!r}, expected IMG-002")
            if img_ev_i[0].get("image_url") != "https://example.com/photo1.jpg":
                check_i_errors.append(f"img 0 url: got {img_ev_i[0].get('image_url')!r}")
            if img_ev_i[1].get("image_url") != "https://example.com/photo2.jpg":
                check_i_errors.append(f"img 1 url: got {img_ev_i[1].get('image_url')!r}")

            if rcp_ev_i[0].get("receipt_id") != "RCP-001":
                check_i_errors.append(f"rcp 0 id: got {rcp_ev_i[0].get('receipt_id')!r}, expected RCP-001")
            if rcp_ev_i[1].get("receipt_id") != "RCP-002":
                check_i_errors.append(f"rcp 1 id: got {rcp_ev_i[1].get('receipt_id')!r}, expected RCP-002")
            if rcp_ev_i[0].get("uploaded_at") != "2026-09-26T10:00:00+08:00":
                check_i_errors.append(f"rcp 0 uploaded_at: got {rcp_ev_i[0].get('uploaded_at')!r}")

            # No case dir should exist (no data URLs → no files)
            case_dir_i = tmp_path / "DISP-T08"
            if case_dir_i.exists():
                check_i_errors.append("case dir should not exist (no files written)")

        if check_i_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_i_errors:
                print(f"  - {e}")
            errors.extend(check_i_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print(f"  - img IDs: {[e['image_id'] for e in img_ev_i]}")
            print(f"  - rcp IDs: {[e['receipt_id'] for e in rcp_ev_i]}")
            print(f"  - no case dir: {not (tmp_path / 'DISP-T08').exists()}")

        # ===================================================================
        # CHECK j: second item invalid -> error raised AND case dir deleted
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK j: second item invalid -> error raised AND case dir deleted")
        print("=" * 70)
        check_j_errors: list[str] = []

        jpeg_j = tmp_path / "j.jpg"
        jpeg_bytes_j = _make_exif_jpeg(jpeg_j)
        valid_url = _data_url("image/jpeg", jpeg_bytes_j)
        # Second item: JPEG declared but PNG bytes
        png_bytes_j = _make_png(tmp_path / "j2.png")
        invalid_url = _data_url("image/jpeg", png_bytes_j)

        try:
            process_uploaded_evidence(
                "DISP-T09", [valid_url, invalid_url], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
            check_j_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            # Check that the case dir was cleaned up
            case_dir_j = tmp_path / "DISP-T09"
            if case_dir_j.exists():
                check_j_errors.append(f"case dir should not exist after failure")
        except Exception as exc:
            check_j_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        if check_j_errors:
            print("\nCHECK j RESULT: FAIL")
            for e in check_j_errors:
                print(f"  - {e}")
            errors.extend(check_j_errors)
        else:
            print("\nCHECK j RESULT: PASS")
            print("  - error raised and case dir cleaned up")

        # ===================================================================
        # CHECK k: case_id "../x" -> EvidenceUploadError
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK k: case_id '../x' -> EvidenceUploadError")
        print("=" * 70)
        check_k_errors: list[str] = []

        try:
            process_uploaded_evidence(
                "../x", [], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=False,
            )
            check_k_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            pass
        except Exception as exc:
            check_k_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        if check_k_errors:
            print("\nCHECK k RESULT: FAIL")
            for e in check_k_errors:
                print(f"  - {e}")
            errors.extend(check_k_errors)
        else:
            print("\nCHECK k RESULT: PASS")
            print("  - EvidenceUploadError raised correctly")

        # ===================================================================
        # CHECK l: two images -> IMG-001 and IMG-002, schema validation
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK l: two images + two receipts -> schema validation")
        print("=" * 70)
        check_l_errors: list[str] = []

        jpeg_l1 = tmp_path / "l1.jpg"
        jpeg_l2 = tmp_path / "l2.jpg"
        jpeg_bytes_l1 = _make_exif_jpeg(jpeg_l1, lat=1.3508, lng=103.8485)
        jpeg_bytes_l2 = _make_exif_jpeg(jpeg_l2, lat=1.3510, lng=103.8490)

        rcp_jpeg_l1 = tmp_path / "l_r1.jpg"
        rcp_jpeg_l2 = tmp_path / "l_r2.jpg"
        rcp_bytes_l1 = _make_exif_jpeg(rcp_jpeg_l1)
        rcp_bytes_l2 = _make_exif_jpeg(rcp_jpeg_l2)

        receipt_ann_l = {
            "DISP-T10/RCP-001": {
                "amount": 45.0,
                "currency": "SGD",
                "merchant_name": "Sparkle Car Care",
                "receipt_date": "2026-09-26T09:30:00+08:00",
                "ocr_confidence": 0.95,
            },
            "DISP-T10/RCP-002": {
                "amount": 30.0,
                "currency": "SGD",
                "merchant_name": "Wash & Go",
                "receipt_date": "2026-09-26T10:00:00+08:00",
                "ocr_confidence": 0.88,
            },
        }

        try:
            img_ev_l, rcp_ev_l = process_uploaded_evidence(
                "DISP-T10",
                [_data_url("image/jpeg", jpeg_bytes_l1), _data_url("image/jpeg", jpeg_bytes_l2)],
                [_data_url("image/jpeg", rcp_bytes_l1), _data_url("image/jpeg", rcp_bytes_l2)],
                "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                receipt_annotations=receipt_ann_l,
                use_vision=False,
                register_hashes=False,
            )
        except Exception as exc:
            img_ev_l = None
            rcp_ev_l = None
            check_l_errors.append(f"unexpected exception: {exc!r}")
            check_l_errors.append(traceback.format_exc())

        if img_ev_l is not None:
            # IDs
            if img_ev_l[0].get("image_id") != "IMG-001":
                check_l_errors.append(f"img 0 id: {img_ev_l[0].get('image_id')!r}")
            if img_ev_l[1].get("image_id") != "IMG-002":
                check_l_errors.append(f"img 1 id: {img_ev_l[1].get('image_id')!r}")

            # Schema validation
            for i, ev in enumerate(img_ev_l):
                val_errs = _validate_image_evidence(ev)
                if val_errs:
                    check_l_errors.append(f"img {i} schema: {val_errs}")

        if rcp_ev_l is not None:
            if rcp_ev_l[0].get("receipt_id") != "RCP-001":
                check_l_errors.append(f"rcp 0 id: {rcp_ev_l[0].get('receipt_id')!r}")
            if rcp_ev_l[1].get("receipt_id") != "RCP-002":
                check_l_errors.append(f"rcp 1 id: {rcp_ev_l[1].get('receipt_id')!r}")

            for i, ev in enumerate(rcp_ev_l):
                val_errs = _validate_receipt_evidence(ev)
                if val_errs:
                    check_l_errors.append(f"rcp {i} schema: {val_errs}")

        if check_l_errors:
            print("\nCHECK l RESULT: FAIL")
            for e in check_l_errors:
                print(f"  - {e}")
            errors.extend(check_l_errors)
        else:
            print("\nCHECK l RESULT: PASS")
            print(f"  - img IDs: {[e['image_id'] for e in img_ev_l]}")
            print(f"  - rcp IDs: {[e['receipt_id'] for e in rcp_ev_l]}")
            print(f"  - all validated against schema")

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
        tmp.cleanup()


if __name__ == "__main__":
    main()
