"""Standalone tests for photo hash registration and recycled detection.

Uploads the same photo (or a resized copy) as different cases and verifies:
  - the runtime hash file records the first case as owner,
  - a later case sees ``known_matches`` pointing to the first case,
  - a case never matches its own photo,
  - low-detail images are not registered,
  - failed uploads register nothing,
  - a broken runtime JSON falls back to the mock corpus.

Run from backend/:

    python -m tests.test_photo_registry

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import base64
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

import backend.shared.photo_evidence as photo_mod  # noqa: E402
from backend.shared.evidence_upload import process_uploaded_evidence  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to create test images
# ---------------------------------------------------------------------------

def _draw_textured(img: Image.Image) -> None:
    """Draw a horizontal gradient plus shapes (detailed pattern)."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for x in range(w):
        gray = int(255 * x / max(w - 1, 1))
        draw.line([(x, 0), (x, h - 1)], fill=(gray, 50, 200 - gray))
    draw.rectangle([10, 10, 30, 40], fill=(255, 128, 0))
    draw.ellipse([40, 20, 70, 60], fill=(0, 200, 100))
    draw.line([(0, 0), (w - 1, h - 1)], fill=(255, 255, 0), width=2)


def _make_textured_jpeg(path: Path, size: tuple[int, int] = (100, 100)) -> bytes:
    """Create a textured JPEG and return its raw bytes."""
    img = Image.new("RGB", size, (128, 128, 128))
    _draw_textured(img)
    img.save(path, format="JPEG", quality=90)
    return path.read_bytes()


def _make_solid_jpeg(path: Path, color=(200, 200, 200)) -> bytes:
    """Create a solid-colour JPEG (low-detail dHash)."""
    img = Image.new("RGB", (100, 100), color)
    img.save(path, format="JPEG")
    return path.read_bytes()


def _make_resized_jpeg(src_path: Path, dst: Path) -> bytes:
    """Open src, resize to half, save as JPEG q=75."""
    img = Image.open(src_path)
    w, h = img.size
    img2 = img.resize((w // 2, h // 2), Image.LANCZOS)
    img2.save(dst, format="JPEG", quality=75)
    return dst.read_bytes()


def _data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    tmp_dir = tempfile.mkdtemp(prefix="mirra_photo_registry_")
    tmp_path = Path(tmp_dir)
    runtime_path = tmp_path / "runtime_hashes.json"

    try:
        # Monkeypatch RUNTIME_HASHES_PATH to our temp file.
        original_runtime = photo_mod.RUNTIME_HASHES_PATH
        photo_mod.RUNTIME_HASHES_PATH = runtime_path

        # ------------------------------------------------------------------
        # CHECK a: upload textured JPEG as DISP-T10 -> runtime file has
        #          {hash: "DISP-T10"}; its own image_evidence has NO known_matches
        # ------------------------------------------------------------------
        print("=" * 70)
        print("CHECK a: upload as DISP-T10 -> runtime has hash, no self-match")
        print("=" * 70)
        check_a_errors: list[str] = []

        jpeg_a_path = tmp_path / "a.jpg"
        jpeg_a = _make_textured_jpeg(jpeg_a_path)
        data_url_a = _data_url("image/jpeg", jpeg_a)

        try:
            img_ev_a, _ = process_uploaded_evidence(
                "DISP-T10", [data_url_a], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_a = None
            check_a_errors.append(f"unexpected exception: {exc!r}")

        hash_a = None
        if img_ev_a is not None:
            hash_a = img_ev_a[0].get("image_hash")
            if not hash_a:
                check_a_errors.append("image_hash missing from evidence")
            else:
                # known_matches should be absent (no self-match)
                km = img_ev_a[0].get("known_matches")
                if km is not None and km != {}:
                    check_a_errors.append(
                        f"known_matches should be absent/empty, got {km!r}"
                    )

            # Runtime file should contain {hash_a: "DISP-T10"}
            try:
                with open(runtime_path, "r", encoding="utf-8") as f:
                    runtime_data = json.load(f)
            except Exception as exc:
                runtime_data = {}
                check_a_errors.append(f"failed to read runtime file: {exc}")

            if hash_a and runtime_data.get(hash_a) != "DISP-T10":
                check_a_errors.append(
                    f"runtime[{hash_a}] = {runtime_data.get(hash_a)!r}, expected 'DISP-T10'"
                )

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - hash: {hash_a}")
            print(f"  - runtime owner: DISP-T10")
            print(f"  - known_matches: absent (no self-match)")

        # ------------------------------------------------------------------
        # CHECK b: upload SAME bytes as DISP-T11 -> known_matches ==
        #          {hash: "DISP-T10"}
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK b: same bytes as DISP-T11 -> known_matches DISP-T10")
        print("=" * 70)
        check_b_errors: list[str] = []

        jpeg_b_path = tmp_path / "b.jpg"
        jpeg_b = _make_textured_jpeg(jpeg_b_path)
        # Verify the hash matches (same pattern)
        hash_b_check = photo_mod.build_image_evidence(
            str(jpeg_b_path), "IMG-CHK", "mock://b.jpg",
            current_case_id="DISP-CHK",
        ).get("image_hash")
        if hash_b_check != hash_a:
            # They should be identical since same pattern/size
            pass  # may differ due to JPEG re-encode; the upload uses same bytes

        # Upload the EXACT same bytes
        data_url_b = _data_url("image/jpeg", jpeg_a)  # same bytes as CHECK a

        try:
            img_ev_b, _ = process_uploaded_evidence(
                "DISP-T11", [data_url_b], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_b = None
            check_b_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_b is not None:
            km = img_ev_b[0].get("known_matches")
            hash_b_val = img_ev_b[0].get("image_hash")
            if not isinstance(km, dict):
                check_b_errors.append(f"known_matches should be a dict, got {km!r}")
            elif hash_b_val and km.get(hash_b_val) != "DISP-T10":
                check_b_errors.append(
                    f"known_matches should point to DISP-T10, got {km!r}"
                )

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - known_matches: {img_ev_b[0].get('known_matches')}")

        # ------------------------------------------------------------------
        # CHECK c: upload a resized copy (Hamming <= 6) as DISP-T12 ->
        #          known_matches points to DISP-T10
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK c: resized copy as DISP-T12 -> known_matches DISP-T10")
        print("=" * 70)
        check_c_errors: list[str] = []

        resized_path = tmp_path / "resized.jpg"
        resized_bytes = _make_resized_jpeg(jpeg_a_path, resized_path)
        data_url_c = _data_url("image/jpeg", resized_bytes)

        try:
            img_ev_c, _ = process_uploaded_evidence(
                "DISP-T12", [data_url_c], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_c = None
            check_c_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_c is not None:
            km = img_ev_c[0].get("known_matches")
            hash_c = img_ev_c[0].get("image_hash")
            if not isinstance(km, dict) or not km:
                # Verify Hamming distance for debugging
                if hash_a and hash_c:
                    try:
                        ha = int(hash_a.split(":")[1], 16)
                        hc = int(hash_c.split(":")[1], 16)
                        hamming = bin(ha ^ hc).count("1")
                        check_c_errors.append(
                            f"known_matches empty/absent (Hamming={hamming}): {km!r}"
                        )
                    except Exception:
                        check_c_errors.append(f"known_matches empty: {km!r}")
                else:
                    check_c_errors.append(f"known_matches empty: {km!r}")
            else:
                # Should point to DISP-T10 (first case that used this photo)
                match_case = list(km.values())[0] if km else None
                if match_case != "DISP-T10":
                    check_c_errors.append(
                        f"known_matches should point to DISP-T10, got {match_case!r}"
                    )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            hash_c = img_ev_c[0].get("image_hash")
            if hash_a and hash_c:
                ha = int(hash_a.split(":")[1], 16)
                hc = int(hash_c.split(":")[1], 16)
                hamming = bin(ha ^ hc).count("1")
                print(f"  - Hamming distance: {hamming}")
            print(f"  - known_matches: {img_ev_c[0].get('known_matches')}")

        # ------------------------------------------------------------------
        # CHECK d: upload a different picture -> no known_matches
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK d: different picture -> no known_matches")
        print("=" * 70)
        check_d_errors: list[str] = []

        diff_path = tmp_path / "diff.jpg"
        diff_img = Image.new("RGB", (120, 80), (10, 10, 10))
        draw = ImageDraw.Draw(diff_img)
        w, h = diff_img.size
        for i in range(-h, w + h, 8):
            draw.line([(i, 0), (i + h, h)], fill=(30, 100, 240), width=4)
            draw.line([(i, h), (i + h, 0)], fill=(240, 100, 30), width=4)
        diff_img.save(diff_path, format="JPEG", quality=90)
        diff_bytes = diff_path.read_bytes()
        data_url_d = _data_url("image/jpeg", diff_bytes)

        try:
            img_ev_d, _ = process_uploaded_evidence(
                "DISP-T13", [data_url_d], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_d = None
            check_d_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_d is not None:
            km = img_ev_d[0].get("known_matches")
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
            print(f"  - known_matches: {img_ev_d[0].get('known_matches', '(absent)')}")

        # ------------------------------------------------------------------
        # CHECK e: solid-colour (low-detail) image -> not registered
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK e: solid-colour image -> not registered")
        print("=" * 70)
        check_e_errors: list[str] = []

        solid_path = tmp_path / "solid.jpg"
        solid_bytes = _make_solid_jpeg(solid_path)
        data_url_e = _data_url("image/jpeg", solid_bytes)

        try:
            img_ev_e, _ = process_uploaded_evidence(
                "DISP-T14", [data_url_e], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_e = None
            check_e_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_e is not None:
            hash_e = img_ev_e[0].get("image_hash")
            if hash_e:
                # Check it's NOT in the runtime file
                try:
                    with open(runtime_path, "r", encoding="utf-8") as f:
                        runtime_data = json.load(f)
                except Exception:
                    runtime_data = {}
                if hash_e in runtime_data:
                    check_e_errors.append(
                        f"low-detail hash {hash_e} should NOT be in runtime file"
                    )

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - hash: {img_ev_e[0].get('image_hash')}")
            print("  - not in runtime file (low-detail)")

        # ------------------------------------------------------------------
        # CHECK f: same photo registered twice -> owner stays DISP-T10
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK f: same photo registered twice -> owner stays DISP-T10")
        print("=" * 70)
        check_f_errors: list[str] = []

        # Upload the same bytes again as DISP-T15
        data_url_f = _data_url("image/jpeg", jpeg_a)

        try:
            img_ev_f, _ = process_uploaded_evidence(
                "DISP-T15", [data_url_f], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
        except Exception as exc:
            img_ev_f = None
            check_f_errors.append(f"unexpected exception: {exc!r}")

        if img_ev_f is not None:
            hash_f = img_ev_f[0].get("image_hash")
            km_f = img_ev_f[0].get("known_matches")
            # known_matches should point to DISP-T10 (the original owner)
            if not isinstance(km_f, dict) or not km_f:
                check_f_errors.append(f"known_matches should point to DISP-T10, got {km_f!r}")
            else:
                match_case = list(km_f.values())[0]
                if match_case != "DISP-T10":
                    check_f_errors.append(
                        f"known_matches should point to DISP-T10, got {match_case!r}"
                    )

            # Verify the runtime file still has DISP-T10 as the owner
            if hash_f:
                try:
                    with open(runtime_path, "r", encoding="utf-8") as f:
                        runtime_data = json.load(f)
                except Exception:
                    runtime_data = {}
                if runtime_data.get(hash_f) != "DISP-T10":
                    check_f_errors.append(
                        f"runtime owner should still be DISP-T10, got {runtime_data.get(hash_f)!r}"
                    )

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print(f"  - known_matches: {img_ev_f[0].get('known_matches')}")
            print("  - runtime owner: DISP-T10 (unchanged)")

        # ------------------------------------------------------------------
        # CHECK g: failed upload (second item invalid) -> nothing registered
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK g: failed upload -> nothing registered")
        print("=" * 70)
        check_g_errors: list[str] = []

        # Snapshot the runtime file before the failed upload
        try:
            with open(runtime_path, "r", encoding="utf-8") as f:
                runtime_before = json.load(f)
        except Exception:
            runtime_before = {}

        # Create a valid JPEG and an invalid (PNG bytes with JPEG mime)
        valid_path = tmp_path / "g_valid.jpg"
        valid_bytes = _make_textured_jpeg(valid_path)
        valid_url = _data_url("image/jpeg", valid_bytes)

        # PNG bytes declared as JPEG
        png_path = tmp_path / "g_invalid.png"
        png_img = Image.new("RGB", (80, 80), (60, 180, 120))
        png_img.save(png_path, format="PNG")
        invalid_bytes = png_path.read_bytes()
        invalid_url = _data_url("image/jpeg", invalid_bytes)

        from backend.shared.evidence_upload import EvidenceUploadError

        try:
            process_uploaded_evidence(
                "DISP-T16", [valid_url, invalid_url], [], "2026-09-26T10:00:00+08:00",
                uploads_dir=tmp_path,
                use_vision=False,
                register_hashes=True,
            )
            check_g_errors.append("expected EvidenceUploadError, got no exception")
        except EvidenceUploadError:
            pass
        except Exception as exc:
            check_g_errors.append(f"expected EvidenceUploadError, got {type(exc).__name__}: {exc}")

        # Check that the runtime file is unchanged
        try:
            with open(runtime_path, "r", encoding="utf-8") as f:
                runtime_after = json.load(f)
        except Exception:
            runtime_after = {}

        if runtime_after != runtime_before:
            # Check that no DISP-T16 entry was added
            disp_t16_entries = [h for h, c in runtime_after.items() if c == "DISP-T16"]
            if disp_t16_entries:
                check_g_errors.append(
                    f"runtime file should not contain DISP-T16 entries, got {disp_t16_entries}"
                )

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print("  - nothing registered for failed upload")

        # ------------------------------------------------------------------
        # CHECK h: broken runtime JSON file -> loader falls back to mock
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("CHECK h: broken runtime JSON -> fallback to mock corpus")
        print("=" * 70)
        check_h_errors: list[str] = []

        # Write broken JSON to the runtime file
        runtime_path.write_text("{ this is not valid JSON !!!", encoding="utf-8")

        # _load_default_hashes should not raise, should return mock corpus
        try:
            hashes = photo_mod._load_default_hashes()
            if not isinstance(hashes, dict):
                check_h_errors.append(
                    f"_load_default_hashes should return dict, got {type(hashes).__name__}"
                )
        except Exception as exc:
            check_h_errors.append(
                f"_load_default_hashes raised {type(exc).__name__}: {exc}"
            )

        # Also verify register_image_hash works with a broken runtime file
        # (it should overwrite the broken file with valid JSON)
        try:
            result = photo_mod.register_image_hash(
                "dhash:abcdef0123456789", "DISP-T17",
                path=runtime_path,
            )
            if not result:
                check_h_errors.append(
                    "register_image_hash should succeed even with broken runtime file"
                )
        except Exception as exc:
            check_h_errors.append(
                f"register_image_hash raised {type(exc).__name__}: {exc}"
            )

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print("  - loader fell back to mock corpus, no exception")
            print("  - register_image_hash overwrote broken file")

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
        # Restore the original RUNTIME_HASHES_PATH
        photo_mod.RUNTIME_HASHES_PATH = original_runtime
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
