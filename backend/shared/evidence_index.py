"""
Shared evidence-index builder.

Gives every piece of evidence a stable ID that matches how P3's prosecutor
numbers evidence, so advocates can cite evidence in Round 1 — before the
prosecutor has run.  The input data is treated as read-only.

Indexed evidence types: GPS telemetry (actual/optimal route + summary),
APP_EVENT, CHAT_LOG, TRIP-DATA, PAYMENT-DATA, HISTORICAL_PROFILE, IMAGE
(image_evidence), and RECEIPT (receipt_evidence).
"""

from typing import Any


# --- Helpers ------------------------------------------------------------------


def _ts_short(ts: str | None) -> str:
    """Return the time portion of an ISO timestamp, or the raw value."""
    if not ts:
        return "?"
    # "2026-09-13T08:43:05+08:00" -> "08:43:05"
    try:
        return ts.split("T")[1][:8]
    except (IndexError, AttributeError):
        return str(ts)


def _ts_full(ts: str | None) -> str:
    """Return the full date+time of an ISO timestamp, or the raw value.

    ``"2026-08-30T15:12:00+08:00"`` -> ``"2026-08-30 15:12:00"``.
    Falls back to the raw string when parsing fails.
    """
    if not ts:
        return "?"
    try:
        date_part, time_part = ts.split("T", 1)
        return f"{date_part} {time_part[:8]}"
    except (IndexError, AttributeError, ValueError):
        return str(ts)


# --- Main entry point ---------------------------------------------------------


def build_evidence_index(data_sources: dict) -> dict[str, dict]:
    """
    Build a stable evidence index from data_sources.

    Returns ``{evidence_id: {"source_type": str, "description": str}}``.

    The input dict is **not** modified — no keys are added to the items.
    Missing sections are silently skipped.

    Indexed sections: gps_telemetry (actual_route, optimal_route,
    ROUTE-SUMMARY), app_events, chat_communication, trip_data (TRIP-DATA),
    payment_fare_data (PAYMENT-DATA), historical_profiles (PROFILE-*),
    image_evidence (IMAGE), and receipt_evidence (RECEIPT).
    """
    index: dict[str, dict] = {}

    # --- GPS telemetry: actual_route ---
    gps = data_sources.get("gps_telemetry", {})
    for i, pt in enumerate(gps.get("actual_route", [])):
        eid = pt.get("evidence_id") or f"GPS-{i:03d}"
        ts = _ts_short(pt.get("timestamp"))
        status = pt.get("status", "?")
        speed = pt.get("speed_kmh", "?")
        index[eid] = {
            "source_type": "GPS_TELEMETRY",
            "description": f"GPS point at {ts}, status {status}, speed {speed} km/h",
        }

    # --- GPS telemetry: optimal_route ---
    for i, pt in enumerate(gps.get("optimal_route", [])):
        eid = pt.get("evidence_id") or f"OPT-{i:03d}"
        ts = _ts_short(pt.get("timestamp"))
        speed = pt.get("speed_kmh", "?")
        index[eid] = {
            "source_type": "ROUTE_TRAJECTORY",
            "description": f"Optimal route point at {ts}, speed {speed} km/h",
        }

    # --- GPS telemetry: route summary ---
    deviation = gps.get("deviation_distance_km")
    actual_dur = gps.get("trip_duration_seconds")
    optimal_dur = gps.get("optimal_duration_seconds")
    stops = gps.get("unexpected_stops")
    if deviation is not None or actual_dur is not None or optimal_dur is not None or stops is not None:
        parts: list[str] = []
        if deviation is not None:
            parts.append(f"Deviation {deviation} km")
        if actual_dur is not None:
            parts.append(f"actual trip {actual_dur / 60:.0f} min")
        if optimal_dur is not None:
            parts.append(f"optimal {optimal_dur / 60:.0f} min")
        if stops is not None:
            parts.append(f"unexpected stops {len(stops)}")
        index["ROUTE-SUMMARY"] = {
            "source_type": "ROUTE_TRAJECTORY",
            "description": "; ".join(parts),
        }

    # --- App events ---
    for i, evt in enumerate(data_sources.get("app_events", [])):
        eid = evt.get("evidence_id") or f"EVT-{i:03d}"
        etype = evt.get("event_type", "unknown")
        ts = _ts_short(evt.get("timestamp"))
        details = evt.get("details", "")
        index[eid] = {
            "source_type": "APP_EVENT",
            "description": f"App event {etype} at {ts}: {details}",
        }

    # --- Chat transcript ---
    chat = data_sources.get("chat_communication", {})
    for i, msg in enumerate(chat.get("transcript", [])):
        mid = msg.get("message_id")
        eid = mid if mid else f"CHAT-GEN-{i:03d}"
        sender = msg.get("sender", "?")
        mtype = msg.get("type", "?")
        ts = _ts_short(msg.get("timestamp"))
        content = msg.get("content", "")
        index[eid] = {
            "source_type": "CHAT_LOG",
            "description": f"{sender} {mtype} at {ts}: {content}",
        }

    # --- Trip data ---
    trip = data_sources.get("trip_data")
    if trip:
        parts: list[str] = []
        pickup = trip.get("pickup_location", {})
        dropoff = trip.get("dropoff_location", {})
        if pickup.get("name"):
            parts.append(f"pickup {pickup['name']}")
        if dropoff.get("name"):
            parts.append(f"dropoff {dropoff['name']}")
        for key in ("driver_arrival_time", "cancellation_time", "scheduled_time", "trip_end_time"):
            val = trip.get(key)
            if val:
                parts.append(f"{key.replace('_', ' ')} {val}")
        index["TRIP-DATA"] = {
            "source_type": "APP_EVENT",
            "description": ", ".join(parts) if parts else "Trip metadata",
        }

    # --- Payment / fare data ---
    payment = data_sources.get("payment_fare_data")
    if payment:
        fare = payment.get("original_fare", {})
        total = fare.get("total_fare", "?")
        curr = fare.get("currency", "?")
        disputed = payment.get("disputed_amount", "?")
        disputed_curr = payment.get("disputed_amount_currency", curr)
        index["PAYMENT-DATA"] = {
            "source_type": "PAYMENT_RECORD",
            "description": (
                f"Total fare {total} {curr}, "
                f"disputed amount {disputed} {disputed_curr}"
            ),
        }

    # --- Historical profiles ---
    for profile in data_sources.get("historical_profiles", []):
        party = profile.get("party", "UNKNOWN")
        eid = f"PROFILE-{party}"
        age = profile.get("account_age_days", "?")
        trips = profile.get("total_trips", "?")
        rating = profile.get("avg_rating", "?")
        d30 = profile.get("dispute_history_30d", "?")
        d90 = profile.get("dispute_history_90d", "?")
        index[eid] = {
            "source_type": "HISTORICAL_PROFILE",
            "description": (
                f"{party}: account age {age} days, {trips} trips, "
                f"rating {rating}, disputes {d30}/30d {d90}/90d"
            ),
        }

    # --- Image evidence ---
    for i, img in enumerate(data_sources.get("image_evidence", [])):
        if not isinstance(img, dict):
            continue
        eid = img.get("image_id") or f"IMG-{i:03d}"
        parts: list[str] = ["Photo submitted"]

        exif_ts = img.get("exif_timestamp")
        if exif_ts:
            parts.append(f"EXIF time {_ts_full(exif_ts)}")

        loc = img.get("exif_gps_location")
        if isinstance(loc, dict) and loc.get("latitude") is not None and loc.get("longitude") is not None:
            parts.append(f"EXIF GPS {loc['latitude']}, {loc['longitude']}")

        pr = img.get("provider_result")
        if isinstance(pr, dict):
            classification = pr.get("stain_damage_classification")
            severity = pr.get("damage_severity")
            ai = pr.get("is_ai_generated")
            ai_conf = pr.get("ai_generated_confidence")
            provider_bits: list[str] = []
            if classification or severity:
                provider_bits.append(
                    f"provider: {classification or '?'} {severity or '?'}".rstrip()
                )
            if ai is not None:
                provider_bits.append(f"AI-generated {str(ai).lower()}")
                if ai_conf is not None:
                    provider_bits[-1] += f" (confidence {ai_conf})"
            if provider_bits:
                parts.append(", ".join(provider_bits))

        known = img.get("known_matches")
        if isinstance(known, dict) and known:
            case_ids = list(known.values())
            parts.append(f"image hash listed in known matches: {', '.join(str(c) for c in case_ids)}")

        desc = "; ".join(parts)
        if len(parts) <= 1:
            desc = "Photo submitted; no metadata available"

        index[eid] = {
            "source_type": "IMAGE",
            "description": desc,
        }

    # --- Receipt evidence ---
    for i, rcp in enumerate(data_sources.get("receipt_evidence", [])):
        if not isinstance(rcp, dict):
            continue
        eid = rcp.get("receipt_id") or f"RCP-{i:03d}"
        parts: list[str] = []

        uploaded = rcp.get("uploaded_at")
        if uploaded:
            parts.append(f"Receipt uploaded {_ts_full(uploaded)}")
        else:
            parts.append("Receipt uploaded")

        ocr = rcp.get("ocr_result")
        if isinstance(ocr, dict):
            ocr_bits: list[str] = []
            currency = ocr.get("currency")
            amount = ocr.get("amount")
            if currency and amount is not None:
                ocr_bits.append(f"{currency} {amount:.2f}")
            merchant = ocr.get("merchant_name")
            if merchant:
                ocr_bits.append(f"merchant {merchant}")
            receipt_date = ocr.get("receipt_date")
            if receipt_date:
                ocr_bits.append(f"dated {_ts_full(receipt_date)}")
            conf = ocr.get("ocr_confidence")
            if conf is not None:
                ocr_bits.append(f"OCR confidence {conf}")
            if ocr_bits:
                parts.append(f"OCR: {', '.join(ocr_bits)}")
            else:
                parts.append("OCR result unavailable (receipt could not be read)")
        else:
            parts.append("OCR result unavailable (receipt could not be read)")

        index[eid] = {
            "source_type": "RECEIPT",
            "description": "; ".join(parts),
        }

    return index


def format_evidence_for_prompt(index: dict[str, dict]) -> str:
    """
    Format the evidence index as one line per item, in insertion order.

    Format: ``<evidence_id> [<source_type>] <description>``
    """
    lines: list[str] = []
    for eid, entry in index.items():
        lines.append(f"{eid} [{entry['source_type']}] {entry['description']}")
    return "\n".join(lines)
