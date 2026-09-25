"""
Deterministic policy engine for the MIRRA AI dispute system.

All monetary / threshold numbers come from code (the policy file), never from
the LLM.  Agents use these results as ground-truth facts.
"""

import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

# --- Policy file loading -------------------------------------------------------

# Resolve the policy JSON relative to this file so the engine works regardless
# of the current working directory.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_POLICY_FILE = _BACKEND_DIR / "policy" / "ryde_policy_v1.json"

# Fallback clause IDs for unknown dispute types.
_FALLBACK_CLAUSE_IDS = ["POL-1", "POL-6", "POL-7", "POL-9"]


@lru_cache(maxsize=1)
def load_policy() -> dict:
    """Load and cache the policy JSON file (cached via lru_cache)."""
    with open(_POLICY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def policy_version() -> str:
    """Return the policy version string."""
    return load_policy()["policy_version"]


def clauses_for(dispute_type: str) -> dict:
    """
    Return {clause_id: clause} for the given dispute type using the
    dispute_type_clause_map.  Unknown types fall back to POL-1, POL-6, POL-7,
    POL-9.
    """
    policy = load_policy()
    clause_map = policy["dispute_type_clause_map"]
    clauses = policy["clauses"]

    clause_ids = clause_map.get(dispute_type, _FALLBACK_CLAUSE_IDS)
    return {cid: clauses[cid] for cid in clause_ids}


# --- Helpers --------------------------------------------------------------------


def _parse_iso(ts: str) -> datetime:
    """Parse an ISO-8601 timestamp (with timezone) into a datetime."""
    return datetime.fromisoformat(ts)


# --- Calculators ---------------------------------------------------------------


def calc_route_deviation(data_sources: dict) -> dict:
    """
    POL-2: Route Deviation and Fare Adjustment.

    Computes deviation distance, extra time, review trigger, and the refund
    amount if no valid reason is verified (capped at total fare).
    """
    policy = load_policy()
    params = policy["clauses"]["POL-2"]["params"]
    review_trigger = params["review_trigger"]
    rate_per_km = params["rate_per_km"]
    rate_per_minute = params["rate_per_minute"]

    gps = data_sources.get("gps_telemetry", {})
    payment = data_sources.get("payment_fare_data", {})
    original_fare = payment.get("original_fare", {})
    total_fare = original_fare.get("total_fare")

    deviation_km = gps.get("deviation_distance_km")
    trip_duration = gps.get("trip_duration_seconds")
    optimal_duration = gps.get("optimal_duration_seconds")

    # Cannot compute if durations are missing or optimal is zero.
    if trip_duration is None or optimal_duration is None or optimal_duration == 0:
        return {
            "computable": False,
            "reason": (
                "Missing trip_duration_seconds / optimal_duration_seconds "
                "or optimal_duration_seconds is zero"
            ),
            "clause": "POL-2",
        }

    extra_minutes = max(0.0, (trip_duration - optimal_duration) / 60)
    extra_time_pct = (trip_duration - optimal_duration) / optimal_duration * 100

    min_deviation_km = review_trigger["min_deviation_km"]
    min_extra_time_pct = review_trigger["min_extra_time_pct"]

    review_triggered = (
        deviation_km > min_deviation_km or extra_time_pct > min_extra_time_pct
    )

    # Refund = deviation_km * rate_per_km + extra_minutes * rate_per_minute,
    # capped at total_fare.
    raw_refund = deviation_km * rate_per_km + extra_minutes * rate_per_minute
    refund = round(raw_refund, 2)
    if total_fare is not None:
        refund = min(refund, total_fare)

    formula = (
        f"round({deviation_km} * {rate_per_km} + {extra_minutes:.2f} * "
        f"{rate_per_minute}, 2) = {refund}"
    )

    return {
        "computable": True,
        "clause": "POL-2",
        "deviation_km": deviation_km,
        "extra_minutes": round(extra_minutes, 2),
        "extra_time_pct": round(extra_time_pct, 2),
        "review_triggered": review_triggered,
        "refund_if_no_valid_reason": refund,
        "refund_cap": total_fare,
        "formula": formula,
    }


def calc_no_show(data_sources: dict) -> dict:
    """
    POL-3: No-Show Cancellation Charge.

    Computes minutes waited from driver arrival to cancellation, whether the
    no-show threshold is met, driver contact attempts, and whether the rider
    was notified of arrival.
    """
    policy = load_policy()
    params = policy["clauses"]["POL-3"]["params"]

    no_show_threshold_min = params["no_show_threshold_min"]
    cancellation_fee = params["cancellation_fee"]

    trip_data = data_sources.get("trip_data", {})
    arrival_time = trip_data.get("driver_arrival_time")
    cancel_time = trip_data.get("cancellation_time")

    # Cannot compute if either timestamp is missing.
    if not arrival_time or not cancel_time:
        return {
            "computable": False,
            "reason": "Missing driver_arrival_time or cancellation_time",
            "clause": "POL-3",
        }

    arrival_dt = _parse_iso(arrival_time)
    cancel_dt = _parse_iso(cancel_time)
    minutes_waited_from_arrival = (cancel_dt - arrival_dt).total_seconds() / 60

    threshold_met = minutes_waited_from_arrival >= no_show_threshold_min

    # Count driver contact attempts (messages or calls from the driver).
    chat = data_sources.get("chat_communication", {})
    transcript = chat.get("transcript", [])
    driver_contact_attempts = sum(
        1
        for m in transcript
        if m.get("sender") == "driver" and m.get("type") in ("message", "call")
    )

    # Whether a rider_notified event exists in app_events.
    app_events = data_sources.get("app_events", [])
    rider_notified_event_found = any(
        ev.get("event_type") == "rider_notified" for ev in app_events
    )

    return {
        "computable": True,
        "clause": "POL-3",
        "minutes_waited_from_arrival": round(minutes_waited_from_arrival, 2),
        "no_show_threshold_min": no_show_threshold_min,
        "threshold_met": threshold_met,
        "driver_contact_attempts": driver_contact_attempts,
        "rider_notified_event_found": rider_notified_event_found,
        "cancellation_fee": cancellation_fee,
        "refund_if_fee_reversed": cancellation_fee,
    }


def calc_cleaning_fee(data_sources: dict, bonus_modules: dict | None) -> dict:
    """
    POL-4: Cleaning Fee Claims.

    Computes claimed amount, verified severity (from bonus image-EXIF
    analysis), severity cap, max chargeable, and the time between trip
    completion and the cleaning-fee claim.
    """
    policy = load_policy()
    params = policy["clauses"]["POL-4"]["params"]

    severity_caps: dict = params["severity_caps"]
    always_requires_human: bool = params["always_requires_human"]

    payment = data_sources.get("payment_fare_data", {})
    claimed_amount = payment.get("disputed_amount")

    # Verified severity from bonus image-EXIF analyses (if present).
    verified_severity: str | None = None
    if bonus_modules:
        exif_analyses = bonus_modules.get("image_exif_analyses")
        if exif_analyses:
            for item in exif_analyses:
                sev = item.get("damage_severity")
                if sev in severity_caps:
                    verified_severity = sev
                    break

    severity_cap = severity_caps.get(verified_severity) if verified_severity else None

    # Max chargeable = min(claimed, severity_cap), or None if either missing.
    if claimed_amount is not None and severity_cap is not None:
        max_chargeable = min(claimed_amount, severity_cap)
    else:
        max_chargeable = None

    # Time between trip_completed and cleaning_fee_claimed app events.
    app_events = data_sources.get("app_events", [])
    trip_completed_ts: str | None = None
    cleaning_fee_claimed_ts: str | None = None
    for ev in app_events:
        etype = ev.get("event_type")
        if etype == "trip_completed":
            trip_completed_ts = ev.get("timestamp")
        elif etype == "cleaning_fee_claimed":
            cleaning_fee_claimed_ts = ev.get("timestamp")

    claim_filed_minutes_after_trip_end: float | None = None
    if trip_completed_ts and cleaning_fee_claimed_ts:
        completed_dt = _parse_iso(trip_completed_ts)
        claimed_dt = _parse_iso(cleaning_fee_claimed_ts)
        claim_filed_minutes_after_trip_end = (
            (claimed_dt - completed_dt).total_seconds() / 60
        )

    return {
        "computable": True,
        "clause": "POL-4",
        "claimed_amount": claimed_amount,
        "verified_severity": verified_severity,
        "severity_cap": severity_cap,
        "max_chargeable": max_chargeable,
        "claim_filed_minutes_after_trip_end": (
            round(claim_filed_minutes_after_trip_end, 2)
            if claim_filed_minutes_after_trip_end is not None
            else None
        ),
        "always_requires_human": always_requires_human,
    }


# --- Dispatcher ----------------------------------------------------------------


def compute_policy_values(dispute_type: str, context: dict) -> dict:
    """
    Dispatch to the right calculator based on dispute_type.

    ``context`` must contain ``data_sources`` (and optionally ``bonus_modules``
    for cleaning-fee cases).  Unknown dispute types return computable False.
    """
    data_sources: dict = context.get("data_sources", {})
    bonus_modules: dict | None = context.get("bonus_modules")

    if dispute_type == "ROUTE_DEVIATION":
        return calc_route_deviation(data_sources)

    if dispute_type == "NO_SHOW_CHARGE":
        return calc_no_show(data_sources)

    if dispute_type == "CLEANING_FEE":
        return calc_cleaning_fee(data_sources, bonus_modules)

    # Unknown dispute type.
    return {
        "computable": False,
        "reason": f"Unknown dispute_type: {dispute_type}",
    }


# --- Manual test ---------------------------------------------------------------


def _load_mock_case(case_id: str) -> dict:
    """Load a mock data JSON file by case id (e.g. DISP-001)."""
    mock_dir = _BACKEND_DIR / "mock_data"
    path = mock_dir / f"{case_id}.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    for case_id in ("DISP-001", "DISP-002"):
        case = _load_mock_case(case_id)
        dispute_type = case["case_metadata"]["dispute_type"]
        context = {"data_sources": case["data_sources"]}
        result = compute_policy_values(dispute_type, context)
        print(f"\n{'='*60}")
        print(f"{case_id}  dispute_type={dispute_type}")
        print(f"{'='*60}")
        print(json.dumps(result, indent=2, ensure_ascii=False))
