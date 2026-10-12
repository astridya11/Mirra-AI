"""Build render arguments for ``render_verdict_image`` from a case dict.

This module reads only the case file (``backend/disputes/{case_id}.json``
structure) and returns kwargs suitable for ``render_verdict_image``.

It never raises on missing/odd fields — all ``get`` calls default safely.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.shared.time_rules import (
    parse_ts,
    haversine_m,
    check_window,
    check_distance,
    trip_end_time,
    format_gap,
    policy_params,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_image(case: dict, image_id: str) -> dict | None:
    """Find an image evidence dict by *image_id*."""
    claim = case.get("dispute_claim") or {}
    images = claim.get("image_evidence")
    if not isinstance(images, list):
        ds = case.get("data_sources") or {}
        images = ds.get("image_evidence") or []
    if not isinstance(images, list):
        return None
    for img in images:
        if isinstance(img, dict) and img.get("image_id") == image_id:
            return img
    return None


def _find_first_receipt(case: dict) -> dict | None:
    """Find the first receipt evidence entry."""
    claim = case.get("dispute_claim") or {}
    receipts = claim.get("receipt_evidence")
    if not isinstance(receipts, list):
        ds = case.get("data_sources") or {}
        receipts = ds.get("receipt_evidence") or []
    if not isinstance(receipts, list):
        return None
    for r in receipts:
        if isinstance(r, dict):
            return r
    return None


# ---------------------------------------------------------------------------
# Stamp & title
# ---------------------------------------------------------------------------

def _resolve_stamp(case: dict) -> tuple[str | None, str]:
    """Determine stamp and stamp_sub from judge_verdict / human review.

    Returns ``(stamp, stamp_sub)``.

    stamp:
      - APPROVED/PARTIAL_REFUND -> "APPROVED"
      - REJECTED -> "REJECTED"
      - ESCALATED -> "UNDER_REVIEW"
      - no verdict -> None

    stamp_sub:
      - Routed to human review with no human decision yet -> "PENDING HUMAN CONFIRMATION"
      - Human decision exists -> "CONFIRMED BY HUMAN · <DD MON YYYY>"
      - Otherwise -> "MIRRA AI · <DD MON YYYY>"
    """
    jv = case.get("judge_verdict") or {}
    cm = case.get("case_metadata") or {}
    resolution_channel = cm.get("resolution_channel") or ""

    # --- Determine effective ruling_type (human override wins) ---
    ruling_type = jv.get("ruling_type") or ""

    ep = jv.get("execution_payload") or {}
    hc = ep.get("human_confirmation_details") or {}
    human_decision = hc.get("approval_decision") or ""

    if human_decision:
        modified = hc.get("modified_action") or {}
        if isinstance(modified, dict) and modified.get("ruling_type"):
            ruling_type = modified["ruling_type"]

    is_human_review_channel = resolution_channel == "ESCALATED_HUMAN_REVIEW"
    is_pending_human = is_human_review_channel and not human_decision

    # --- stamp ---
    # While a case is pending human review (escalated channel, no human
    # decision yet), the stamp is always UNDER_REVIEW, regardless of the
    # judge's ruling_type.
    stamp: str | None = None
    if is_pending_human:
        stamp = "UNDER_REVIEW"
    elif ruling_type in ("APPROVED", "PARTIAL_REFUND"):
        stamp = "APPROVED"
    elif ruling_type == "REJECTED":
        stamp = "REJECTED"
    elif ruling_type == "ESCALATED":
        stamp = "UNDER_REVIEW"
    # no verdict -> None

    # --- stamp_sub ---
    if is_pending_human:
        stamp_sub = "PENDING HUMAN CONFIRMATION"
    elif human_decision and is_human_review_channel:
        # Human has decided: use approval_timestamp for the date
        ts = hc.get("approval_timestamp") or ""
        dt = parse_ts(ts) if ts else None
        if dt:
            stamp_sub = "CONFIRMED BY HUMAN · " + dt.strftime("%d %b %Y").upper()
        else:
            stamp_sub = "CONFIRMED BY HUMAN"
    else:
        # Fully automated (or human review channel but human confirmed)
        deliberated_at = jv.get("deliberated_at") or ""
        dt = parse_ts(deliberated_at) if deliberated_at else None
        if dt:
            stamp_sub = "MIRRA AI · " + dt.strftime("%d %b %Y").upper()
        else:
            stamp_sub = "MIRRA AI"

    return stamp, stamp_sub


def _resolve_title(case: dict, stamp: str | None) -> str:
    """Build the title string."""
    case_id = (case.get("case_metadata") or {}).get("case_id") or (case.get("dispute_claim") or {}).get("case_id") or ""
    jv = case.get("judge_verdict") or {}
    action = jv.get("recommended_action") or {}
    amount = action.get("cleaning_fee_amount")

    # After a human decision, use the human's modified amount if one was given.
    ep = jv.get("execution_payload") or {}
    hc = ep.get("human_confirmation_details") or {}
    human_decision = hc.get("approval_decision") or ""
    if human_decision:
        modified = hc.get("modified_action") or {}
        if isinstance(modified, dict):
            # Prefer modified_action.cleaning_fee_amount; fall back to
            # modified_action.recommended_action.cleaning_fee_amount.
            mod_amount = modified.get("cleaning_fee_amount")
            if mod_amount is None:
                mod_recommended = modified.get("recommended_action") or {}
                if isinstance(mod_recommended, dict):
                    mod_amount = mod_recommended.get("cleaning_fee_amount")
            if mod_amount is not None:
                amount = mod_amount

    if stamp == "APPROVED":
        amt_str = ""
        if isinstance(amount, (int, float)) and not isinstance(amount, bool):
            try:
                amt_f = float(amount)
                if math.isfinite(amt_f):
                    amt_str = f": SGD {amt_f:.2f}"
            except (TypeError, ValueError):
                pass
        return f"{case_id} · Cleaning fee approved{amt_str}"
    elif stamp == "REJECTED":
        return f"{case_id} · Cleaning fee rejected"
    elif stamp == "UNDER_REVIEW":
        return f"{case_id} · Escalated for human review"
    else:
        return f"{case_id} · Analysis pending"


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

def _build_receipt_line(case: dict) -> str | None:
    """Line a: receipt info."""
    receipts = (case.get("dispute_claim") or {}).get("receipt_evidence")
    if not isinstance(receipts, list) or not receipts:
        ds = case.get("data_sources") or {}
        receipts = ds.get("receipt_evidence")
        if not isinstance(receipts, list) or not receipts:
            return None

    for r in receipts:
        if not isinstance(r, dict):
            continue
        ocr = r.get("ocr_result")
        if isinstance(ocr, dict) and ocr:
            amount = ocr.get("amount")
            merchant = ocr.get("merchant_name", "")
            rdate = ocr.get("receipt_date", "")

            # Validate amount
            if not isinstance(amount, (int, float)) or isinstance(amount, bool):
                continue
            try:
                amt_f = float(amount)
                if not math.isfinite(amt_f):
                    continue
            except (TypeError, ValueError):
                continue

            amt_str = f"SGD {amt_f:.2f}"
            sub = []
            if merchant:
                sub.append(str(merchant))
            if rdate:
                dt = parse_ts(rdate)
                if dt:
                    sub.append(dt.strftime("%d %b %H:%M"))

            if sub:
                return f"Receipt {amt_str} ({', '.join(sub)})"
            return f"Receipt {amt_str}"

    # Receipts exist but none readable
    return "Receipt could not be read"


def _build_photo_line(case: dict, image: dict) -> str | None:
    """Line b: photo checks."""
    # Known matches (recycled photo)
    known_matches = image.get("known_matches")
    if isinstance(known_matches, dict) and known_matches:
        for _hash, prior_case in known_matches.items():
            if prior_case:
                return f"Recycled photo: matches prior case {prior_case}"

    # EXIF timestamp + trip_end_time
    exif_ts = image.get("exif_timestamp")
    if isinstance(exif_ts, str) and exif_ts:
        ds = case.get("data_sources") or {}
        trip_end = trip_end_time(ds)
        if trip_end is not None:
            exif_dt = parse_ts(exif_ts)
            if exif_dt is not None:
                _pol = policy_params("POL-4", {
                    "photo_window_min_after_trip_end": 30,
                    "photo_location_radius_m": 500,
                })
                _max_after = _pol.get("photo_window_min_after_trip_end", 30)
                _max_m = _pol.get("photo_location_radius_m", 500)
                w = check_window(exif_dt, trip_end, max_after=_max_after, unit="minutes")
                if w["seconds"] is not None:
                    secs = w["seconds"]
                    word = "before" if secs < 0 else "after"
                    line = f"Photo {format_gap(abs(secs))} {word} drop-off"

                    # GPS distance
                    exif_gps = image.get("exif_gps_location")
                    dropoff = (ds.get("trip_data") or {}).get("dropoff_location")
                    if (
                        isinstance(exif_gps, dict)
                        and isinstance(dropoff, dict)
                    ):
                        d = check_distance(exif_gps, dropoff, max_m=_max_m)
                        if d["text"] != "not available":
                            line += f", {d['text']} from drop-off"

                    return line
    elif not exif_ts:
        return "Photo has no time/location data"

    return None


def _build_account_action_line(case: dict) -> str | None:
    """Line c: account action."""
    jv = case.get("judge_verdict") or {}
    action = jv.get("recommended_action") or {}
    account_action = action.get("account_action")
    penalty_target = action.get("penalty_target")

    if isinstance(account_action, str) and account_action and account_action != "NONE":
        parts = [account_action]
        if isinstance(penalty_target, str) and penalty_target and penalty_target != "NONE":
            parts.append(f"({penalty_target.lower()})")
        parts.append("pending human confirmation")
        return " ".join(parts)

    return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_verdict_render_args(case: dict, image_id: str) -> dict | None:
    """Build kwargs for ``render_verdict_image`` from a case dict.

    Returns ``None`` if *image_id* is not found in the case's
    ``image_evidence`` list (checked in ``dispute_claim`` then
    ``data_sources``).
    """
    image = _find_image(case, image_id)
    if image is None:
        return None

    # regions
    regions_raw = image.get("stain_regions")
    regions: list[dict[str, float]] = []
    if isinstance(regions_raw, list):
        for box in regions_raw:
            if not isinstance(box, dict):
                continue
            x1 = box.get("x1")
            y1 = box.get("y1")
            x2 = box.get("x2")
            y2 = box.get("y2")
            try:
                fx1, fy1, fx2, fy2 = float(x1), float(y1), float(x2), float(y2)
                if (
                    math.isfinite(fx1) and math.isfinite(fy1)
                    and math.isfinite(fx2) and math.isfinite(fy2)
                    and 0 <= fx1 < fx2 <= 1
                    and 0 <= fy1 < fy2 <= 1
                ):
                    regions.append({"x1": fx1, "y1": fy1, "x2": fx2, "y2": fy2})
            except (TypeError, ValueError):
                continue

    # region_label from provider_result
    region_label: str | None = None
    pr = image.get("provider_result")
    if isinstance(pr, dict) and pr:
        classification = pr.get("stain_damage_classification")
        severity = pr.get("damage_severity")
        if isinstance(classification, str) and classification:
            label_parts = [classification]
            if isinstance(severity, str) and severity:
                label_parts.append(severity)
            region_label = " · ".join(label_parts)

    # stamp & title
    stamp, stamp_sub = _resolve_stamp(case)
    title = _resolve_title(case, stamp)

    # lines (max 3)
    lines: list[str] = []
    receipt_line = _build_receipt_line(case)
    if receipt_line:
        lines.append(receipt_line)
    photo_line = _build_photo_line(case, image)
    if photo_line:
        lines.append(photo_line)
    account_line = _build_account_action_line(case)
    if account_line:
        lines.append(account_line)

    return {
        "stamp": stamp,
        "stamp_sub": stamp_sub,
        "regions": regions,
        "region_label": region_label,
        "title": title,
        "lines": lines[:3],
    }
