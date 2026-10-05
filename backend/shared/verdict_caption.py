"""Build render arguments for ``render_verdict_image`` from a case dict.

This module reads only the case file (``backend/disputes/{case_id}.json``
structure) and returns kwargs suitable for ``render_verdict_image``.

It never raises on missing/odd fields — all ``get`` calls default safely.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

_SGT = timezone(timedelta(hours=8))


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


def _parse_ts(ts: str) -> datetime | None:
    if not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Stamp & title
# ---------------------------------------------------------------------------

def _resolve_stamp(case: dict) -> tuple[str | None, str]:
    """Determine stamp and stamp_sub from judge_verdict / human review.

    Returns ``(stamp, stamp_sub)``.
    stamp: "APPROVED", "REJECTED", "UNDER_REVIEW", or None.
    stamp_sub: "MIRRA AI · <DD MON YYYY>" or "PENDING HUMAN CONFIRMATION".
    """
    jv = case.get("judge_verdict") or {}

    # Check for human review outcome
    ep = jv.get("execution_payload") or {}
    hc = ep.get("human_confirmation_details") or {}
    human_decision = hc.get("approval_decision") or ""

    ruling_type = jv.get("ruling_type") or ""

    # If human reviewed with modified action, use the modified ruling_type
    if human_decision:
        modified = hc.get("modified_action") or {}
        if isinstance(modified, dict) and modified.get("ruling_type"):
            ruling_type = modified["ruling_type"]

    deliberated_at = jv.get("deliberated_at") or ""

    # Determine if case is routed to human review and no human decision yet
    is_pending_human = (
        ruling_type == "ESCALATED"
        and not human_decision
    )

    # stamp
    stamp: str | None = None
    if ruling_type in ("APPROVED", "PARTIAL_REFUND"):
        stamp = "APPROVED"
    elif ruling_type == "REJECTED":
        stamp = "REJECTED"
    elif ruling_type == "ESCALATED":
        if human_decision == "REJECTED_AUTO":
            stamp = "REJECTED"
        elif human_decision in ("CONFIRMED_AUTO", "MODIFIED", "OVERRIDDEN"):
            if ruling_type in ("APPROVED", "PARTIAL_REFUND"):
                stamp = "APPROVED"
            elif ruling_type == "REJECTED":
                stamp = "REJECTED"
            else:
                stamp = "UNDER_REVIEW"
        else:
            stamp = "UNDER_REVIEW"

    # stamp_sub
    if is_pending_human:
        stamp_sub = "PENDING HUMAN CONFIRMATION"
    elif deliberated_at:
        dt = _parse_ts(deliberated_at)
        if dt:
            stamp_sub = "MIRRA AI · " + dt.strftime("%d %b %Y").upper()
        else:
            stamp_sub = "MIRRA AI"
    else:
        stamp_sub = "MIRRA AI"

    return stamp, stamp_sub


def _resolve_title(case: dict, stamp: str | None) -> str:
    """Build the title string."""
    case_id = (case.get("case_metadata") or {}).get("case_id") or (case.get("dispute_claim") or {}).get("case_id") or ""
    jv = case.get("judge_verdict") or {}
    action = jv.get("recommended_action") or {}
    amount = action.get("cleaning_fee_amount")

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
        return f"{case_id} · Under human review"
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
                dt = _parse_ts(rdate)
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
        trip_data = (case.get("data_sources") or {}).get("trip_data") or {}
        trip_end_str = trip_data.get("trip_end_time")
        if isinstance(trip_end_str, str) and trip_end_str:
            trip_end = _parse_ts(trip_end_str)
            if trip_end:
                exif_dt = _parse_ts(exif_ts)
                if exif_dt:
                    delta_min = int((exif_dt - trip_end).total_seconds() / 60)
                    line = f"Photo {delta_min} min after drop-off"

                    # GPS distance
                    exif_gps = image.get("exif_gps_location")
                    dropoff = trip_data.get("dropoff_location")
                    if (
                        isinstance(exif_gps, dict)
                        and isinstance(dropoff, dict)
                    ):
                        try:
                            lat1 = float(exif_gps.get("latitude"))
                            lon1 = float(exif_gps.get("longitude"))
                            lat2 = float(dropoff.get("lat"))
                            lon2 = float(dropoff.get("lng"))
                            dist_m = _haversine_m(lat1, lon1, lat2, lon2)
                            dist_rounded = round(dist_m / 10) * 10
                            line += f", {dist_rounded} m from drop-off"
                        except (TypeError, ValueError):
                            pass

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
