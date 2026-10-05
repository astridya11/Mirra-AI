"""Photo → ImageEvidence upload adapter.

This module is the **upload → data** step: it reads an image file from disk
and returns an ``ImageEvidenceInput`` dict (schema-defined in
``shared/schemas.json``) ready for the orchestrator's ``data_sources.image_evidence``
list.

What it does (Pillow only, no external services):
  1. **EXIF extraction** — ``DateTimeOriginal`` (fallback ``DateTime``) with
     ``OffsetTimeOriginal`` if present (else assume +08:00), output as ISO 8601
     with offset that ``datetime.fromisoformat`` can parse.  GPS coordinates
     from the GPS IFD are converted to signed decimal degrees (6 decimal places).
  2. **Perceptual hash** — a 64-bit dHash (grayscale, resize 9×8, compare
     adjacent pixels) stored as ``"dhash:<16 hex chars>"``.  ``known_matches``
     compares against a corpus by Hamming distance (≤ 6 → match).
  3. **AI-generation hint** — scans the EXIF ``Software`` tag and raw file
     bytes for known generator names (Midjourney, DALL·E, Stable Diffusion,
     etc.).  When detected, ``provider_result.is_ai_generated = true`` with
     confidence ``0.9``.

Vision content (stain classification, damage severity) comes from the
annotation file (``backend/mock_evidence/photo_annotations.json``) — a
stand-in for a real vision model — until a vision provider is chosen.
"""

from __future__ import annotations

import io
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from PIL import Image

from backend.shared.vision_client import call_vision_json

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_TZ_OFFSET = "+08:00"

_HASH_DISTANCE_THRESHOLD = 6

# Reject dHashes with fewer than 8 or more than 56 of 64 bits set —
# near-blank or near-full images produce degenerate hashes that cause
# false "recycled" findings.
_MIN_HASH_BITS = 8
_MAX_HASH_BITS = 56

# Known AI-image generator names / markers.  Short list, single constant.
_AI_GENERATOR_MARKERS = (
    "midjourney",
    "dall-e",
    "dall·e",
    "dalle",
    "stable diffusion",
    "firefly",
    "imagen",
)

# Directory of this module — used for default corpus/annotation paths.
_THIS_DIR = Path(__file__).resolve().parent  # backend/shared/
_BACKEND_DIR = _THIS_DIR.parent  # backend/
_MOCK_EVIDENCE_DIR = _BACKEND_DIR / "mock_evidence"
_DEFAULT_HASHES_PATH = _MOCK_EVIDENCE_DIR / "known_image_hashes.json"
_DEFAULT_ANNOTATIONS_PATH = _MOCK_EVIDENCE_DIR / "photo_annotations.json"

# ---------------------------------------------------------------------------
# Stain / severity validation (mirrors image_analysis._parse_provider_result)
# ---------------------------------------------------------------------------

_STAIN_CLASSIFICATIONS = frozenset({
    "LIQUID_SPILL", "VOMIT", "FOOD_RESIDUE",
    "PHYSICAL_DAMAGE", "DIRT_MUD", "NO_DAMAGE_DETECTED", "OTHER",
})
_DAMAGE_SEVERITIES = frozenset({"MINOR", "MODERATE", "SEVERE"})


def _is_strict_bool(value: Any) -> bool:
    return type(value) is bool


def _is_valid_confidence(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(f):
        return False
    return 0.0 <= f <= 1.0


def _is_valid_classification(value: Any) -> bool:
    return isinstance(value, str) and value in _STAIN_CLASSIFICATIONS


def _is_valid_severity(value: Any) -> bool:
    return isinstance(value, str) and value in _DAMAGE_SEVERITIES


# ---------------------------------------------------------------------------
# JSON loading helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    """Load a JSON object from *path*.  Returns {} on any error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _load_default_hashes() -> dict:
    return _load_json(_DEFAULT_HASHES_PATH)


def _load_default_annotations() -> dict:
    return _load_json(_DEFAULT_ANNOTATIONS_PATH)


# ---------------------------------------------------------------------------
# EXIF helpers
# ---------------------------------------------------------------------------

# EXIF tag IDs (kept as constants for clarity).
_TAG_SOFTWARE = 0x0131      # IFD0 — top level
_TAG_GPS_IFD = 0x8825       # pointer to GPS IFD
_EXIF_SUB_IFD = 0x8769      # pointer to Exif sub-IFD
_TAG_DATE_TIME_ORIG = 0x9003   # Exif sub-IFD
_TAG_OFFSET_TIME_ORIG = 0x9011  # Exif sub-IFD
_TAG_DATE_TIME = 0x0132        # Exif sub-IFD (also in IFD0 on some cameras)
_GPS_LAT_REF = 1
_GPS_LAT = 2
_GPS_LNG_REF = 3
_GPS_LNG = 4


def _get_raw_exif(img: Image.Image) -> Any:
    """Return the ``Image.Exif`` object from *img*, or None on error."""
    try:
        return img.getexif()
    except Exception:
        return None


def _parse_tz_offset(offset: str) -> timezone | None:
    """Parse "+08:00" / "-05:30" → timezone.  Returns None on failure."""
    try:
        sign = 1 if offset[0] == "+" else -1
        parts = offset[1:].split(":")
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
        return timezone(sign * timedelta(hours=hours, minutes=minutes))
    except Exception:
        return None


def _format_exif_timestamp(
    dt_str: str, offset: str | None
) -> str | None:
    """Convert "2026:09:25 22:20:00" + "+08:00" → ISO 8601.

    Parses with ``datetime.strptime``, attaches the offset as a timezone,
    and returns ``datetime.isoformat()`` (e.g. "2026-09-25T22:20:00+08:00").
    Returns None if *dt_str* or *offset* cannot be parsed.
    """
    try:
        dt = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None

    tz: timezone | None = None
    if offset:
        tz = _parse_tz_offset(offset)
    if tz is None:
        tz = _parse_tz_offset(_DEFAULT_TZ_OFFSET)
    if tz is None:
        return None

    return dt.replace(tzinfo=tz).isoformat()


def _parse_dms(value: Any) -> tuple[float, float, float] | None:
    """Parse EXIF GPS degrees/minutes/seconds (a tuple of rationals)."""
    try:
        if isinstance(value, (list, tuple)) and len(value) == 3:
            parts = []
            for part in value:
                if isinstance(part, (int, float)):
                    parts.append(float(part))
                elif isinstance(part, tuple) and len(part) == 2:
                    num, den = part
                    parts.append(float(num) / float(den) if den else 0.0)
                else:
                    # Pillow IFDRational or other — best-effort float conversion.
                    try:
                        parts.append(float(part))
                    except Exception:
                        return None
            return (parts[0], parts[1], parts[2])
    except Exception:
        pass
    return None


def _dms_to_decimal(dms: tuple[float, float, float], ref: str) -> float | None:
    """Convert (degrees, minutes, seconds) + N/S/E/W to signed decimal."""
    degrees, minutes, seconds = dms
    decimal = abs(degrees) + minutes / 60.0 + seconds / 3600.0
    if ref and ref.upper() in ("S", "W"):
        decimal = -decimal
    return round(decimal, 6)


def _extract_timestamp(exif_obj: Any) -> tuple[str | None, str | None]:
    """Return (DateTimeOriginal | DateTime, OffsetTimeOriginal) from the Exif sub-IFD.

    Falls back to top-level DateTime if the sub-IFD is missing.
    """
    dt_str: str | None = None
    offset: str | None = None

    # Exif sub-IFD (0x8769) — where DateTimeOriginal / OffsetTimeOriginal live.
    sub_ifd: dict[int, Any] = {}
    try:
        sub_ifd = exif_obj.get_ifd(_EXIF_SUB_IFD)
    except Exception:
        sub_ifd = {}

    if isinstance(sub_ifd, dict):
        val = sub_ifd.get(_TAG_DATE_TIME_ORIG)
        if val is None:
            val = sub_ifd.get(_TAG_DATE_TIME)
        if isinstance(val, str):
            dt_str = val
        off = sub_ifd.get(_TAG_OFFSET_TIME_ORIG)
        if isinstance(off, str):
            offset = off

    # Fallback: top-level DateTime (some cameras put it in IFD0).
    if dt_str is None:
        try:
            top_dt = exif_obj.get(_TAG_DATE_TIME)
            if isinstance(top_dt, str):
                dt_str = top_dt
        except Exception:
            pass

    return dt_str, offset


def _extract_gps(exif_obj: Any) -> dict[str, float] | None:
    """Extract and convert GPS IFD to {latitude, longitude}."""
    gps_ifd: dict[int, Any] = {}
    try:
        gps_ifd = exif_obj.get_ifd(_TAG_GPS_IFD)
    except Exception:
        gps_ifd = {}

    if not isinstance(gps_ifd, dict) or not gps_ifd:
        return None

    lat_dms = _parse_dms(gps_ifd.get(_GPS_LAT))
    lat_ref = gps_ifd.get(_GPS_LAT_REF)
    lng_dms = _parse_dms(gps_ifd.get(_GPS_LNG))
    lng_ref = gps_ifd.get(_GPS_LNG_REF)

    if lat_dms is None or lng_dms is None:
        return None

    lat = _dms_to_decimal(lat_dms, lat_ref or "N")
    lng = _dms_to_decimal(lng_dms, lng_ref or "E")
    if lat is None or lng is None:
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return None
    return {"latitude": lat, "longitude": lng}


# ---------------------------------------------------------------------------
# Perceptual hash (dHash)
# ---------------------------------------------------------------------------

def _compute_dhash(img: Image.Image) -> str | None:
    """Compute a 64-bit dHash and return it as "dhash:<16 hex chars>".

    Grayscale → resize to 9×8 → compare each adjacent horizontal pair → 64 bits.
    """
    try:
        small = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
        pixels = list(small.getdata())
        if len(pixels) != 72:
            return None
        bits = 0
        for row in range(8):
            for col in range(8):
                left = pixels[row * 9 + col]
                right = pixels[row * 9 + col + 1]
                if left > right:
                    bits |= 1 << (row * 8 + col)
        return f"dhash:{bits:016x}"
    except Exception:
        return None


def _hamming_distance(hash_a: str, hash_b: str) -> int | None:
    """Hamming distance between two "dhash:<hex>" strings.  None on error."""
    try:
        ha = int(hash_a.split(":", 1)[1], 16)
        hb = int(hash_b.split(":", 1)[1], 16)
        return bin(ha ^ hb).count("1")
    except Exception:
        return None


def _popcount(hash_str: str) -> int | None:
    """Number of bits set in a "dhash:<hex>" string.  None on error."""
    try:
        val = int(hash_str.split(":", 1)[1], 16)
        return bin(val).count("1")
    except Exception:
        return None


def _find_known_match(
    this_hash: str, known_hashes: dict[str, str]
) -> dict[str, str]:
    """Return {"<this_hash>": "<case_id>"} for the closest match, or {}.

    A match requires Hamming distance ≤ threshold.
    """
    best_case = None
    best_distance: int | None = None
    for corpus_hash, case_id in known_hashes.items():
        dist = _hamming_distance(this_hash, corpus_hash)
        if dist is None:
            continue
        if dist <= _HASH_DISTANCE_THRESHOLD:
            if best_distance is None or dist < best_distance:
                best_distance = dist
                best_case = case_id
    if best_case is None:
        return {}
    return {this_hash: best_case}


# ---------------------------------------------------------------------------
# AI-generation detection
# ---------------------------------------------------------------------------

def _detect_ai_hint(img: Image.Image, raw_bytes: bytes) -> bool:
    """Return True if a known generator name appears in EXIF Software or bytes.

    Scans the EXIF ``Software`` tag and the raw file bytes for known AI-image
    generator names (Midjourney, DALL·E, Stable Diffusion, Firefly, Imagen).
    The c2pa manifest marker alone is insufficient — a generator name must
    also be present in the bytes.
    """
    # 1. EXIF Software tag (top-level IFD0).
    exif_obj = _get_raw_exif(img)
    if exif_obj is not None:
        try:
            software = exif_obj.get(_TAG_SOFTWARE)
        except Exception:
            software = None
        if isinstance(software, str):
            lowered = software.lower()
            if any(marker in lowered for marker in _AI_GENERATOR_MARKERS):
                return True

    # 2. Raw file bytes — generator name (with or without c2pa marker).
    try:
        lowered_bytes = raw_bytes.lower()
        for marker in _AI_GENERATOR_MARKERS:
            if marker.encode("ascii", errors="ignore") in lowered_bytes:
                return True
    except Exception:
        pass

    return False


# ---------------------------------------------------------------------------
# Vision provider hook
# ---------------------------------------------------------------------------

_PHOTO_SYSTEM_PROMPT = (
    "You inspect photos of a ride-hailing car interior for a cleaning-fee "
    "claim. Return ONLY JSON with these keys: "
    '{"stain_damage_classification": one of LIQUID_SPILL, VOMIT, '
    "FOOD_RESIDUE, PHYSICAL_DAMAGE, DIRT_MUD, NO_DAMAGE_DETECTED, OTHER, "
    '"damage_severity": MINOR, MODERATE, or SEVERE (or null), '
    '"is_ai_generated": bool, '
    '"ai_generated_confidence": float between 0 and 1, '
    '"stain_regions": a list (max 3) of boxes '
    '{"x1","y1","x2","y2"} as fractions 0..1 of image width/height '
    "(origin top-left) around each stain or damaged area. "
    'Empty list if no stain or not sure. Do not guess.} '
    "If the photo is not a car interior, use OTHER for the classification."
)


# ---------------------------------------------------------------------------
# Stain-region validation
# ---------------------------------------------------------------------------

_MAX_STAIN_REGIONS = 3


def _is_valid_fraction(value: Any) -> bool:
    """True when *value* is a finite float/int in [0, 1] and not a bool."""
    if _is_strict_bool(value):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(f):
        return False
    return 0.0 <= f <= 1.0


def _validate_stain_regions(raw: Any) -> list[dict[str, float]]:
    """Validate and return a list of stain-region boxes (max 3).

    Each box must have x1, y1, x2, y2 that are finite numbers in [0, 1]
    with x1 < x2 and y1 < y2.  Invalid boxes are silently dropped.
    """
    if not isinstance(raw, list):
        return []
    result: list[dict[str, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        x1 = item.get("x1")
        y1 = item.get("y1")
        x2 = item.get("x2")
        y2 = item.get("y2")
        if not (
            _is_valid_fraction(x1)
            and _is_valid_fraction(y1)
            and _is_valid_fraction(x2)
            and _is_valid_fraction(y2)
        ):
            continue
        fx1, fy1, fx2, fy2 = float(x1), float(y1), float(x2), float(y2)
        if not (fx1 < fx2 and fy1 < fy2):
            continue
        result.append({"x1": fx1, "y1": fy1, "x2": fx2, "y2": fy2})
        if len(result) >= _MAX_STAIN_REGIONS:
            break
    return result


def _run_vision(file_path: str | Path) -> tuple[dict[str, Any] | None, list[dict[str, float]]]:
    """Run DeepSeek vision analysis on *file_path*.

    Returns a ``(provider_dict, stain_regions)`` tuple.  The provider dict
    contains classification / severity / AI fields (same as annotations),
    or None if the vision API returned nothing.  ``stain_regions`` is the
    validated list of boxes (max 3), possibly empty.
    """
    raw = call_vision_json(
        _PHOTO_SYSTEM_PROMPT,
        "Analyse this photo and return the JSON.",
        file_path,
    )
    if not isinstance(raw, dict):
        return None, []
    result: dict[str, Any] = {}
    for key in (
        "stain_damage_classification",
        "damage_severity",
        "is_ai_generated",
        "ai_generated_confidence",
    ):
        val = raw.get(key)
        if val is not None:
            result[key] = val
    stain_regions = _validate_stain_regions(raw.get("stain_regions"))
    return (result or None), stain_regions


# ---------------------------------------------------------------------------
# provider_result assembly
# ---------------------------------------------------------------------------

def _build_provider_result(
    annotation: dict[str, Any] | None,
    ai_hint: bool,
) -> dict[str, Any] | None:
    """Assemble a validated provider_result dict, or None.

    - The AI metadata hint overrides is_ai_generated / confidence.
    - If there is no annotation and no AI hint, return None (omit field).
    - Values are validated the same way image_analysis._parse_provider_result
      does; invalid ones cause the whole field to be dropped.
    """
    # Start from the annotation (or empty).
    base: dict[str, Any] = {}
    if isinstance(annotation, dict) and annotation:
        base = dict(annotation)

    if ai_hint:
        base["is_ai_generated"] = True
        base["ai_generated_confidence"] = 0.9

    # If nothing useful is present, omit provider_result.
    has_ai = "is_ai_generated" in base
    has_classification = "stain_damage_classification" in base
    if not has_ai and not has_classification:
        return None

    # Validate.
    result: dict[str, Any] = {}

    is_ai_gen = base.get("is_ai_generated")
    if not _is_strict_bool(is_ai_gen):
        return None
    result["is_ai_generated"] = is_ai_gen

    confidence = base.get("ai_generated_confidence")
    if not _is_valid_confidence(confidence):
        return None
    result["ai_generated_confidence"] = float(confidence)

    classification = base.get("stain_damage_classification")
    if not _is_valid_classification(classification):
        return None
    result["stain_damage_classification"] = classification

    severity = base.get("damage_severity")
    if severity is not None:
        if not _is_valid_severity(severity):
            return None
        result["damage_severity"] = severity

    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_image_evidence(
    file_path: str | Path,
    image_id: str,
    image_url: str,
    known_hashes: dict[str, str] | None = None,
    annotation: dict[str, Any] | None = None,
    use_vision: bool = False,
) -> dict[str, Any]:
    """Build an ``ImageEvidenceInput`` dict from an image file on disk.

    Never raises: on any read error returns ``{"image_id", "image_url"}``.

    Args:
        file_path: Path to the image file.
        image_id: Unique identifier (e.g. "IMG-001").
        image_url: URL or storage path for the image.
        known_hashes: Corpus ``{"<hash>": "<case_id>"}`` for recycled detection.
            Defaults to ``backend/mock_evidence/known_image_hashes.json``.
        annotation: Vision-model stand-in dict for this image_id.  Defaults
            to a lookup in ``photo_annotations.json``.

    Returns:
        A dict conforming to ``ImageEvidenceInput`` in ``shared/schemas.json``.
    """
    base = {"image_id": image_id, "image_url": image_url}

    # Read raw bytes once (used for AI hint and Pillow).
    try:
        raw_bytes = Path(file_path).read_bytes()
    except Exception:
        return base

    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img.load()
    except Exception:
        return base

    # 1. EXIF
    exif_obj = _get_raw_exif(img)

    if exif_obj is not None:
        dt_str, offset = _extract_timestamp(exif_obj)
        if isinstance(dt_str, str) and dt_str.strip():
            iso_ts = _format_exif_timestamp(
                dt_str.strip(), offset if isinstance(offset, str) else None
            )
            if iso_ts:
                base["exif_timestamp"] = iso_ts

        gps = _extract_gps(exif_obj)
        if gps is not None:
            base["exif_gps_location"] = gps

    # 2. Perceptual hash
    this_hash = _compute_dhash(img)
    if this_hash:
        base["image_hash"] = this_hash
        # Skip known_matches for low-detail images (near-blank / near-full)
        # to avoid false "recycled" findings.
        bits_set = _popcount(this_hash)
        if bits_set is not None and _MIN_HASH_BITS <= bits_set <= _MAX_HASH_BITS:
            if known_hashes is None:
                known_hashes = _load_default_hashes()
            matches = _find_known_match(this_hash, known_hashes)
            if matches:
                base["known_matches"] = matches

    # 3. AI-generation hint
    ai_hint = _detect_ai_hint(img, raw_bytes)

    # 4. provider_result + stain_regions
    #    Order: vision result if valid, else annotation.
    vision_result: dict[str, Any] | None = None
    stain_regions: list[dict[str, float]] = []
    if use_vision:
        vision_result, stain_regions = _run_vision(file_path)

    if vision_result is not None:
        annotation = vision_result
    else:
        if annotation is None:
            annotations = _load_default_annotations()
            annotation = annotations.get(image_id)
        # Read stain_regions from the annotation (same validation).
        stain_regions = _validate_stain_regions(
            annotation.get("stain_regions") if isinstance(annotation, dict) else None
        )
    provider_result = _build_provider_result(annotation, ai_hint)
    if provider_result is not None:
        base["provider_result"] = provider_result

    if stain_regions:
        base["stain_regions"] = stain_regions

    return base


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build an ImageEvidenceInput dict from a photo file."
    )
    parser.add_argument("file", help="Path to the image file")
    parser.add_argument("--image-id", required=True, help="Image identifier (e.g. IMG-001)")
    parser.add_argument("--image-url", default=None, help="Image URL or storage path")
    args = parser.parse_args()

    image_url = args.image_url if args.image_url else args.file
    result = build_image_evidence(args.file, args.image_id, image_url)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
