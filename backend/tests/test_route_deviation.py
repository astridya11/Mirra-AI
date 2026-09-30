"""Tests for P3 ROUTE_DEVIATION deterministic evidence checks and the
dispute-type dispatch scaffolding in report.py.

Covers: dispute dispatch selects the correct check list, each Route check's
VERIFIED/DISPUTED/MISSING behavior (including malformed-input safety and
trust-boundary wording), and a DISP-002 (NO_SHOW_CHARGE) regression suite
proving the fixed check list, fact IDs, and summary text are unchanged.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

# Path setup so backend.* imports resolve when pytest runs from backend/.
_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

import pytest

from app.services.verification.checks_route_deviation import (
    check_driver_route_explanation_recorded,
    check_rider_route_objection_recorded,
    check_route_deviation_event_consistency,
    check_route_deviation_recorded,
    check_route_disputed_fare_context,
    check_route_duration_delta,
    check_route_endpoint_consistency,
    check_route_unexpected_stops,
)
from app.services.verification.ingestion import load_case_data, normalize_evidence
from app.services.verification.report import (
    CHECKS_BY_DISPUTE_TYPE,
    NO_SHOW_CHECKS,
    ROUTE_DEVIATION_CHECKS,
    generate_prosecutor_report,
)
from backend.agents.prosecutor_agent import run_prosecutor_audit
from backend.shared.evidence_index import build_evidence_index


@pytest.fixture
def disp001_data():
    return normalize_evidence(load_case_data("DISP-001"))


@pytest.fixture
def disp002_data():
    return normalize_evidence(load_case_data("DISP-002"))


def _all_facts(report: dict[str, Any]) -> list[dict[str, Any]]:
    return report["verified_facts"] + report["disputed_facts"] + report["missing_facts"]


# ---------------------------------------------------------------------------
# 1. Dispatch selects Route checks for DISP-001
# ---------------------------------------------------------------------------
def test_dispatch_selects_route_checks_for_disp001(disp001_data):
    assert CHECKS_BY_DISPUTE_TYPE["ROUTE_DEVIATION"] is ROUTE_DEVIATION_CHECKS
    report = generate_prosecutor_report(disp001_data)
    assert len(_all_facts(report)) == len(ROUTE_DEVIATION_CHECKS)


# ---------------------------------------------------------------------------
# 2. No NO_SHOW-specific noise in the DISP-001 report
# ---------------------------------------------------------------------------
def test_disp001_report_has_no_no_show_noise(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "driver arrival" not in all_text
    assert "cancellation" not in all_text
    assert "waiting duration" not in all_text
    assert "no-show" not in all_text


# ---------------------------------------------------------------------------
# 3. Deviation 2.3 km recorded
# ---------------------------------------------------------------------------
def test_deviation_recorded_verified(disp001_data):
    result = check_route_deviation_recorded(disp001_data)
    assert result["status"] == "VERIFIED"
    assert "2.3" in result["description"]
    assert result["evidence_refs"][0]["evidence_id"] == "ROUTE-SUMMARY"


def test_deviation_recorded_missing_when_absent():
    data = {"data_sources": {"gps_telemetry": {}}}
    result = check_route_deviation_recorded(data)
    assert result["status"] == "MISSING"


def test_deviation_recorded_disputed_when_negative():
    data = {"data_sources": {"gps_telemetry": {"deviation_distance_km": -1.0}}}
    result = check_route_deviation_recorded(data)
    assert result["status"] == "DISPUTED"


def test_deviation_recorded_disputed_when_zero():
    data = {"data_sources": {"gps_telemetry": {"deviation_distance_km": 0}}}
    result = check_route_deviation_recorded(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 4. Deviation event consistency — real fixture
# ---------------------------------------------------------------------------
def test_deviation_event_consistency_verified(disp001_data):
    result = check_route_deviation_event_consistency(disp001_data)
    assert result["status"] == "VERIFIED"
    ids = {e["evidence_id"] for e in result["evidence_refs"]}
    assert ids.issuperset({"EVT-000", "EVT-001", "EVT-002"})


# ---------------------------------------------------------------------------
# 5. Event before trip start -> DISPUTED
# ---------------------------------------------------------------------------
def test_deviation_event_before_trip_start_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    events = data["data_sources"]["app_events"]
    for e in events:
        if e["event_type"] == "route_deviation_detected":
            e["timestamp"] = "2026-09-22T13:00:00+08:00"  # before trip_started (13:30)
    result = check_route_deviation_event_consistency(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 6. Event after trip completion -> DISPUTED
# ---------------------------------------------------------------------------
def test_deviation_event_after_trip_completion_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    events = data["data_sources"]["app_events"]
    for e in events:
        if e["event_type"] == "route_deviation_detected":
            e["timestamp"] = "2026-09-22T15:00:00+08:00"  # after trip_completed (14:05)
    result = check_route_deviation_event_consistency(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 7. Missing deviation event with positive deviation -> MISSING
# ---------------------------------------------------------------------------
def test_deviation_event_missing_with_positive_deviation(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["app_events"] = [
        e for e in data["data_sources"]["app_events"] if e["event_type"] != "route_deviation_detected"
    ]
    result = check_route_deviation_event_consistency(data)
    assert result["status"] == "MISSING"


def test_deviation_event_consistency_missing_without_deviation():
    data = {"data_sources": {"gps_telemetry": {}, "app_events": []}}
    result = check_route_deviation_event_consistency(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 8. Duration delta = 420 seconds
# ---------------------------------------------------------------------------
def test_duration_delta_420_seconds(disp001_data):
    result = check_route_duration_delta(disp001_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["duration_delta_seconds"] == 420
    assert "2100" in result["description"]
    assert "1680" in result["description"]
    assert "420" in result["description"]


# ---------------------------------------------------------------------------
# 9. Negative duration safe (DISPUTED, not a crash)
# ---------------------------------------------------------------------------
def test_duration_delta_negative_safe(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["trip_duration_seconds"] = -100
    result = check_route_duration_delta(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 10. Missing optimal duration -> MISSING
# ---------------------------------------------------------------------------
def test_duration_delta_missing_optimal(disp001_data):
    data = copy.deepcopy(disp001_data)
    del data["data_sources"]["gps_telemetry"]["optimal_duration_seconds"]
    result = check_route_duration_delta(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 11. Endpoint consistency passes current fixture
# ---------------------------------------------------------------------------
def test_endpoint_consistency_verified(disp001_data):
    result = check_route_endpoint_consistency(disp001_data)
    assert result["status"] == "VERIFIED"


# ---------------------------------------------------------------------------
# 12. Bad start endpoint -> DISPUTED
# ---------------------------------------------------------------------------
def test_endpoint_consistency_bad_start_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["trip_data"]["pickup_location"] = {"name": "Somewhere Else", "lat": 1.5, "lng": 104.5}
    result = check_route_endpoint_consistency(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 13. Bad end endpoint -> DISPUTED
# ---------------------------------------------------------------------------
def test_endpoint_consistency_bad_end_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["trip_data"]["dropoff_location"] = {"name": "Somewhere Else", "lat": 1.5, "lng": 104.5}
    result = check_route_endpoint_consistency(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 14. Empty actual route -> MISSING
# ---------------------------------------------------------------------------
def test_endpoint_consistency_empty_route_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["actual_route"] = []
    result = check_route_endpoint_consistency(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 15. unexpected_stops empty -> VERIFIED
# ---------------------------------------------------------------------------
def test_unexpected_stops_empty_verified(disp001_data):
    result = check_route_unexpected_stops(disp001_data)
    assert result["status"] == "VERIFIED"
    assert "No unexpected stops" in result["description"]


# ---------------------------------------------------------------------------
# 16. Unexpected stop present -> DISPUTED
# ---------------------------------------------------------------------------
def test_unexpected_stops_present_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["unexpected_stops"] = [{"lat": 1.3, "lng": 103.9, "duration_seconds": 300}]
    result = check_route_unexpected_stops(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 17. Missing unexpected_stops key -> MISSING
# ---------------------------------------------------------------------------
def test_unexpected_stops_missing_key(disp001_data):
    data = copy.deepcopy(disp001_data)
    del data["data_sources"]["gps_telemetry"]["unexpected_stops"]
    result = check_route_unexpected_stops(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 18/19. Driver explanation existence + no truth claim in wording
# ---------------------------------------------------------------------------
def test_driver_explanation_verified(disp001_data):
    result = check_driver_route_explanation_recorded(disp001_data)
    assert result["status"] == "VERIFIED"


def test_driver_explanation_wording_does_not_claim_truth(disp001_data):
    result = check_driver_route_explanation_recorded(disp001_data)
    description_lower = result["description"].lower()
    for forbidden in ("confirmed", "definitely", "true", "justified", "gps did reroute"):
        assert forbidden not in description_lower
    # Raw chat content must not be copied into the description.
    assert "auto-rerouted" not in description_lower


# ---------------------------------------------------------------------------
# 20. No driver chat -> MISSING
# ---------------------------------------------------------------------------
def test_driver_explanation_missing_without_chat(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["chat_communication"]["transcript"] = []
    result = check_driver_route_explanation_recorded(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 21. Rider objection -> VERIFIED
# ---------------------------------------------------------------------------
def test_rider_objection_verified(disp001_data):
    result = check_rider_route_objection_recorded(disp001_data)
    assert result["status"] == "VERIFIED"


def test_rider_objection_wording_does_not_claim_correctness(disp001_data):
    result = check_rider_route_objection_recorded(disp001_data)
    description_lower = result["description"].lower()
    for forbidden in ("correct", "confirmed", "true", "justified"):
        assert forbidden not in description_lower


# ---------------------------------------------------------------------------
# 22. No rider chat -> MISSING
# ---------------------------------------------------------------------------
def test_rider_objection_missing_without_chat(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["chat_communication"]["transcript"] = []
    result = check_rider_route_objection_recorded(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 23. Disputed fare SGD 3.25 -> VERIFIED, no causal overclaim
# ---------------------------------------------------------------------------
def test_disputed_fare_context_verified(disp001_data):
    result = check_route_disputed_fare_context(disp001_data)
    assert result["status"] == "VERIFIED"
    assert "SGD" in result["description"]
    assert "3.25" in result["description"]
    assert "caused" not in result["description"].lower()


# ---------------------------------------------------------------------------
# 24. Missing disputed amount -> MISSING
# ---------------------------------------------------------------------------
def test_disputed_fare_context_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    del data["data_sources"]["payment_fare_data"]["disputed_amount"]
    result = check_route_disputed_fare_context(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 25. Negative disputed amount -> DISPUTED
# ---------------------------------------------------------------------------
def test_disputed_fare_context_negative_disputed(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = -5.0
    result = check_route_disputed_fare_context(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 26. Report summary says "route deviation dispute"
# ---------------------------------------------------------------------------
def test_disp001_summary_says_route_deviation_dispute(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    assert "route deviation dispute" in report["prosecutor_summary"]
    assert "no-show" not in report["prosecutor_summary"].lower()


# ---------------------------------------------------------------------------
# 27. ProsecutorReport required keys present
# ---------------------------------------------------------------------------
def test_disp001_report_schema_keys_present(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    for key in ("verified_facts", "disputed_facts", "missing_facts", "prosecutor_summary", "report_submitted_at"):
        assert key in report
    for fact in _all_facts(report):
        assert "fact_id" in fact
        assert "description" in fact
        assert "supporting_evidence" in fact
        for ref in fact["supporting_evidence"]:
            assert {"evidence_id", "source_type", "description"} <= ref.keys()


# ---------------------------------------------------------------------------
# 28. No JudgeVerdict / confidence / recommended_action leakage
# ---------------------------------------------------------------------------
def test_disp001_report_no_judge_verdict_leakage(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    for forbidden_key in ("judge_verdict", "ruling_type", "confidence_score", "recommended_action"):
        assert forbidden_key not in report


# ---------------------------------------------------------------------------
# 29. Evidence references resolve against the shared build_evidence_index()
# ---------------------------------------------------------------------------
def test_disp001_evidence_refs_resolve_against_shared_index(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    index_ids = set(build_evidence_index(disp001_data["data_sources"]).keys())
    referenced_ids = {
        ref["evidence_id"]
        for fact in _all_facts(report)
        for ref in fact["supporting_evidence"]
    }
    assert referenced_ids
    assert referenced_ids.issubset(index_ids)


# ---------------------------------------------------------------------------
# 30. Malformed route values never crash
# ---------------------------------------------------------------------------
def test_malformed_route_values_never_crash():
    data = {
        "case_metadata": {"dispute_type": "ROUTE_DEVIATION"},
        "data_sources": {
            "gps_telemetry": {
                "deviation_distance_km": "not-a-number",
                "trip_duration_seconds": "also-not-a-number",
                "optimal_duration_seconds": None,
                "unexpected_stops": "not-a-list",
                "actual_route": [{"latitude": "bad", "longitude": None}, "not-a-dict"],
                "optimal_route": None,
            },
            "trip_data": {"pickup_location": "bad", "dropoff_location": None},
            "app_events": [{"event_type": "route_deviation_detected"}, "not-a-dict", None],
            "chat_communication": {"transcript": ["not-a-dict", {"sender": "driver"}]},
            "payment_fare_data": None,
        },
    }
    report = generate_prosecutor_report(data)  # must not raise
    assert "missing_facts" in report
    assert isinstance(report["prosecutor_summary"], str)


# ===========================================================================
# DISP-002 (NO_SHOW_CHARGE) regression — must be unaffected by dispatch
# ===========================================================================

_EXPECTED_DISP002_VERIFIED_IDS = [f"F-VER-{i:03d}" for i in range(1, 9)]
_EXPECTED_DISP002_MISSING_IDS = [f"F-MIS-{i:03d}" for i in range(1, 3)]
_EXPECTED_DISP002_SUMMARY = (
    "Prosecutor audit completed for no-show cancellation dispute. "
    "8 of 9 evidentiary checks verified. 2 item(s) missing or unresolved."
)


def test_disp002_dispatch_uses_unchanged_no_show_checks():
    assert CHECKS_BY_DISPUTE_TYPE["NO_SHOW_CHARGE"] is NO_SHOW_CHECKS
    assert len(NO_SHOW_CHECKS) == 9


# 31. verified_facts equivalent
def test_disp002_verified_facts_unchanged(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert [f["fact_id"] for f in report["verified_facts"]] == _EXPECTED_DISP002_VERIFIED_IDS
    assert len(report["verified_facts"]) == 8


# 32. disputed_facts equivalent
def test_disp002_disputed_facts_unchanged(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert report["disputed_facts"] == []


# 33. missing_facts equivalent
def test_disp002_missing_facts_unchanged(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert [f["fact_id"] for f in report["missing_facts"]] == _EXPECTED_DISP002_MISSING_IDS
    assert len(report["missing_facts"]) == 2


# 34. fact IDs equivalent (combined, exact set)
def test_disp002_fact_ids_unchanged(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    all_ids = [f["fact_id"] for f in _all_facts(report)]
    assert all_ids == _EXPECTED_DISP002_VERIFIED_IDS + _EXPECTED_DISP002_MISSING_IDS


# 35. summary remains no-show specific (semantically identical, ignoring report_submitted_at)
def test_disp002_summary_unchanged(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert report["prosecutor_summary"] == _EXPECTED_DISP002_SUMMARY


def test_disp002_report_field_equivalence_except_timestamp(disp002_data):
    """Two independent runs against the same frozen data must be identical
    except for report_submitted_at — proving dispatch introduced no
    nondeterminism into the NO_SHOW_CHARGE path."""
    report_a = generate_prosecutor_report(copy.deepcopy(disp002_data))
    report_b = generate_prosecutor_report(copy.deepcopy(disp002_data))
    for key in ("verified_facts", "disputed_facts", "missing_facts", "prosecutor_summary"):
        assert report_a[key] == report_b[key]
    assert "report_submitted_at" in report_a and "report_submitted_at" in report_b


# ---------------------------------------------------------------------------
# Prosecutor/bonus-module integration regression (Section 19 of the task)
# ---------------------------------------------------------------------------
# ===========================================================================
# Follow-up hardening: non-finite numeric input (NaN / Infinity / bool)
# ===========================================================================

_NON_FINITE_VALUES = [float("nan"), float("inf"), float("-inf")]
_BOOL_VALUES = [True, False]


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES)
def test_deviation_recorded_rejects_non_finite(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["deviation_distance_km"] = bad_value
    result = check_route_deviation_recorded(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


@pytest.mark.parametrize("bad_value", _BOOL_VALUES)
def test_deviation_recorded_rejects_bool(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["deviation_distance_km"] = bad_value
    result = check_route_deviation_recorded(data)
    assert result["status"] == "MISSING"


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES)
def test_duration_delta_rejects_non_finite_actual(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["trip_duration_seconds"] = bad_value
    result = check_route_duration_delta(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES)
def test_duration_delta_rejects_non_finite_optimal(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["optimal_duration_seconds"] = bad_value
    result = check_route_duration_delta(data)
    assert result["status"] == "MISSING"


@pytest.mark.parametrize("bad_value", _BOOL_VALUES)
def test_duration_delta_rejects_bool(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["trip_duration_seconds"] = bad_value
    result = check_route_duration_delta(data)
    assert result["status"] == "MISSING"


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES + _BOOL_VALUES)
def test_endpoint_consistency_rejects_non_finite_pickup_lat(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["trip_data"]["pickup_location"]["lat"] = bad_value
    result = check_route_endpoint_consistency(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES + _BOOL_VALUES)
def test_endpoint_consistency_rejects_non_finite_gps_point(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["actual_route"][0]["latitude"] = bad_value
    result = check_route_endpoint_consistency(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


@pytest.mark.parametrize("bad_value", _NON_FINITE_VALUES)
def test_disputed_fare_context_rejects_non_finite(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = bad_value
    result = check_route_disputed_fare_context(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


@pytest.mark.parametrize("bad_value", _BOOL_VALUES)
def test_disputed_fare_context_rejects_bool(disp001_data, bad_value):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = bad_value
    result = check_route_disputed_fare_context(data)
    assert result["status"] == "MISSING"


def test_non_finite_values_never_crash_full_report(disp001_data):
    data = copy.deepcopy(disp001_data)
    data["data_sources"]["gps_telemetry"]["deviation_distance_km"] = float("nan")
    data["data_sources"]["gps_telemetry"]["trip_duration_seconds"] = float("inf")
    data["data_sources"]["gps_telemetry"]["optimal_duration_seconds"] = float("-inf")
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = float("nan")
    report = generate_prosecutor_report(data)  # must not raise
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "nan" not in all_text
    assert "inf" not in all_text


# ===========================================================================
# Follow-up hardening: driver/rider message relevance
# ===========================================================================

def test_driver_explanation_route_related_message_verified(disp001_data):
    result = check_driver_route_explanation_recorded(disp001_data)
    assert result["status"] == "VERIFIED"


def test_driver_explanation_unrelated_message_only_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    for m in data["data_sources"]["chat_communication"]["transcript"]:
        if m["sender"] == "driver":
            m["content"] = "Thanks for the tip, have a nice day!"
    result = check_driver_route_explanation_recorded(data)
    assert result["status"] == "MISSING"


def test_driver_explanation_empty_message_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    for m in data["data_sources"]["chat_communication"]["transcript"]:
        if m["sender"] == "driver":
            m["content"] = "   "
    result = check_driver_route_explanation_recorded(data)
    assert result["status"] == "MISSING"


def test_driver_explanation_route_message_mixed_with_unrelated_verified(disp001_data):
    data = copy.deepcopy(disp001_data)
    transcript = data["data_sources"]["chat_communication"]["transcript"]
    transcript.insert(0, {
        "message_id": "MSG-000",
        "sender": "driver",
        "content": "On my way now!",
        "timestamp": "2026-09-22T13:31:00+08:00",
    })
    transcript.append({
        "message_id": "MSG-003",
        "sender": "driver",
        "content": "Thanks, have a good day!",
        "timestamp": "2026-09-22T14:06:00+08:00",
    })
    result = check_driver_route_explanation_recorded(data)
    assert result["status"] == "VERIFIED"


def test_rider_objection_route_related_message_verified(disp001_data):
    result = check_rider_route_objection_recorded(disp001_data)
    assert result["status"] == "VERIFIED"


def test_rider_objection_unrelated_message_only_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    for m in data["data_sources"]["chat_communication"]["transcript"]:
        if m["sender"] == "rider":
            m["content"] = "Thanks for the ride, see you next time!"
    result = check_rider_route_objection_recorded(data)
    assert result["status"] == "MISSING"


def test_rider_objection_empty_message_missing(disp001_data):
    data = copy.deepcopy(disp001_data)
    for m in data["data_sources"]["chat_communication"]["transcript"]:
        if m["sender"] == "rider":
            m["content"] = ""
    result = check_rider_route_objection_recorded(data)
    assert result["status"] == "MISSING"


def test_rider_objection_route_message_mixed_with_unrelated_verified(disp001_data):
    data = copy.deepcopy(disp001_data)
    transcript = data["data_sources"]["chat_communication"]["transcript"]
    transcript.insert(0, {
        "message_id": "MSG-000",
        "sender": "rider",
        "content": "Good morning!",
        "timestamp": "2026-09-22T13:29:00+08:00",
    })
    transcript.append({
        "message_id": "MSG-003",
        "sender": "rider",
        "content": "Okay, thank you.",
        "timestamp": "2026-09-22T14:06:00+08:00",
    })
    result = check_rider_route_objection_recorded(data)
    assert result["status"] == "VERIFIED"


def test_driver_and_rider_route_descriptions_stay_safe(disp001_data):
    driver_result = check_driver_route_explanation_recorded(disp001_data)
    rider_result = check_rider_route_objection_recorded(disp001_data)
    for description in (driver_result["description"], rider_result["description"]):
        lowered = description.lower()
        for forbidden in ("confirmed", "true", "justified", "proved", "caused"):
            assert forbidden not in lowered


def test_driver_explanation_unrelated_message_does_not_regress_disp001(disp001_data):
    """Confirms the relevance filter does not accidentally break the real
    DISP-001 fixture's 8/0/0 result."""
    report = generate_prosecutor_report(disp001_data)
    assert len(report["verified_facts"]) == 8
    assert len(report["disputed_facts"]) == 0
    assert len(report["missing_facts"]) == 0


def test_malformed_route_values_never_crash_route_relevance():
    data = {
        "case_metadata": {"dispute_type": "ROUTE_DEVIATION"},
        "data_sources": {
            "gps_telemetry": {},
            "trip_data": {},
            "app_events": [],
            "chat_communication": {"transcript": [None, 123, {"sender": "driver", "content": None}]},
            "payment_fare_data": {},
        },
    }
    result = check_driver_route_explanation_recorded(data)  # must not raise
    assert result["status"] == "MISSING"


# ===========================================================================
# Stronger DISP-002 (NO_SHOW_CHARGE) field-for-field regression
# ===========================================================================
#
# This does NOT call generate_prosecutor_report() twice and diff the results
# against itself (that would be tautological — it would only prove the new
# dispatch code is deterministic, not that it matches pre-dispatch behavior).
# Instead this is a literal, hand-captured snapshot of DISP-002's full
# ProsecutorReport (verified_facts/disputed_facts/missing_facts, field for
# field, excluding only report_submitted_at), taken from checks.py's
# unmodified NO_SHOW check functions — the same functions dispatch now
# simply calls through a list instead of a literal, so this snapshot is an
# independent regression fence, not a repeat of the code under test.

_EXPECTED_DISP002_VERIFIED_FACTS = [
    {
        "fact_id": "F-VER-001",
        "description": (
            "Driver arrival time 2026-09-13T08:43:00+08:00 is consistent across trip data, "
            "app events, GPS telemetry, and chat records."
        ),
        "supporting_evidence": [
            {"evidence_id": "EVT-003", "source_type": "APP_EVENT", "description": "App event driver_arrived at 2026-09-13T08:43:00+08:00"},
            {"evidence_id": "GPS-004", "source_type": "GPS_TELEMETRY", "description": "GPS arrival point at 2026-09-13T08:43:00+08:00"},
            {"evidence_id": "CHAT-001", "source_type": "CHAT_LOG", "description": "First driver chat message at 2026-09-13T08:43:00+08:00"},
        ],
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-002",
        "description": "Actual driver waiting duration calculated as 480 seconds (8 minutes 0 seconds).",
        "supporting_evidence": [
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Trip data: arrival 2026-09-13T08:43:00+08:00, cancellation 2026-09-13T08:51:00+08:00"},
        ],
        "party_relevance": "NEUTRAL",
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-003",
        "description": "GPS arrival point is within 0.0 metres of the declared pickup location (tolerance 50 m).",
        "supporting_evidence": [
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Trip pickup location: Tiong Bahru Plaza (1.2847, 103.8382)"},
            {"evidence_id": "GPS-004", "source_type": "GPS_TELEMETRY", "description": "GPS arrival point at 2026-09-13T08:43:00+08:00 (1.2847, 103.8382)"},
        ],
        "party_relevance": "NEUTRAL",
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-004",
        "description": "Driver communication attempt verified: app event and chat record both timestamped 2026-09-13T08:47:05+08:00.",
        "supporting_evidence": [
            {"evidence_id": "EVT-006", "source_type": "APP_EVENT", "description": "Driver call attempt at 2026-09-13T08:47:05+08:00: Driver initiated in-app call to rider. Call rang 22s, no answer."},
            {"evidence_id": "CHAT-003", "source_type": "CHAT_LOG", "description": "Chat call record at 2026-09-13T08:47:05+08:00: Outgoing call to rider — not answered (rang 22s, no response)."},
        ],
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-005",
        "description": "Cancellation timestamp 2026-09-13T08:51:00+08:00 is consistent across trip data, app events, GPS telemetry, and chat records.",
        "supporting_evidence": [
            {"evidence_id": "EVT-008", "source_type": "APP_EVENT", "description": "Cancellation fee applied at 2026-09-13T08:51:00+08:00"},
            {"evidence_id": "GPS-007", "source_type": "GPS_TELEMETRY", "description": "GPS cancelled status at 2026-09-13T08:51:00+08:00"},
            {"evidence_id": "CHAT-006", "source_type": "CHAT_LOG", "description": "System cancellation message at 2026-09-13T08:51:00+08:00"},
        ],
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-006",
        "description": "All recorded event timestamps follow a consistent chronological order.",
        "supporting_evidence": [
            {"evidence_id": "EVT-000", "source_type": "APP_EVENT", "description": "booking_confirmed at 2026-09-13T08:30:00+08:00"},
            {"evidence_id": "EVT-001", "source_type": "APP_EVENT", "description": "driver_assigned at 2026-09-13T08:30:15+08:00"},
            {"evidence_id": "EVT-002", "source_type": "APP_EVENT", "description": "driver_en_route at 2026-09-13T08:30:20+08:00"},
            {"evidence_id": "EVT-003", "source_type": "APP_EVENT", "description": "driver_arrived at 2026-09-13T08:43:00+08:00"},
            {"evidence_id": "EVT-004", "source_type": "APP_EVENT", "description": "rider_notified at 2026-09-13T08:43:05+08:00"},
            {"evidence_id": "EVT-005", "source_type": "APP_EVENT", "description": "wait_timer_started at 2026-09-13T08:43:10+08:00"},
            {"evidence_id": "EVT-006", "source_type": "APP_EVENT", "description": "driver_called_rider at 2026-09-13T08:47:05+08:00"},
            {"evidence_id": "EVT-007", "source_type": "APP_EVENT", "description": "wait_timer_expired at 2026-09-13T08:48:10+08:00"},
            {"evidence_id": "EVT-008", "source_type": "APP_EVENT", "description": "cancellation_fee_applied at 2026-09-13T08:51:00+08:00"},
            {"evidence_id": "EVT-009", "source_type": "APP_EVENT", "description": "driver_released at 2026-09-13T08:51:05+08:00"},
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "scheduled_time at 2026-09-13T08:45:00+08:00"},
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "driver_arrival_time at 2026-09-13T08:43:00+08:00"},
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "cancellation_time at 2026-09-13T08:51:00+08:00"},
        ],
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-007",
        "description": "No contradictory timestamps detected across trip data fields.",
        "supporting_evidence": [
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Arrival 2026-09-13T08:43:00+08:00, cancellation 2026-09-13T08:51:00+08:00"},
        ],
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-VER-008",
        "description": "Actual waiting duration (480s) meets or exceeds the no-show threshold (480s) per policy ryde_policy_v1.json POL-3 v1.",
        "supporting_evidence": [
            {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Waiting duration (2026-09-13T08:43:00+08:00 to 2026-09-13T08:51:00+08:00)"},
        ],
        "party_relevance": "NEUTRAL",
        "policy_clause_reference": "ryde_policy_v1.json POL-3 v1",
        "confidence_level": 1.0,
    },
]

_EXPECTED_DISP002_MISSING_FACTS = [
    {
        "fact_id": "F-MIS-001",
        "description": "GPS coverage gaps detected during wait period: 2 gap(s) exceeding 120 seconds.",
        "supporting_evidence": [
            {"evidence_id": "GPS-004", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:43:00+08:00"},
            {"evidence_id": "GPS-005", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:45:00+08:00"},
            {"evidence_id": "GPS-006", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:48:00+08:00"},
            {"evidence_id": "GPS-007", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:51:00+08:00"},
        ],
        "party_relevance": "NEUTRAL",
        "confidence_level": 1.0,
    },
    {
        "fact_id": "F-MIS-002",
        "description": (
            "No rider communication or response is recorded in the evidence. "
            "The rider's perspective is absent from the case record."
        ),
        "supporting_evidence": [],
        "party_relevance": "RIDER",
    },
]


def test_disp002_full_fact_content_matches_frozen_snapshot(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert report["verified_facts"] == _EXPECTED_DISP002_VERIFIED_FACTS
    assert report["disputed_facts"] == []
    assert report["missing_facts"] == _EXPECTED_DISP002_MISSING_FACTS


def test_disp001_run_prosecutor_audit_no_crash_and_contract_preserved(disp001_data):
    import asyncio

    result = asyncio.run(run_prosecutor_audit(disp001_data))
    assert set(result.keys()) == {"round_2_cross_exam", "bonus_modules", "prosecutor_findings"}
    assert result["prosecutor_findings"]["verified_facts"]
    assert "route deviation dispute" in result["prosecutor_findings"]["prosecutor_summary"]
    assert result["bonus_modules"]["image_exif_analyses"] == []
    assert result["bonus_modules"]["fraud_assessment"] is not None
    assert result["bonus_modules"]["escalation_protocol"] is not None
