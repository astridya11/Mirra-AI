"""Tests for the image evidence check endpoint and build_image_check().

No network, no LLM.  Case dicts are built in-test.
For endpoint tests, monkeypatch backend.main.DISPUTES_DIR to tmp_path.

Run:
    python -m pytest backend/tests/test_image_check.py backend/tests/test_verdict_image.py -v --noconftest
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))

from backend.shared.image_check import build_image_check  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SGT = timezone(timedelta(hours=8))

_TRIP_END = "2026-09-25T22:05:00+08:00"
_DROPOFF = {"latitude": 1.3508, "longitude": 103.8485}


def _make_case(**overrides) -> dict[str, Any]:
    """Build a minimal case dict with trip data."""
    base: dict[str, Any] = {
        "case_metadata": {
            "case_id": "DISP-100",
            "dispute_type": "CLEANING_FEE",
        },
        "dispute_claim": {
            "case_id": "DISP-100",
            "image_evidence": [],
            "receipt_evidence": [],
        },
        "data_sources": {
            "trip_data": {
                "trip_end_time": _TRIP_END,
                "dropoff_location": dict(_DROPOFF),
            },
        },
    }
    base.update(overrides)
    return base


def _make_image(
    *,
    image_id: str = "IMG-001",
    image_url: str = "/evidence/DISP-100/IMG-001.jpg",
    exif_timestamp: str | None = None,
    exif_gps: dict | None = None,
    provider_result: dict | None = None,
    stain_regions: list | None = None,
    known_matches: dict | None = None,
) -> dict:
    img: dict[str, Any] = {
        "image_id": image_id,
        "image_url": image_url,
    }
    if exif_timestamp is not None:
        img["exif_timestamp"] = exif_timestamp
    if exif_gps is not None:
        img["exif_gps_location"] = exif_gps
    if provider_result is not None:
        img["provider_result"] = provider_result
    if stain_regions is not None:
        img["stain_regions"] = stain_regions
    if known_matches is not None:
        img["known_matches"] = known_matches
    return img


def _good_provider_result() -> dict:
    return {
        "stain_damage_classification": "VOMIT",
        "damage_severity": "SEVERE",
        "is_ai_generated": False,
        "ai_generated_confidence": 0.1,
    }


@pytest.fixture()
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# (a) Good photo: 10 min after, at drop-off, VOMIT/SEVERE → OK
# ---------------------------------------------------------------------------


def test_good_photo_ok():
    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",  # 10 min after trip end
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)

    assert result["case_id"] == "DISP-100"
    assert result["has_verdict"] is False
    assert len(result["images"]) == 1

    entry = result["images"][0]
    assert entry["status"] == "OK"
    assert entry["classification"] == "VOMIT"
    assert entry["severity"] == "SEVERE"
    assert entry["photo_time"] is not None
    assert entry["photo_time"]["within_window"] is True
    assert entry["photo_time"]["seconds_after_trip_end"] == 600
    assert entry["photo_distance"] is not None
    assert entry["photo_distance"]["within_radius"] is True
    assert "10 min after trip end" in entry["summary"]


# ---------------------------------------------------------------------------
# (b) Recycled photo → FLAGGED
# ---------------------------------------------------------------------------


def test_recycled_flagged():
    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
        known_matches={"hash:abc": "DISP-0871"},
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)

    entry = result["images"][0]
    assert entry["status"] == "FLAGGED"
    assert entry["recycled"]["matched"] is True
    assert entry["recycled"]["prior_case"] == "DISP-0871"
    assert "DISP-0871" in entry["summary"]


# ---------------------------------------------------------------------------
# (c) Photo 2 days before trip end and 12 km away → FLAGGED
# ---------------------------------------------------------------------------


def test_before_and_far_flagged():
    # 2 days before trip end
    before_ts = "2026-09-23T22:05:00+08:00"
    # ~12 km away from drop-off (shift lat by ~0.1 degrees)
    far_gps = {"latitude": 1.2508, "longitude": 103.8485}
    img = _make_image(
        exif_timestamp=before_ts,
        exif_gps=far_gps,
        provider_result=_good_provider_result(),
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)

    entry = result["images"][0]
    assert entry["status"] == "FLAGGED"
    assert entry["photo_time"]["seconds_after_trip_end"] < 0
    assert entry["photo_time"]["within_window"] is False
    assert entry["photo_distance"]["within_radius"] is False
    assert "before trip end" in entry["summary"]


# ---------------------------------------------------------------------------
# (d) No exif_timestamp / no GPS → INCOMPLETE
# ---------------------------------------------------------------------------


def test_missing_data_incomplete():
    img = _make_image(
        provider_result=_good_provider_result(),
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)

    entry = result["images"][0]
    assert entry["status"] == "INCOMPLETE"
    assert entry["photo_time"] is None
    assert entry["photo_distance"] is None
    assert "no time/location data" in entry["summary"]


# ---------------------------------------------------------------------------
# (e) AI flag true → FLAGGED
# ---------------------------------------------------------------------------


def test_ai_generated_flagged():
    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result={
            "stain_damage_classification": "FOOD_RESIDUE",
            "damage_severity": "MODERATE",
            "is_ai_generated": True,
            "ai_generated_confidence": 0.92,
        },
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)

    entry = result["images"][0]
    assert entry["status"] == "FLAGGED"
    assert entry["ai_generated"]["flag"] is True
    assert entry["ai_generated"]["confidence"] == pytest.approx(0.92)


# ---------------------------------------------------------------------------
# (f) verdict_image_url: null before verdict; set when judge_verdict.ruling_type exists
# ---------------------------------------------------------------------------


def test_verdict_image_url_null_before_verdict():
    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    result = build_image_check(case)
    entry = result["images"][0]
    assert entry["verdict_image_url"] is None


def test_verdict_image_url_set_with_ruling():
    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )
    case = _make_case(
        dispute_claim={"case_id": "DISP-100", "image_evidence": [img]},
        judge_verdict={"ruling_type": "APPROVED"},
    )
    result = build_image_check(case)
    entry = result["images"][0]
    assert entry["verdict_image_url"] == "/api/disputes/DISP-100/evidence/IMG-001/verdict.jpg"
    assert result["has_verdict"] is True


def test_verdict_image_url_null_for_non_uploaded_url():
    img = _make_image(
        image_url="https://example.com/photo.jpg",  # not /evidence/
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )
    case = _make_case(
        dispute_claim={"case_id": "DISP-100", "image_evidence": [img]},
        judge_verdict={"ruling_type": "APPROVED"},
    )
    result = build_image_check(case)
    entry = result["images"][0]
    assert entry["verdict_image_url"] is None


# ---------------------------------------------------------------------------
# (g) Case with no image_evidence → 200, images []
# ---------------------------------------------------------------------------


def test_no_images_empty_list():
    case = _make_case()
    result = build_image_check(case)
    assert result["images"] == []


# ---------------------------------------------------------------------------
# (h) Endpoint: unknown case → 404; bad id → 422
# ---------------------------------------------------------------------------


def test_endpoint_unknown_case_404(client, monkeypatch, tmp_path):
    monkeypatch.setattr("backend.main.DISPUTES_DIR", tmp_path)
    r = client.get("/api/disputes/UNKNOWN-CASE/evidence/image-check")
    assert r.status_code == 404
    assert r.json()["detail"] == "Case not found"


def test_endpoint_bad_id_422(client, monkeypatch, tmp_path):
    monkeypatch.setattr("backend.main.DISPUTES_DIR", tmp_path)
    # "." is unsafe and fails _is_safe_id; still a single path segment.
    r = client.get("/api/disputes/bad.id/evidence/image-check")
    assert r.status_code == 422


def test_endpoint_success(client, monkeypatch, tmp_path):
    """Write a case file to tmp_path and verify the endpoint returns it."""
    monkeypatch.setattr("backend.main.DISPUTES_DIR", tmp_path)

    img = _make_image(
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )
    case = _make_case(dispute_claim={"case_id": "DISP-100", "image_evidence": [img]})
    case_file = tmp_path / "DISP-100.json"
    case_file.write_text(json.dumps(case), encoding="utf-8")

    r = client.get("/api/disputes/DISP-100/evidence/image-check")
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"] == "DISP-100"
    assert len(body["images"]) == 1
    assert body["images"][0]["status"] == "OK"


def test_endpoint_no_images_200_empty(client, monkeypatch, tmp_path):
    """A case with no photos returns 200, images []."""
    monkeypatch.setattr("backend.main.DISPUTES_DIR", tmp_path)

    case = _make_case()
    case_file = tmp_path / "DISP-100.json"
    case_file.write_text(json.dumps(case), encoding="utf-8")

    r = client.get("/api/disputes/DISP-100/evidence/image-check")
    assert r.status_code == 200
    assert r.json()["images"] == []


# ---------------------------------------------------------------------------
# (i) Limits come from policy_params("POL-4")
# ---------------------------------------------------------------------------


def test_policy_radius_override():
    """Monkeypatch policy_params to return radius 10 m.

    A 0 m photo stays OK; a 50 m photo becomes FLAGGED.
    """
    # Same drop-off location → 0 m distance
    img_0m = _make_image(
        image_id="IMG-0M",
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps=dict(_DROPOFF),
        provider_result=_good_provider_result(),
    )

    # ~50 m away (shift lat slightly)
    img_50m = _make_image(
        image_id="IMG-50M",
        exif_timestamp="2026-09-25T22:15:00+08:00",
        exif_gps={"latitude": 1.3513, "longitude": 103.8485},  # ~55 m north
        provider_result=_good_provider_result(),
    )

    case = _make_case(dispute_claim={
        "case_id": "DISP-100",
        "image_evidence": [img_0m, img_50m],
    })

    fake_params = {
        "photo_window_min_after_trip_end": 30,
        "photo_location_radius_m": 10,
    }

    with patch("backend.shared.image_check.policy_params", return_value=fake_params):
        result = build_image_check(case)

    entry_0m = result["images"][0]
    entry_50m = result["images"][1]

    assert entry_0m["status"] == "OK"
    assert entry_0m["photo_distance"]["within_radius"] is True
    assert entry_0m["photo_distance"]["limit_text"] == "within 10 m"

    assert entry_50m["status"] == "FLAGGED"
    assert entry_50m["photo_distance"]["within_radius"] is False
