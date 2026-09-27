from datetime import datetime, timezone
from typing import Any, Callable

from .checks import (
    check_arrival_time_verification,
    check_cancellation_timestamp,
    check_communication_attempts,
    check_contradictory_timestamps,
    check_event_ordering,
    check_missing_gps_records,
    check_pickup_gps_consistency,
    check_policy_eligibility,
    check_waiting_duration,
)
from .checks_cleaning_fee import (
    check_cleaning_claim_amount_consistency,
    check_cleaning_claim_event_exists,
    check_cleaning_claim_submission_delay,
    check_cleaning_conflicting_party_accounts,
    check_cleaning_photo_reference_consistency,
    check_cleaning_structured_image_evidence,
)
from .checks_route_deviation import (
    check_driver_route_explanation_recorded,
    check_rider_route_objection_recorded,
    check_route_deviation_event_consistency,
    check_route_deviation_recorded,
    check_route_disputed_fare_context,
    check_route_duration_delta,
    check_route_endpoint_consistency,
    check_route_unexpected_stops,
)

CheckFn = Callable[[dict[str, Any]], dict[str, Any]]

NO_SHOW_CHECKS: list[CheckFn] = [
    check_arrival_time_verification,
    check_waiting_duration,
    check_pickup_gps_consistency,
    check_communication_attempts,
    check_cancellation_timestamp,
    check_event_ordering,
    check_missing_gps_records,
    check_contradictory_timestamps,
    check_policy_eligibility,
]

ROUTE_DEVIATION_CHECKS: list[CheckFn] = [
    check_route_deviation_recorded,
    check_route_deviation_event_consistency,
    check_route_duration_delta,
    check_route_endpoint_consistency,
    check_route_unexpected_stops,
    check_driver_route_explanation_recorded,
    check_rider_route_objection_recorded,
    check_route_disputed_fare_context,
]

CLEANING_FEE_CHECKS: list[CheckFn] = [
    check_cleaning_claim_event_exists,
    check_cleaning_claim_amount_consistency,
    check_cleaning_claim_submission_delay,
    check_cleaning_conflicting_party_accounts,
    check_cleaning_structured_image_evidence,
    check_cleaning_photo_reference_consistency,
]

CHECKS_BY_DISPUTE_TYPE: dict[str, list[CheckFn]] = {
    "NO_SHOW_CHARGE": NO_SHOW_CHECKS,
    "ROUTE_DEVIATION": ROUTE_DEVIATION_CHECKS,
    "CLEANING_FEE": CLEANING_FEE_CHECKS,
}

_SUMMARY_LABEL: dict[str, str] = {
    "NO_SHOW_CHARGE": "no-show cancellation dispute",
    "ROUTE_DEVIATION": "route deviation dispute",
    "CLEANING_FEE": "cleaning fee dispute",
}


def generate_prosecutor_report(data: dict[str, Any]) -> dict[str, Any]:
    """Produce a ProsecutorReport conforming to shared/schemas.json definitions.

    Deterministic checks are selected by case_metadata.dispute_type via
    CHECKS_BY_DISPUTE_TYPE. Policy eligibility (within NO_SHOW_CHECKS) is
    sourced only from the backend-owned policy registry
    (app.services.verification.policy) — there is no way to pass policy
    thresholds into this function from an API caller.
    """
    dispute_type = data.get("case_metadata", {}).get("dispute_type")
    check_fns = CHECKS_BY_DISPUTE_TYPE.get(dispute_type, [])
    checks = [fn(data) for fn in check_fns]

    verified_facts: list[dict[str, Any]] = []
    disputed_facts: list[dict[str, Any]] = []
    missing_facts: list[dict[str, Any]] = []

    counters = {"VERIFIED": 0, "DISPUTED": 0, "MISSING": 0}

    for check in checks:
        status = check["status"]
        counters[status] += 1
        fact_id = f"F-{status[:3].upper()}-{counters[status]:03d}"

        fact: dict[str, Any] = {
            "fact_id": fact_id,
            "description": check["description"],
            "supporting_evidence": check["evidence_refs"],
        }
        details = check.get("details", {})
        if details.get("party_relevance"):
            fact["party_relevance"] = details["party_relevance"]
        if details.get("policy_clause_reference"):
            fact["policy_clause_reference"] = details["policy_clause_reference"]
        if details.get("confidence_level") is not None:
            fact["confidence_level"] = details["confidence_level"]

        if status == "VERIFIED":
            verified_facts.append(fact)
        elif status == "DISPUTED":
            disputed_facts.append(fact)
        else:
            missing_facts.append(fact)

    # Supplementary missing fact: rider perspective
    chat_transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])
    if not isinstance(chat_transcript, list):
        chat_transcript = []
    rider_messages = [
        m for m in chat_transcript if isinstance(m, dict) and m.get("sender") in ("rider", "RIDER")
    ]
    if not rider_messages:
        missing_facts.append({
            "fact_id": f"F-MIS-{counters['MISSING'] + 1:03d}",
            "description": (
                "No rider communication or response is recorded in the evidence. "
                "The rider's perspective is absent from the case record."
            ),
            "supporting_evidence": [],
            "party_relevance": "RIDER",
        })
        counters["MISSING"] += 1

    total_checks = len(checks)
    verified_count = len(verified_facts)
    label = _SUMMARY_LABEL.get(dispute_type, "dispute")
    summary_parts = [
        f"Prosecutor audit completed for {label}.",
        f"{verified_count} of {total_checks} evidentiary checks verified.",
    ]
    if disputed_facts:
        summary_parts.append(f"{len(disputed_facts)} item(s) disputed.")
    if missing_facts:
        summary_parts.append(f"{len(missing_facts)} item(s) missing or unresolved.")

    return {
        "verified_facts": verified_facts,
        "disputed_facts": disputed_facts,
        "missing_facts": missing_facts,
        "prosecutor_summary": " ".join(summary_parts),
        "report_submitted_at": datetime.now(timezone.utc).isoformat(),
    }