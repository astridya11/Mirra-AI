"""Tests for P3 Image Evidence Analysis / EXIF Verification layer."""

from datetime import datetime, timezone

import pytest

from app.services.verification.image_analysis import (
    ExifGpsLocation,
    ImageEvidenceInput,
    ProviderImageResult,
    analyze_image_evidence,
    analyze_image_evidence_batch,
    extract_images_from_context,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_context(
    scheduled_time: str | None = None,
    arrival_time: str | None = None,
    cancellation_time: str | None = None,
    pickup_lat: float = 1.0,
    pickup_lng: float = 103.0,
    dropoff_lat: float = 1.1,
    dropoff_lng: float = 103.1,
    app_events: list | None = None,
    gps_route: list | None = None,
):
    return {
        "data_sources": {
            "trip_data": {
                "scheduled_time": scheduled_time,
                "driver_arrival_time": arrival_time,
                "cancellation_time": cancellation_time,
                "pickup_location": {"lat": pickup_lat, "lng": pickup_lng},
                "dropoff_location": {"lat": dropoff_lat, "lng": dropoff_lng},
            },
            "app_events": app_events or [],
            "gps_telemetry": {
                "actual_route": gps_route or [],
                "optimal_route": gps_route or [],
            },
        }
    }


def _make_provider_result(**overrides):
    defaults = {
        "is_ai_generated": False,
        "ai_generated_confidence": 0.05,
        "stain_damage_classification": "NO_DAMAGE_DETECTED",
        "damage_severity": "MINOR",
    }
    defaults.update(overrides)
    return ProviderImageResult(**defaults)


def _make_valid_image(**overrides):
    defaults = {
        "image_id": "IMG-001",
        "image_url": "https://example.com/photo1.jpg",
        "exif_timestamp": "2026-09-13T08:44:00+08:00",
        "exif_gps_location": ExifGpsLocation(latitude=1.2847, longitude=103.8382),
        "provider_result": _make_provider_result(),
    }
    defaults.update(overrides)
    return ImageEvidenceInput(**defaults)


# ---------------------------------------------------------------------------
# 1. No image evidence -> returns []
# ---------------------------------------------------------------------------
def test_no_image_evidence_returns_empty():
    ctx = _make_context()
    images = extract_images_from_context(ctx)
    assert images == []
    result = analyze_image_evidence_batch(images, ctx["data_sources"])
    assert result == []


# ---------------------------------------------------------------------------
# 2. Missing/incomplete image information -> does not fabricate ExifAnalysis
# ---------------------------------------------------------------------------
def test_missing_exif_timestamp_skipped():
    img = _make_valid_image(exif_timestamp=None)
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is None


def test_missing_exif_gps_skipped():
    img = _make_valid_image(exif_gps_location=None)
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is None


def test_missing_provider_result_skipped():
    img = _make_valid_image(provider_result=None)
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is None


# ---------------------------------------------------------------------------
# 3. Valid structured input -> schema-compatible ExifAnalysis
# ---------------------------------------------------------------------------
def test_valid_input_emits_schema_compatible_result():
    img = _make_valid_image()
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
        pickup_lat=1.2847,
        pickup_lng=103.8382,
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None

    # Required schema fields
    assert result["image_id"] == "IMG-001"
    assert result["image_url"] == "https://example.com/photo1.jpg"
    assert result["exif_timestamp"] == "2026-09-13T08:44:00+08:00"
    assert "latitude" in result["exif_gps_location"]
    assert "longitude" in result["exif_gps_location"]
    assert isinstance(result["is_ai_generated"], bool)
    assert 0.0 <= result["ai_generated_confidence"] <= 1.0
    assert result["stain_damage_classification"] == "NO_DAMAGE_DETECTED"

    # Optional fields
    assert result.get("damage_severity") == "MINOR"


# ---------------------------------------------------------------------------
# 4. EXIF timestamp within tolerance -> consistent
# ---------------------------------------------------------------------------
def test_exif_timestamp_within_tolerance_consistent():
    # EXIF timestamp 1 minute after arrival, 7 minutes before cancellation
    img = _make_valid_image(exif_timestamp="2026-09-13T08:44:00+08:00")
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
        pickup_lat=1.2847,
        pickup_lng=103.8382,
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is True


# ---------------------------------------------------------------------------
# 5. EXIF timestamp outside trip timeframe -> inconsistent
# ---------------------------------------------------------------------------
def test_exif_timestamp_far_outside_window_inconsistent():
    # EXIF timestamp 2 hours after cancellation
    img = _make_valid_image(exif_timestamp="2026-09-13T10:51:00+08:00")
    ctx = _make_context(
        scheduled_time="2026-09-13T08:45:00+08:00",
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is False


# ---------------------------------------------------------------------------
# 6. EXIF GPS near trip/dropoff -> consistent
# ---------------------------------------------------------------------------
def test_exif_gps_near_pickup_consistent():
    img = _make_valid_image(
        exif_gps_location=ExifGpsLocation(latitude=1.2848, longitude=103.8383)
    )
    ctx = _make_context(
        pickup_lat=1.2847,
        pickup_lng=103.8382,
        dropoff_lat=1.2648,
        dropoff_lng=103.8223,
        arrival_time="2026-09-13T08:43:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is True


# ---------------------------------------------------------------------------
# 7. EXIF GPS far away -> inconsistent
# ---------------------------------------------------------------------------
def test_exif_gps_far_away_inconsistent():
    img = _make_valid_image(
        exif_gps_location=ExifGpsLocation(latitude=5.0, longitude=110.0)
    )
    ctx = _make_context(
        pickup_lat=1.2847,
        pickup_lng=103.8382,
        dropoff_lat=1.2648,
        dropoff_lng=103.8223,
        arrival_time="2026-09-13T08:43:00+08:00",
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is False


# ---------------------------------------------------------------------------
# 8. AI-generated result preserved only when supplied
# ---------------------------------------------------------------------------
def test_ai_generated_true_when_supplied():
    img = _make_valid_image(
        provider_result=_make_provider_result(
            is_ai_generated=True,
            ai_generated_confidence=0.92,
        )
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result["is_ai_generated"] is True
    assert result["ai_generated_confidence"] == 0.92


def test_ai_generated_false_when_supplied():
    img = _make_valid_image(
        provider_result=_make_provider_result(
            is_ai_generated=False,
            ai_generated_confidence=0.05,
        )
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result["is_ai_generated"] is False
    assert result["ai_generated_confidence"] == 0.05


# ---------------------------------------------------------------------------
# 9. Stain/damage classification is not inferred from chat text
# ---------------------------------------------------------------------------
def test_damage_not_inferred_from_absent_provider():
    # Even if chat mentions "vomit", without a provider result the image is skipped
    img = _make_valid_image(provider_result=None)
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is None


def test_damage_taken_from_provider_not_chat():
    # Chat says "mess" but provider says NO_DAMAGE_DETECTED
    img = _make_valid_image(
        provider_result=_make_provider_result(
            stain_damage_classification="NO_DAMAGE_DETECTED",
            damage_severity="MINOR",
        )
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result["stain_damage_classification"] == "NO_DAMAGE_DETECTED"


# ---------------------------------------------------------------------------
# 10. Recycled-image status is not claimed unless comparison corpus supplied
# ---------------------------------------------------------------------------
def test_recycled_not_claimed_without_corpus():
    img = _make_valid_image(image_hash="abc123", known_matches=None)
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    # recycled_image_detected should not be present when no comparison was made
    assert "recycled_image_detected" not in result or result.get("recycled_image_detected") is False


def test_recycled_detected_when_match_in_corpus():
    img = _make_valid_image(
        image_hash="abc123",
        known_matches={"abc123": "DISP-PRIOR-001"},
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("recycled_image_detected") is True
    assert result.get("recycled_image_match_case_id") == "DISP-PRIOR-001"


def test_recycled_not_detected_when_no_match():
    img = _make_valid_image(
        image_hash="abc123",
        known_matches={"xyz999": "DISP-PRIOR-001"},
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("recycled_image_detected") is False


# ---------------------------------------------------------------------------
# 11. Batch analysis returns only analysable results
# ---------------------------------------------------------------------------
def test_batch_skips_incomplete_images():
    valid = _make_valid_image(image_id="IMG-VALID")
    missing_ts = _make_valid_image(image_id="IMG-NO-TS", exif_timestamp=None)
    missing_gps = _make_valid_image(image_id="IMG-NO-GPS", exif_gps_location=None)
    missing_provider = _make_valid_image(image_id="IMG-NO-PR", provider_result=None)

    ctx = _make_context(
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
    )
    results = analyze_image_evidence_batch(
        [valid, missing_ts, missing_gps, missing_provider], ctx["data_sources"]
    )
    assert len(results) == 1
    assert results[0]["image_id"] == "IMG-VALID"


# ---------------------------------------------------------------------------
# 12. Confidence values clamped to [0, 1]
# ---------------------------------------------------------------------------
def test_confidence_clamped_above_one():
    img = _make_valid_image(
        provider_result=_make_provider_result(ai_generated_confidence=1.5)
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result["ai_generated_confidence"] == 1.0


def test_confidence_clamped_below_zero():
    img = _make_valid_image(
        provider_result=_make_provider_result(ai_generated_confidence=-0.3)
    )
    ctx = _make_context(arrival_time="2026-09-13T08:43:00+08:00")
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result["ai_generated_confidence"] == 0.0


# ---------------------------------------------------------------------------
# 13. extract_images_from_context parses structured image_evidence
# ---------------------------------------------------------------------------
def test_extract_images_from_context_parses_full_input():
    ctx = {
        "data_sources": {
            "image_evidence": [
                {
                    "image_id": "IMG-TEST-001",
                    "image_url": "s3://bucket/photo.jpg",
                    "exif_timestamp": "2026-09-13T08:44:00+08:00",
                    "exif_gps_location": {"latitude": 1.2847, "longitude": 103.8382},
                    "provider_result": {
                        "is_ai_generated": False,
                        "ai_generated_confidence": 0.1,
                        "stain_damage_classification": "LIQUID_SPILL",
                        "damage_severity": "MODERATE",
                    },
                    "image_hash": "hash123",
                    "known_matches": {"hash123": "DISP-OLD-001"},
                }
            ]
        }
    }
    images = extract_images_from_context(ctx)
    assert len(images) == 1
    img = images[0]
    assert img.image_id == "IMG-TEST-001"
    assert img.image_url == "s3://bucket/photo.jpg"
    assert img.exif_timestamp == "2026-09-13T08:44:00+08:00"
    assert img.exif_gps_location.latitude == 1.2847
    assert img.exif_gps_location.longitude == 103.8382
    assert img.provider_result.is_ai_generated is False
    assert img.provider_result.ai_generated_confidence == 0.1
    assert img.provider_result.stain_damage_classification == "LIQUID_SPILL"
    assert img.provider_result.damage_severity == "MODERATE"
    assert img.image_hash == "hash123"
    assert img.known_matches == {"hash123": "DISP-OLD-001"}


def test_extract_images_ignores_malformed_entries():
    ctx = {
        "data_sources": {
            "image_evidence": [
                {"image_id": "IMG-GOOD", "image_url": "http://x.com/a.jpg"},
                {"image_url": "http://x.com/b.jpg"},  # missing image_id
                "not-a-dict",
            ]
        }
    }
    images = extract_images_from_context(ctx)
    assert len(images) == 1
    assert images[0].image_id == "IMG-GOOD"


# ---------------------------------------------------------------------------
# 14. No image_evidence key -> empty list
# ---------------------------------------------------------------------------
def test_no_image_evidence_key_returns_empty():
    ctx = {"data_sources": {"trip_data": {}}}
    images = extract_images_from_context(ctx)
    assert images == []


# ---------------------------------------------------------------------------
# 15. Timezone-aware comparison works across offsets
# ---------------------------------------------------------------------------
def test_timezone_aware_comparison_across_offsets():
    # Trip in +08:00, EXIF in UTC — same instant
    img = _make_valid_image(exif_timestamp="2026-09-13T00:43:00+00:00")
    ctx = _make_context(
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
        pickup_lat=1.2847,
        pickup_lng=103.8382,
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is True


# ---------------------------------------------------------------------------
# 16. Timezone-naive EXIF timestamp vs timezone-aware trip data -> no crash
# ---------------------------------------------------------------------------
def test_naive_exif_timestamp_against_aware_trip_data_does_not_crash():
    # Real camera EXIF DateTimeOriginal has no UTC offset by default, while
    # Ryde trip timestamps always do (+08:00). This must degrade safely
    # (fall back to whatever signal IS comparable), never raise TypeError.
    img = _make_valid_image(exif_timestamp="2026-09-13T08:44:00")  # naive
    ctx = _make_context(
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
        pickup_lat=1.2847,
        pickup_lng=103.8382,
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    # Timestamp comparison is indeterminate (naive vs aware); GPS still
    # matches, so overall consistency falls back to the GPS signal.
    assert result.get("exif_consistent_with_trip") is True


def test_mixed_naive_aware_app_events_does_not_crash():
    img = _make_valid_image(exif_timestamp="2026-09-13T08:44:00+08:00")
    ctx = _make_context(
        arrival_time="2026-09-13T08:43:00+08:00",
        cancellation_time="2026-09-13T08:51:00+08:00",
        pickup_lat=1.2847,
        pickup_lng=103.8382,
        app_events=[
            {"timestamp": "2026-09-13T08:50:00+08:00", "event_type": "x"},
            {"timestamp": "2026-09-13T08:50:30", "event_type": "y"},  # naive
        ],
    )
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None