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
    trip_end_time: str | None = None,
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
                "trip_end_time": trip_end_time,
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


# ---------------------------------------------------------------------------
# 17-32. Strict provider_result parsing — never fabricate, never coerce
# ---------------------------------------------------------------------------

def _ctx_with_image_evidence(evidence_list):
    return {"data_sources": {"image_evidence": evidence_list}}


def _make_raw_image(**overrides):
    defaults = {
        "image_id": "IMG-001",
        "image_url": "https://example.com/photo.jpg",
        "exif_timestamp": "2026-09-13T08:44:00+08:00",
        "exif_gps_location": {"latitude": 1.2847, "longitude": 103.8382},
        "provider_result": {
            "is_ai_generated": False,
            "ai_generated_confidence": 0.05,
            "stain_damage_classification": "NO_DAMAGE_DETECTED",
            "damage_severity": "MINOR",
        },
    }
    defaults.update(overrides)
    return defaults


# 17. provider_result missing is_ai_generated -> rejected
def test_provider_missing_is_ai_generated_rejected():
    raw = _make_raw_image()
    del raw["provider_result"]["is_ai_generated"]
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 18. provider_result missing ai_generated_confidence -> rejected
def test_provider_missing_confidence_rejected():
    raw = _make_raw_image()
    del raw["provider_result"]["ai_generated_confidence"]
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 19. provider_result missing stain_damage_classification -> rejected
def test_provider_missing_classification_rejected():
    raw = _make_raw_image()
    del raw["provider_result"]["stain_damage_classification"]
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 20. string "false" is NOT coerced into True
def test_provider_string_false_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["is_ai_generated"] = "false"
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 21. numeric 0 is NOT accepted in place of boolean
def test_provider_int_zero_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["is_ai_generated"] = 0
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 22. numeric 1 is NOT accepted in place of boolean
def test_provider_int_one_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["is_ai_generated"] = 1
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 23. invalid classification is rejected
def test_provider_invalid_classification_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["stain_damage_classification"] = "DIRTY"
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 24. invalid severity is rejected
def test_provider_invalid_severity_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["damage_severity"] = "EXTREME"
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 25. confidence < 0 rejected at extraction
def test_provider_confidence_below_zero_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["ai_generated_confidence"] = -0.1
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 26. confidence > 1 rejected at extraction
def test_provider_confidence_above_one_rejected():
    raw = _make_raw_image()
    raw["provider_result"]["ai_generated_confidence"] = 1.1
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is None


# 27. latitude > 90 rejected
def test_gps_latitude_above_90_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": 91.0, "longitude": 103.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 28. latitude < -90 rejected
def test_gps_latitude_below_minus_90_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": -91.0, "longitude": 103.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 29. longitude > 180 rejected
def test_gps_longitude_above_180_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": 1.0, "longitude": 181.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 30. longitude < -180 rejected
def test_gps_longitude_below_minus_180_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": 1.0, "longitude": -181.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 31. NaN GPS rejected safely
def test_gps_nan_rejected():
    import math
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": float("nan"), "longitude": 103.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 32. Infinity GPS rejected safely
def test_gps_infinity_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": 1.0, "longitude": float("inf")}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 33. boolean latitude rejected
def test_gps_bool_latitude_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": True, "longitude": 103.0}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 34. boolean longitude rejected
def test_gps_bool_longitude_rejected():
    raw = _make_raw_image()
    raw["exif_gps_location"] = {"latitude": 1.0, "longitude": False}
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].exif_gps_location is None


# 35. incomplete provider data never emits ExifAnalysis
def test_incomplete_provider_never_emits_exif_analysis():
    raw = _make_raw_image()
    raw["provider_result"] = {"is_ai_generated": False}  # missing confidence & classification
    ctx = _ctx_with_image_evidence([raw])
    images = extract_images_from_context(ctx)
    assert len(images) == 1
    assert images[0].provider_result is None
    # Without provider_result, exif_timestamp and exif_gps are still present,
    # but _can_emit_exif_analysis requires provider_result too.
    result = analyze_image_evidence_batch(images, ctx["data_sources"])
    assert result == []


# 36. valid provider without optional severity still accepted
def test_provider_without_optional_severity_accepted():
    raw = _make_raw_image()
    del raw["provider_result"]["damage_severity"]
    images = extract_images_from_context(_ctx_with_image_evidence([raw]))
    assert len(images) == 1
    assert images[0].provider_result is not None
    assert images[0].provider_result.damage_severity is None


# 37. JSON schema sanity: DataSources with image_evidence is valid
def test_shared_schema_accepts_optional_image_evidence():
    import json
    from pathlib import Path
    schema_path = Path(__file__).resolve().parent.parent.parent / "shared" / "schemas.json"
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    ds = schema["$defs"]["DataSources"]
    assert "image_evidence" in ds["properties"]
    assert "image_evidence" not in ds.get("required", [])

    ie = schema["$defs"]["ImageEvidenceInput"]
    assert "image_id" in ie["required"]
    assert "image_url" in ie["required"]
    assert "provider_result" not in ie["required"]
    assert "exif_timestamp" not in ie["required"]

    pr = schema["$defs"]["ProviderImageResult"]
    assert "is_ai_generated" in pr["required"]
    assert "ai_generated_confidence" in pr["required"]
    assert "stain_damage_classification" in pr["required"]
    assert "damage_severity" not in pr["required"]

    gps = schema["$defs"]["ImageExifGpsLocation"]
    assert gps["properties"]["latitude"]["minimum"] == -90
    assert gps["properties"]["latitude"]["maximum"] == 90
    assert gps["properties"]["longitude"]["minimum"] == -180
    assert gps["properties"]["longitude"]["maximum"] == 180


# ===========================================================================
# 38. POL-4 photo-validity rule (trip_end_time + dropoff_location known)
# ===========================================================================

_TRIP_END = "2026-09-25T22:05:00+08:00"
_DROPOFF_LAT = 1.3508
_DROPOFF_LNG = 103.8485


def _make_pol4_context(**overrides):
    """Build a context where the POL-4 rule applies (trip_end_time + dropoff known)."""
    defaults = {
        "trip_end_time": _TRIP_END,
        "dropoff_lat": _DROPOFF_LAT,
        "dropoff_lng": _DROPOFF_LNG,
    }
    defaults.update(overrides)
    return _make_context(**defaults)


def _make_pol4_image(exif_ts: str, lat: float, lng: float, **kw):
    """Build a fully-valid image with the given EXIF timestamp and GPS."""
    return _make_valid_image(
        exif_timestamp=exif_ts,
        exif_gps_location=ExifGpsLocation(latitude=lat, longitude=lng),
        **kw,
    )


# 38a. Photo 20 min after trip end at the dropoff → True (failed under old rule)
def test_pol4_photo_20min_after_trip_end_at_dropoff_consistent():
    img = _make_pol4_image(
        exif_ts="2026-09-25T22:25:00+08:00",  # 20 min after 22:05
        lat=_DROPOFF_LAT,
        lng=_DROPOFF_LNG,
    )
    ctx = _make_pol4_context()
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is True


# 38b. Photo 40 min after trip end at the dropoff → False (exceeds 30 min window)
def test_pol4_photo_40min_after_trip_end_inconsistent():
    img = _make_pol4_image(
        exif_ts="2026-09-25T22:45:00+08:00",  # 40 min after 22:05
        lat=_DROPOFF_LAT,
        lng=_DROPOFF_LNG,
    )
    ctx = _make_pol4_context()
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is False


# 38c. Photo 5 min before trip end at the dropoff → False
def test_pol4_photo_before_trip_end_inconsistent():
    img = _make_pol4_image(
        exif_ts="2026-09-25T22:00:00+08:00",  # 5 min before 22:05
        lat=_DROPOFF_LAT,
        lng=_DROPOFF_LNG,
    )
    ctx = _make_pol4_context()
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is False


# 38d. Photo 10 min after trip end but 800 m from the dropoff → False
def test_pol4_photo_10min_after_trip_end_far_from_dropoff_inconsistent():
    # Bishan dropoff ~1.3508, 103.8485.  Move ~800m south.
    img = _make_pol4_image(
        exif_ts="2026-09-25T22:15:00+08:00",  # 10 min after 22:05
        lat=_DROPOFF_LAT - 0.0072,  # ~800m south
        lng=_DROPOFF_LNG,
    )
    ctx = _make_pol4_context()
    result = analyze_image_evidence(img, ctx["data_sources"])
    assert result is not None
    assert result.get("exif_consistent_with_trip") is False


# 38e. No trip_end_time → old rule still applied (same result as existing case)
def test_pol4_no_trip_end_time_uses_legacy_rule():
    """When trip_end_time is missing, the legacy ±10 min / 200 m rule applies.

    This mirrors test_exif_timestamp_within_tolerance_consistent: EXIF 1 min
    after arrival, 7 min before cancellation, GPS at pickup.  Under the legacy
    rule this is consistent.  Under the POL-4 rule it would be None (no
    trip_end_time), so the fallback must be the legacy rule.
    """
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


# 38f. DISP-004 mock file → still False (2026-08-30, Tampines)
def test_pol4_disp004_mock_still_inconsistent():
    import sys
    from pathlib import Path

    _repo_root = Path(__file__).resolve().parent.parent.parent
    if str(_repo_root) not in sys.path:
        sys.path.insert(0, str(_repo_root))

    from app.services.verification.ingestion import load_case_data, normalize_evidence

    data = normalize_evidence(load_case_data("DISP-004"))
    images = extract_images_from_context(data)
    assert len(images) == 1
    analyses = analyze_image_evidence_batch(images, data["data_sources"])
    assert len(analyses) == 1
    assert analyses[0].get("exif_consistent_with_trip") is False