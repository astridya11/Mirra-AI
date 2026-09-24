from datetime import datetime, timezone
from typing import Any

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


def generate_prosecutor_report(data: dict[str, Any]) -> dict[str, Any]:
    """Produce a ProsecutorReport conforming to shared/schemas.json definitions.

    Policy eligibility is sourced only from the backend-owned policy registry
    (app.services.verification.policy) — there is no way to pass policy
    thresholds into this function from an API caller.
    """
    checks = [
        check_arrival_time_verification(data),
        check_waiting_duration(data),
        check_pickup_gps_consistency(data),
        check_communication_attempts(data),
        check_cancellation_timestamp(data),
        check_event_ordering(data),
        check_missing_gps_records(data),
        check_contradictory_timestamps(data),
        check_policy_eligibility(data),
    ]

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
    rider_messages = [m for m in chat_transcript if m.get("sender") in ("rider", "RIDER")]
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
    summary_parts = [
        f"Prosecutor audit completed for no-show cancellation dispute.",
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