"""Image evidence check — builds a structured summary for the frontend.

``build_image_check(case)`` inspects each ``dispute_claim.image_evidence``
entry and returns a dict with one entry per image, covering:

  - classification / severity (from ``provider_result``)
  - photo time vs trip end (within POL-4 window)
  - photo distance vs drop-off (within POL-4 radius)
  - recycled photo detection (``known_matches``)
  - AI-generated flag (``provider_result.is_ai_generated``)
  - verdict image URL availability
  - a plain-English status + summary

This module never raises on missing/odd data — non-dict items are skipped.
All limits come from ``policy_params("POL-4")``; nothing is hard-coded.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.shared.time_rules import (
    check_distance,
    check_window,
    format_gap,
    parse_ts,
    policy_params,
    trip_end_time,
)

logger = logging.getLogger(__name__)

# --- Defaults for POL-4 params ------------------------------------------------

_DEFAULTS = {
    "photo_window_min_after_trip_end": 30,
    "photo_location_radius_m": 500,
}


def _get_policy_limits() -> tuple[float, float]:
    """Return ``(max_after_min, max_radius_m)`` from POL-4 policy params."""
    params = policy_params("POL-4", _DEFAULTS)
    max_after = params.get("photo_window_min_after_trip_end", _DEFAULTS["photo_window_min_after_trip_end"])
    max_m = params.get("photo_location_radius_m", _DEFAULTS["photo_location_radius_m"])
    try:
        max_after_f = float(max_after)
    except (TypeError, ValueError):
        max_after_f = float(_DEFAULTS["photo_window_min_after_trip_end"])
    try:
        max_m_f = float(max_m)
    except (TypeError, ValueError):
        max_m_f = float(_DEFAULTS["photo_location_radius_m"])
    return max_after_f, max_m_f


# ---------------------------------------------------------------------------
# Per-field builders
# ---------------------------------------------------------------------------


def _build_verdict_image_url(case: dict, image: dict, case_id: str) -> str | None:
    """URL to the verdict render, or None if not available."""
    image_url = image.get("image_url")
    if not isinstance(image_url, str) or not image_url.startswith("/evidence/"):
        return None
    jv = case.get("judge_verdict") or {}
    if not isinstance(jv, dict):
        return None
    ruling_type = jv.get("ruling_type")
    if not (isinstance(ruling_type, str) and ruling_type):
        return None
    image_id = image.get("image_id")
    if not isinstance(image_id, str) or not image_id:
        return None
    return f"/api/disputes/{case_id}/evidence/{image_id}/verdict.jpg"


def _build_photo_time(image: dict, case: dict, max_after_min: float) -> dict | None:
    """Photo time relative to trip end."""
    exif_ts = image.get("exif_timestamp")
    ds = case.get("data_sources") or {}
    trip_end = trip_end_time(ds)
    exif_dt = parse_ts(exif_ts)
    if exif_dt is None or trip_end is None:
        return None

    w = check_window(exif_dt, trip_end, max_after=max_after_min, unit="minutes")
    secs = w["seconds"]
    if secs is None:
        return None

    within = bool(w["within"]) if w["within"] is not None else False
    gap_text = format_gap(secs)
    if secs < 0:
        text = f"{gap_text} before trip end"
    else:
        text = f"{gap_text} after trip end"
    limit_text = f"within {int(max_after_min)} min after trip end"

    return {
        "taken_at": exif_ts if isinstance(exif_ts, str) else (exif_dt.isoformat() if exif_dt else None),
        "seconds_after_trip_end": secs,
        "within_window": within,
        "text": text,
        "limit_text": limit_text,
    }


def _build_photo_distance(image: dict, case: dict, max_m: float) -> dict | None:
    """Photo distance from drop-off."""
    exif_gps = image.get("exif_gps_location")
    ds = case.get("data_sources") or {}
    trip = ds.get("trip_data") or {}
    dropoff = trip.get("dropoff_location") if isinstance(trip, dict) else None

    if not isinstance(exif_gps, dict) or not isinstance(dropoff, dict):
        return None

    d = check_distance(exif_gps, dropoff, max_m=max_m)
    meters = d["meters"]
    if meters is None:
        return None

    within = bool(d["within"]) if d["within"] is not None else False
    return {
        "meters": round(meters, 1),
        "within_radius": within,
        "text": f"{d['text']} from drop-off",
        "limit_text": f"within {int(max_m)} m",
    }


def _build_recycled(image: dict) -> dict:
    """Check known_matches for a prior case reference."""
    known_matches = image.get("known_matches")
    prior_case: str | None = None
    if isinstance(known_matches, dict) and known_matches:
        for _hash, value in known_matches.items():
            if isinstance(value, str) and value:
                prior_case = value
                break
    return {"matched": prior_case is not None, "prior_case": prior_case}


def _build_ai_generated(image: dict) -> dict:
    """AI-generated flag and confidence from provider_result."""
    pr = image.get("provider_result")
    flag: bool | None = None
    confidence: float | None = None
    if isinstance(pr, dict) and pr:
        raw_flag = pr.get("is_ai_generated")
        if isinstance(raw_flag, bool):
            flag = raw_flag
        raw_conf = pr.get("ai_generated_confidence")
        if raw_conf is not None:
            try:
                confidence = float(raw_conf)
            except (TypeError, ValueError):
                confidence = None
    return {"flag": flag, "confidence": confidence}


# ---------------------------------------------------------------------------
# Summary builder
# ---------------------------------------------------------------------------


def _build_summary(
    *,
    photo_time: dict | None,
    photo_distance: dict | None,
    recycled: dict,
    ai_generated: dict,
    classification: str | None,
    severity: str | None,
) -> str:
    """Build a one-sentence plain-English summary (no LLM, facts only)."""
    parts: list[str] = []

    # Classification + severity
    if classification:
        parts.append(classification)
        if severity:
            parts[-1] = f"{classification} ({severity.lower()})"
        parts[-1] = parts[-1].capitalize() + "."
    elif severity:
        parts.append(f"{severity.lower().capitalize()} damage.")
    else:
        parts.append("Photo.")

    # Recycled
    if recycled["matched"]:
        parts.append(
            f"Recycled photo: matches prior case {recycled['prior_case']}."
        )

    # AI generated
    if ai_generated["flag"] is True:
        conf = ai_generated.get("confidence")
        if conf is not None:
            parts.append(f"Suspected AI-generated (confidence {conf:.2f}).")
        else:
            parts.append("Suspected AI-generated.")

    # Time + distance
    time_text = photo_time["text"] if photo_time else None
    dist_text = photo_distance["text"] if photo_distance else None
    if time_text or dist_text:
        fragments: list[str] = []
        if time_text:
            fragments.append(time_text)
        if dist_text:
            fragments.append(dist_text)
        parts.append(f"Photo taken {', '.join(fragments)}.")

    # Missing data
    if photo_time is None and photo_distance is None:
        parts.append(
            "Photo has no time/location data, so it cannot be checked against the trip."
        )

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Status determination
# ---------------------------------------------------------------------------


def _determine_status(
    *,
    photo_time: dict | None,
    photo_distance: dict | None,
    recycled: dict,
    ai_generated: dict,
    provider_result_present: bool,
) -> str:
    """FLAGGED / INCOMPLETE / OK."""
    if recycled["matched"]:
        return "FLAGGED"
    if ai_generated["flag"] is True:
        return "FLAGGED"
    if photo_time is not None and not photo_time["within_window"]:
        return "FLAGGED"
    if photo_distance is not None and not photo_distance["within_radius"]:
        return "FLAGGED"
    if photo_time is None or photo_distance is None or not provider_result_present:
        return "INCOMPLETE"
    return "OK"


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def build_image_check(case: dict) -> dict:
    """Build a structured image check summary for a dispute case.

    Returns:
        ``{"case_id": str, "has_verdict": bool, "images": [...]}``

    Each entry in ``images`` has all keys always present (null when unknown).
    Non-dict items in ``image_evidence`` are silently skipped.
    """
    # Extract case_id
    meta = case.get("case_metadata") or {}
    claim = case.get("dispute_claim") or {}
    case_id = (
        (meta.get("case_id") if isinstance(meta, dict) else None)
        or (claim.get("case_id") if isinstance(claim, dict) else None)
        or ""
    )

    # Has verdict?
    jv = case.get("judge_verdict") or {}
    has_verdict = (
        isinstance(jv, dict)
        and isinstance(jv.get("ruling_type"), str)
        and bool(jv["ruling_type"])
    )

    # Policy limits
    max_after_min, max_m = _get_policy_limits()

    # Images
    images_raw = claim.get("image_evidence") if isinstance(claim, dict) else None
    if not isinstance(images_raw, list):
        images_raw = []

    result_images: list[dict[str, Any]] = []
    for image in images_raw:
        if not isinstance(image, dict):
            continue

        image_id = image.get("image_id")
        image_url = image.get("image_url")

        # provider_result
        pr = image.get("provider_result")
        provider_result_present = isinstance(pr, dict) and bool(pr)
        classification = None
        severity = None
        if provider_result_present:
            classification = pr.get("stain_damage_classification")
            if not (isinstance(classification, str) and classification):
                classification = None
            severity = pr.get("damage_severity")
            if not (isinstance(severity, str) and severity):
                severity = None

        # stain_regions
        stain_regions_raw = image.get("stain_regions")
        stain_regions = stain_regions_raw if isinstance(stain_regions_raw, list) else []

        # Build sub-fields
        verdict_image_url = _build_verdict_image_url(case, image, case_id)
        photo_time = _build_photo_time(image, case, max_after_min)
        photo_distance = _build_photo_distance(image, case, max_m)
        recycled = _build_recycled(image)
        ai_generated = _build_ai_generated(image)

        # Status
        status = _determine_status(
            photo_time=photo_time,
            photo_distance=photo_distance,
            recycled=recycled,
            ai_generated=ai_generated,
            provider_result_present=provider_result_present,
        )

        # Summary
        summary = _build_summary(
            photo_time=photo_time,
            photo_distance=photo_distance,
            recycled=recycled,
            ai_generated=ai_generated,
            classification=classification,
            severity=severity,
        )

        result_images.append({
            "image_id": image_id,
            "image_url": image_url,
            "verdict_image_url": verdict_image_url,
            "classification": classification,
            "severity": severity,
            "stain_regions": stain_regions,
            "photo_time": photo_time,
            "photo_distance": photo_distance,
            "recycled": recycled,
            "ai_generated": ai_generated,
            "status": status,
            "summary": summary,
        })

    return {
        "case_id": case_id,
        "has_verdict": has_verdict,
        "images": result_images,
    }
