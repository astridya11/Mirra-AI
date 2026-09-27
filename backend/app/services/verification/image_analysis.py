"""P3 Image Evidence Analysis / EXIF Verification layer.

Deterministic checks (timestamp/GPS consistency, recycled-image detection)
are performed directly.  Model/provider-derived fields (AI-generation risk,
stain/damage classification, severity) are accepted only when a real
provider result is supplied in the input; they are never invented.

When no analyzable image evidence is present the module returns an empty
list, preserving current behaviour for cases such as DISP-002 and DISP-003.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal


# ---------------------------------------------------------------------------
# Input contracts (provider-ready, no fake data)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ExifGpsLocation:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class ProviderImageResult:
    """Visual-analysis output from an actual model / vision provider.

    These fields are NEVER inferred from chat text, trip data, or other
    non-image sources.  They are accepted only when a real provider has
    analysed the image bytes.
    """
    is_ai_generated: bool
    ai_generated_confidence: float
    stain_damage_classification: Literal[
        "LIQUID_SPILL", "VOMIT", "FOOD_RESIDUE",
        "PHYSICAL_DAMAGE", "DIRT_MUD", "NO_DAMAGE_DETECTED", "OTHER"
    ]
    damage_severity: Literal["MINOR", "MODERATE", "SEVERE"] | None = None


@dataclass(frozen=True)
class ImageEvidenceInput:
    """A single image that the backend has received for analysis.

    The presence of this object does NOT guarantee that an ExifAnalysis
    can be emitted.  If required EXIF or provider fields are missing,
    the image is skipped rather than fabricating a partial result.
    """
    image_id: str
    image_url: str
    exif_timestamp: str | None = None
    exif_gps_location: ExifGpsLocation | None = None
    provider_result: ProviderImageResult | None = None
    image_hash: str | None = None
    known_matches: dict[str, str] | None = None
    """Optional corpus mapping image_hash -> case_id for recycled detection."""


# ---------------------------------------------------------------------------
# Tolerance constants (technical, not policy thresholds)
# ---------------------------------------------------------------------------

# EXIF photo timestamp must fall within this many seconds of the relevant
# trip window (trip start through a reasonable post-trip window).
_EXIF_TIMESTAMP_TOLERANCE_SECONDS: int = 600  # 10 minutes

# EXIF GPS must be within this many metres of a relevant trip coordinate.
_EXIF_GPS_TOLERANCE_METERS: float = 200.0


# ---------------------------------------------------------------------------
# Strict validation helpers — never fabricate defaults
# ---------------------------------------------------------------------------

_STAIN_CLASSIFICATIONS: frozenset[str] = frozenset({
    "LIQUID_SPILL", "VOMIT", "FOOD_RESIDUE",
    "PHYSICAL_DAMAGE", "DIRT_MUD", "NO_DAMAGE_DETECTED", "OTHER",
})

_DAMAGE_SEVERITIES: frozenset[str] = frozenset({"MINOR", "MODERATE", "SEVERE"})


def _is_strict_bool(value: Any) -> bool:
    """Return True only for actual bool objects (reject int 0/1, strings, etc.)."""
    return type(value) is bool


def _is_valid_confidence(value: Any) -> bool:
    """Confidence must be a real numeric (not bool) in [0.0, 1.0]."""
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


def _is_valid_gps_lat(value: Any) -> bool:
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
    return -90.0 <= f <= 90.0


def _is_valid_gps_lng(value: Any) -> bool:
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
    return -180.0 <= f <= 180.0


def _parse_provider_result(pr_raw: Any) -> ProviderImageResult | None:
    """Parse a provider_result dict with strict validation.

    Returns None if any required field is missing, malformed, or outside
    allowed values.  No defaults are fabricated.
    """
    if not isinstance(pr_raw, dict):
        return None

    is_ai_gen = pr_raw.get("is_ai_generated")
    if not _is_strict_bool(is_ai_gen):
        return None

    confidence = pr_raw.get("ai_generated_confidence")
    if not _is_valid_confidence(confidence):
        return None

    classification = pr_raw.get("stain_damage_classification")
    if not _is_valid_classification(classification):
        return None

    severity_raw = pr_raw.get("damage_severity")
    if severity_raw is not None and not _is_valid_severity(severity_raw):
        return None

    return ProviderImageResult(
        is_ai_generated=is_ai_gen,
        ai_generated_confidence=float(confidence),
        stain_damage_classification=classification,
        damage_severity=severity_raw,
    )


def _parse_exif_gps(gps_raw: Any) -> ExifGpsLocation | None:
    """Parse EXIF GPS location with strict validation.

    Rejects booleans, NaN, Infinity, and out-of-range coordinates.
    """
    if not isinstance(gps_raw, dict):
        return None

    lat = gps_raw.get("latitude")
    lng = gps_raw.get("longitude")

    if not _is_valid_gps_lat(lat) or not _is_valid_gps_lng(lng):
        return None

    return ExifGpsLocation(latitude=float(lat), longitude=float(lng))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(ts: Any) -> datetime | None:
    if not isinstance(ts, str) or not ts.strip():
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _trip_time_window(data_sources: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    """Return (earliest_relevant, latest_relevant) for EXIF timestamp checks."""
    trip_data = data_sources.get("trip_data", {})
    app_events = data_sources.get("app_events", [])

    scheduled = _parse_ts(trip_data.get("scheduled_time"))
    arrival = _parse_ts(trip_data.get("driver_arrival_time"))
    completion = _parse_ts(trip_data.get("cancellation_time"))

    # Also consider the latest app event as a post-trip bound
    latest_event: datetime | None = None
    for evt in app_events:
        et = _parse_ts(evt.get("timestamp"))
        if et is None:
            continue
        try:
            is_later = latest_event is None or et > latest_event
        except TypeError:
            # Mixed naive/aware timestamps within app_events — skip rather
            # than crash; this event just doesn't extend the window.
            continue
        if is_later:
            latest_event = et

    earliest = scheduled or arrival or completion
    latest = latest_event or completion or arrival

    return earliest, latest


def _is_valid_trip_coord(value: Any) -> bool:
    """Lightweight coordinate validity check for trip data (no bool, NaN, Infinity)."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f)


def _relevant_gps_points(data_sources: dict[str, Any]) -> list[tuple[float, float]]:
    """Return coordinates that an EXIF GPS should plausibly be near."""
    points: list[tuple[float, float]] = []
    trip_data = data_sources.get("trip_data", {})
    gps = data_sources.get("gps_telemetry", {})

    for loc_key in ("pickup_location", "dropoff_location"):
        loc = trip_data.get(loc_key)
        if loc and isinstance(loc, dict):
            lat = loc.get("lat")
            lng = loc.get("lng")
            if _is_valid_trip_coord(lat) and _is_valid_trip_coord(lng):
                points.append((float(lat), float(lng)))

    for route_key in ("actual_route", "optimal_route"):
        for pt in gps.get(route_key, []):
            lat = pt.get("latitude")
            lng = pt.get("longitude")
            if _is_valid_trip_coord(lat) and _is_valid_trip_coord(lng):
                points.append((float(lat), float(lng)))

    return points


# ---------------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------------

def _check_exif_timestamp_consistency(
    exif_ts_str: str,
    data_sources: dict[str, Any],
) -> bool | None:
    """Return True if EXIF timestamp is within trip window + tolerance.

    Returns None if the trip window cannot be established or timestamps
    are unparseable.
    """
    exif_dt = _parse_ts(exif_ts_str)
    if exif_dt is None:
        return None

    earliest, latest = _trip_time_window(data_sources)
    if earliest is None or latest is None:
        return None

    # Extend window by tolerance on both sides
    from datetime import timedelta
    earliest_allowed = earliest - timedelta(seconds=_EXIF_TIMESTAMP_TOLERANCE_SECONDS)
    latest_allowed = latest + timedelta(seconds=_EXIF_TIMESTAMP_TOLERANCE_SECONDS)

    try:
        return earliest_allowed <= exif_dt <= latest_allowed
    except TypeError:
        # exif_dt is timezone-naive (e.g. a camera EXIF DateTimeOriginal with
        # no offset) while trip timestamps are timezone-aware, or vice versa.
        # Not comparable — report "cannot determine", never crash.
        return None


def _check_exif_gps_consistency(
    gps: ExifGpsLocation,
    data_sources: dict[str, Any],
) -> bool | None:
    """Return True if EXIF GPS is within tolerance of any relevant trip coordinate.

    Returns None if no relevant coordinates exist.
    """
    points = _relevant_gps_points(data_sources)
    if not points:
        return None

    for lat, lon in points:
        dist = _haversine_m(gps.latitude, gps.longitude, lat, lon)
        if dist <= _EXIF_GPS_TOLERANCE_METERS:
            return True
    return False


def _check_recycled_image(
    image_hash: str | None,
    known_matches: dict[str, str] | None,
) -> tuple[bool, str | None]:
    """Return (detected, match_case_id) if a comparison was actually performed.

    If no hash or no corpus is supplied, no comparison is claimed.
    """
    if not image_hash or not known_matches:
        return False, None

    match = known_matches.get(image_hash)
    if match:
        return True, match
    return False, None


def _can_emit_exif_analysis(image: ImageEvidenceInput) -> bool:
    """Determine whether we have enough real information to emit a schema-valid
    ExifAnalysis object.

    The schema requires:
        image_id, image_url, exif_timestamp, exif_gps_location,
        is_ai_generated, ai_generated_confidence, stain_damage_classification

    We do NOT fabricate missing required fields.  If any required field is
    absent, the image is skipped.
    """
    if not image.exif_timestamp:
        return False
    if image.exif_gps_location is None:
        return False
    if image.provider_result is None:
        return False
    return True


def _build_exif_analysis(
    image: ImageEvidenceInput,
    data_sources: dict[str, Any],
) -> dict[str, Any] | None:
    """Build a single schema-compatible ExifAnalysis dict, or None if skipped."""
    if not _can_emit_exif_analysis(image):
        return None

    assert image.exif_timestamp is not None
    assert image.exif_gps_location is not None
    assert image.provider_result is not None

    pr = image.provider_result

    # Deterministic checks
    ts_consistent = _check_exif_timestamp_consistency(image.exif_timestamp, data_sources)
    gps_consistent = _check_exif_gps_consistency(image.exif_gps_location, data_sources)
    exif_consistent = None
    if ts_consistent is not None and gps_consistent is not None:
        exif_consistent = ts_consistent and gps_consistent
    elif ts_consistent is not None:
        exif_consistent = ts_consistent
    elif gps_consistent is not None:
        exif_consistent = gps_consistent

    recycled_detected, recycled_match = _check_recycled_image(
        image.image_hash, image.known_matches
    )

    result: dict[str, Any] = {
        "image_id": image.image_id,
        "image_url": image.image_url,
        "exif_timestamp": image.exif_timestamp,
        "exif_gps_location": {
            "latitude": image.exif_gps_location.latitude,
            "longitude": image.exif_gps_location.longitude,
            "timestamp": image.exif_timestamp,
        },
        "is_ai_generated": pr.is_ai_generated,
        "ai_generated_confidence": max(0.0, min(1.0, pr.ai_generated_confidence)),
        "stain_damage_classification": pr.stain_damage_classification,
    }

    if pr.damage_severity is not None:
        result["damage_severity"] = pr.damage_severity
    if exif_consistent is not None:
        result["exif_consistent_with_trip"] = exif_consistent
    if image.image_hash is not None:
        result["recycled_image_detected"] = recycled_detected
        if recycled_match is not None:
            result["recycled_image_match_case_id"] = recycled_match

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_image_evidence(
    image: ImageEvidenceInput,
    data_sources: dict[str, Any],
) -> dict[str, Any] | None:
    """Analyse a single image and return a schema-compatible ExifAnalysis, or None."""
    return _build_exif_analysis(image, data_sources)


def analyze_image_evidence_batch(
    images: list[ImageEvidenceInput],
    data_sources: dict[str, Any],
) -> list[dict[str, Any]]:
    """Analyse a batch of images.  Returns only successfully analysable results."""
    results: list[dict[str, Any]] = []
    for img in images:
        analysis = _build_exif_analysis(img, data_sources)
        if analysis is not None:
            results.append(analysis)
    return results


def extract_images_from_context(context: dict[str, Any]) -> list[ImageEvidenceInput]:
    """Discover structured image evidence from an orchestrator context.

    Looks for the schema-compatible key:
        context["data_sources"]["image_evidence"]

    If absent (DISP-002, DISP-003 today), returns an empty list.
    Malformed entries are silently skipped rather than fabricating defaults.
    """
    ds = context.get("data_sources", {})
    raw_images = ds.get("image_evidence", [])
    if not isinstance(raw_images, list):
        return []

    inputs: list[ImageEvidenceInput] = []
    for raw in raw_images:
        if not isinstance(raw, dict):
            continue

        image_id = raw.get("image_id")
        image_url = raw.get("image_url")
        if not isinstance(image_id, str) or not image_id.strip():
            continue
        if not isinstance(image_url, str) or not image_url.strip():
            continue

        exif_ts = raw.get("exif_timestamp")
        exif_ts = exif_ts if isinstance(exif_ts, str) else None

        exif_gps = _parse_exif_gps(raw.get("exif_gps_location"))
        provider = _parse_provider_result(raw.get("provider_result"))

        known = raw.get("known_matches")
        if not isinstance(known, dict):
            known = None

        inputs.append(
            ImageEvidenceInput(
                image_id=image_id,
                image_url=image_url,
                exif_timestamp=exif_ts,
                exif_gps_location=exif_gps,
                provider_result=provider,
                image_hash=raw.get("image_hash"),
                known_matches=known,
            )
        )

    return inputs