from datetime import datetime

import pytest

from app.services.verification import checks as checks_module
from app.services.verification import policy as policy_module
from app.services.verification.ingestion import (
    FixtureAccessError,
    _MOCK_DATA_DIR,
    load_case_data,
    normalize_evidence,
)
from app.services.verification.checks import (
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
from app.services.verification.policy import PolicyThresholds, get_policy_clause, get_policy_params
from app.services.verification.report import generate_prosecutor_report


@pytest.fixture
def disp002_data():
    return normalize_evidence(load_case_data("DISP-002"))


@pytest.fixture
def create_disp002_case(client):
    def _create(case_id="DISP-002", rider_id="R-7823", driver_id="D-2398"):
        return client.post(
            "/api/v1/cases",
            json={
                "case_id": case_id,
                "dispute_type": "NO_SHOW_CHARGE",
                "trip_id": "TRIP-2026-09945",
                "rider_id": rider_id,
                "driver_id": driver_id,
            },
        )

    return _create


# ---------------------------------------------------------------------------
# 1. Original DISP-002 dataset
# ---------------------------------------------------------------------------
def test_disp002_full_verification(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert len(report["verified_facts"]) >= 5
    assert report.get("prosecutor_summary")
    assert report.get("report_submitted_at")
    # No JudgeVerdict leakage
    assert "judge_verdict" not in report
    assert "ruling_type" not in report
    assert "confidence_score" not in report
    assert "recommended_action" not in report


# ---------------------------------------------------------------------------
# 2. Waiting-duration calculation
# ---------------------------------------------------------------------------
def test_waiting_duration_calculation(disp002_data):
    result = check_waiting_duration(disp002_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["duration_seconds"] == 480
    assert "480" in result["description"] or "8 minute" in result["description"].lower()


# ---------------------------------------------------------------------------
# 3. Pickup GPS consistency
# ---------------------------------------------------------------------------
def test_pickup_gps_consistency_exact_match(disp002_data):
    result = check_pickup_gps_consistency(disp002_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["distance_meters"] == 0.0


def test_pickup_gps_consistency_mismatch():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["trip_data"]["pickup_location"]["lat"] = 2.0
    data["data_sources"]["trip_data"]["pickup_location"]["lng"] = 104.0
    result = check_pickup_gps_consistency(data)
    assert result["status"] == "DISPUTED"
    assert result["details"]["distance_meters"] > 50.0


# ---------------------------------------------------------------------------
# 4. Communication-attempt cross-verification
# ---------------------------------------------------------------------------
def test_communication_attempt_verified(disp002_data):
    result = check_communication_attempts(disp002_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["timestamp"] == "2026-09-13T08:47:05+08:00"


def test_communication_attempt_missing_chat():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["chat_communication"]["transcript"] = [
        m for m in data["data_sources"]["chat_communication"]["transcript"]
        if m.get("type") != "call" and "call" not in m.get("content", "").lower()
    ]
    data = normalize_evidence(data)
    result = check_communication_attempts(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 5. Cancellation event ordering
# ---------------------------------------------------------------------------
def test_cancellation_event_ordering(disp002_data):
    result = check_event_ordering(disp002_data)
    assert result["status"] == "VERIFIED"


def test_cancellation_event_out_of_order():
    data = normalize_evidence(load_case_data("DISP-002"))
    # Swap arrival and cancellation in app events
    for evt in data["data_sources"]["app_events"]:
        if evt["event_type"] == "driver_arrived":
            evt["timestamp"] = "2026-09-13T09:00:00+08:00"
    data = normalize_evidence(data)
    result = check_event_ordering(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 6. Missing or incomplete GPS records
# ---------------------------------------------------------------------------
def test_missing_gps_records_acceptable(disp002_data):
    result = check_missing_gps_records(disp002_data)
    # DISP-002 has gaps > 120s during wait, so this flags as MISSING
    assert result["status"] == "MISSING"
    assert len(result["details"]["gaps"]) > 0


def test_missing_gps_records_severe():
    data = normalize_evidence(load_case_data("DISP-002"))
    # Keep start, one middle point during wait, and end point
    route = data["data_sources"]["gps_telemetry"]["actual_route"]
    data["data_sources"]["gps_telemetry"]["actual_route"] = [route[0], route[-2], route[-1]]
    data = normalize_evidence(data)
    result = check_missing_gps_records(data)
    assert result["status"] == "MISSING"
    assert result["details"]["wait_period_points"] == 2


# ---------------------------------------------------------------------------
# 7. Contradictory timestamps
# ---------------------------------------------------------------------------
def test_contradictory_timestamps_clean(disp002_data):
    result = check_contradictory_timestamps(disp002_data)
    assert result["status"] == "VERIFIED"


def test_contradictory_timestamps_arrival_after_cancellation():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["trip_data"]["driver_arrival_time"] = "2026-09-13T09:00:00+08:00"
    result = check_contradictory_timestamps(data)
    assert result["status"] == "DISPUTED"
    assert "after cancellation" in result["description"].lower()


# ---------------------------------------------------------------------------
# 8. Policy eligibility — backend-owned policy registry only (Issue 2)
# ---------------------------------------------------------------------------
def test_policy_eligibility_verified_with_backend_policy(disp002_data):
    """NO_SHOW_CHARGE now has a real policy — 480s wait >= 480s threshold -> VERIFIED."""
    result = check_policy_eligibility(disp002_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["duration_seconds"] == 480
    assert result["details"]["no_show_threshold_seconds"] == 480
    assert result["details"]["policy_clause_reference"] == "ryde_policy_v1.json POL-3 v1"
    assert "480" in result["description"]


def test_policy_eligibility_disputed_when_backend_policy_says_insufficient(disp002_data, monkeypatch):
    fake_policy = PolicyThresholds(
        free_wait_period_seconds=600,
        no_show_threshold_seconds=900,
        source="TEST-POLICY",
        version="1",
    )
    monkeypatch.setattr(checks_module, "get_policy_params", lambda dispute_type: fake_policy)
    result = check_policy_eligibility(disp002_data)
    assert result["status"] == "DISPUTED"
    assert result["details"]["duration_seconds"] == 480
    assert result["details"]["no_show_threshold_seconds"] == 900


def test_policy_eligibility_verified_when_backend_policy_says_sufficient(disp002_data, monkeypatch):
    fake_policy = PolicyThresholds(
        free_wait_period_seconds=300,
        no_show_threshold_seconds=300,
        source="TEST-POLICY",
        version="1",
    )
    monkeypatch.setattr(checks_module, "get_policy_params", lambda dispute_type: fake_policy)
    result = check_policy_eligibility(disp002_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["duration_seconds"] == 480


def test_policy_source_and_version_recorded_when_applied(disp002_data, monkeypatch):
    fake_policy = PolicyThresholds(
        free_wait_period_seconds=300,
        no_show_threshold_seconds=300,
        source="TEST-POLICY",
        version="7",
    )
    monkeypatch.setattr(checks_module, "get_policy_params", lambda dispute_type: fake_policy)
    result = check_policy_eligibility(disp002_data)
    assert result["details"]["policy_clause_reference"] == "TEST-POLICY v7"
    assert "TEST-POLICY v7" in result["description"]


def test_policy_registry_returns_real_thresholds_for_no_show():
    """NO_SHOW_CHARGE: free_wait 5 min -> 300s, no_show 8 min -> 480s."""
    params = get_policy_params("NO_SHOW_CHARGE")
    assert params is not None
    assert params.free_wait_period_seconds == 300
    assert params.no_show_threshold_seconds == 480
    assert params.source == "ryde_policy_v1.json POL-3"
    assert params.version == "1"


def test_policy_clause_returns_correct_clause_ids():
    assert get_policy_clause("ROUTE_DEVIATION")["clause_id"] == "POL-2"
    assert get_policy_clause("NO_SHOW_CHARGE")["clause_id"] == "POL-3"
    assert get_policy_clause("CLEANING_FEE")["clause_id"] == "POL-4"


def test_policy_clause_returns_none_for_unknown_and_none():
    assert get_policy_clause("UNKNOWN_TYPE") is None
    assert get_policy_clause(None) is None


def test_policy_params_returns_none_for_route_deviation():
    """ROUTE_DEVIATION has no free_wait_time_min / no_show_threshold_min params."""
    assert get_policy_params("ROUTE_DEVIATION") is None


def test_policy_eligibility_missing_when_policy_params_monkeypatched_to_none(disp002_data, monkeypatch):
    """When get_policy_params is forced to return None, eligibility must be MISSING."""
    monkeypatch.setattr(checks_module, "get_policy_params", lambda dispute_type: None)
    result = check_policy_eligibility(disp002_data)
    assert result["status"] == "MISSING"
    assert "cannot be assessed" in result["description"].lower()
    assert result["details"]["duration_seconds"] == 480


def test_policy_params_argument_removed_from_check_function_signature(disp002_data):
    """check_policy_eligibility must not accept a caller-supplied policy dict."""
    import inspect

    sig = inspect.signature(check_policy_eligibility)
    assert list(sig.parameters) == ["data"]


def test_generate_prosecutor_report_takes_no_policy_argument(disp002_data):
    import inspect

    sig = inspect.signature(generate_prosecutor_report)
    assert list(sig.parameters) == ["data"]


# ---------------------------------------------------------------------------
# 9. ProsecutorReport schema compatibility
# ---------------------------------------------------------------------------
def test_prosecutor_report_schema_compatibility(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    # Top-level keys match shared schema ProsecutorReport
    assert "verified_facts" in report
    assert "disputed_facts" in report
    assert "missing_facts" in report
    assert "prosecutor_summary" in report
    assert "report_submitted_at" in report

    # Validate Fact structure
    for fact in report["verified_facts"] + report["disputed_facts"] + report["missing_facts"]:
        assert "fact_id" in fact
        assert "description" in fact
        assert "supporting_evidence" in fact
        for ref in fact["supporting_evidence"]:
            assert "evidence_id" in ref
            assert "source_type" in ref
            assert "description" in ref

    # Validate report_submitted_at is ISO 8601
    datetime.fromisoformat(report["report_submitted_at"])


# ---------------------------------------------------------------------------
# 10. No JudgeVerdict or expected-ruling leakage
# ---------------------------------------------------------------------------
def test_no_judge_verdict_leakage(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert "judge_verdict" not in report
    assert "ruling_type" not in report
    assert "confidence_score" not in report
    assert "recommended_action" not in report
    assert "refund_amount" not in report
    assert "cleaning_fee_amount" not in report
    assert "penalty_points" not in report


# ---------------------------------------------------------------------------
# HTTP integration tests
# ---------------------------------------------------------------------------
def test_verify_endpoint_requires_party_header(client, create_disp002_case):
    create_disp002_case()
    resp = client.post("/api/v1/cases/DISP-002/verify")
    assert resp.status_code == 422  # missing X-Party-Id


def test_verify_endpoint_party_scoped(client, create_disp002_case):
    create_disp002_case()
    resp = client.post("/api/v1/cases/DISP-002/verify", headers={"X-Party-Id": "R-7823"})
    assert resp.status_code == 200
    body = resp.json()
    assert "verified_facts" in body
    assert len(body["verified_facts"]) >= 5

    # Stranger forbidden
    resp = client.post("/api/v1/cases/DISP-002/verify", headers={"X-Party-Id": "R-999"})
    assert resp.status_code == 403


def test_verify_endpoint_case_not_found(client):
    resp = client.post("/api/v1/cases/FAKE-999/verify", headers={"X-Party-Id": "R-1"})
    assert resp.status_code == 404


def test_verify_endpoint_case_id_mismatch(client):
    # Create a case with one ID but the mock file has a different ID
    client.post(
        "/api/v1/cases",
        json={
            "case_id": "MISMATCH-001",
            "dispute_type": "NO_SHOW_CHARGE",
            "trip_id": "TRIP-1",
            "rider_id": "R-1",
            "driver_id": "D-1",
        },
    )
    # MISMATCH-001 is not in the fixture allowlist, so this 404s regardless.
    resp = client.post("/api/v1/cases/MISMATCH-001/verify", headers={"X-Party-Id": "R-1"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# ISSUE 1 — path traversal / unauthorised fixture access regression tests
# ---------------------------------------------------------------------------
def test_load_case_data_valid_fixture():
    data = load_case_data("DISP-002")
    assert data["case_metadata"]["case_id"] == "DISP-002"


@pytest.mark.parametrize(
    "malicious_case_id",
    [
        "../../../../etc/passwd",
        "..%2f..%2f..%2fetc%2fpasswd",
        r"..\..\..\windows\win.ini",
        "DISP-002/../../../etc/passwd",
    ],
)
def test_load_case_data_rejects_traversal_sequences(malicious_case_id):
    with pytest.raises(FixtureAccessError):
        load_case_data(malicious_case_id)


@pytest.mark.parametrize(
    "absolute_path_id",
    [
        "/etc/passwd",
        r"C:\Windows\System32\config\SAM",
        r"\\server\share\secret",
    ],
)
def test_load_case_data_rejects_absolute_paths(absolute_path_id):
    with pytest.raises(FixtureAccessError):
        load_case_data(absolute_path_id)


def test_load_case_data_rejects_syntactically_valid_unapproved_id():
    """DISP-999 matches the case_id format but was never added to the allowlist."""
    with pytest.raises(FixtureAccessError):
        load_case_data("DISP-999")


def test_verify_endpoint_rejects_db_case_not_in_fixture_allowlist(client):
    """A Case row existing in the DB must not, by itself, grant fixture access —
    only membership in the backend-owned allowlist does."""
    client.post(
        "/api/v1/cases",
        json={
            "case_id": "ZZZZ-001",
            "dispute_type": "NO_SHOW_CHARGE",
            "trip_id": "TRIP-9",
            "rider_id": "R-1",
            "driver_id": "D-1",
        },
    )
    resp = client.post("/api/v1/cases/ZZZZ-001/verify", headers={"X-Party-Id": "R-1"})
    assert resp.status_code == 404


def test_verify_endpoint_error_response_has_no_filesystem_paths(client):
    client.post(
        "/api/v1/cases",
        json={
            "case_id": "ZZZZ-002",
            "dispute_type": "NO_SHOW_CHARGE",
            "trip_id": "TRIP-9",
            "rider_id": "R-1",
            "driver_id": "D-1",
        },
    )
    resp = client.post("/api/v1/cases/ZZZZ-002/verify", headers={"X-Party-Id": "R-1"})
    assert resp.status_code == 404
    body_text = resp.text
    assert _MOCK_DATA_DIR not in body_text
    assert "mock_data" not in body_text
    assert "\\" not in body_text  # no raw Windows path separators leaked


def test_party_scoped_access_preserved_alongside_fixture_allowlist(client, create_disp002_case):
    """Fixing the allowlist must not weaken existing party-scoping."""
    create_disp002_case()
    resp = client.post("/api/v1/cases/DISP-002/verify", headers={"X-Party-Id": "R-999"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# ISSUE 2 — caller cannot influence policy findings via the public API
# ---------------------------------------------------------------------------
def test_verify_endpoint_ignores_client_supplied_policy_body(client, create_disp002_case):
    create_disp002_case()
    baseline = client.post("/api/v1/cases/DISP-002/verify", headers={"X-Party-Id": "R-7823"})
    assert baseline.status_code == 200

    attacker_attempt = client.post(
        "/api/v1/cases/DISP-002/verify",
        headers={"X-Party-Id": "R-7823"},
        json={"free_wait_period_seconds": 1, "no_show_threshold_seconds": 1},
    )
    assert attacker_attempt.status_code == 200

    baseline_body = baseline.json()
    attacker_body = attacker_attempt.json()
    # report_submitted_at is a fresh timestamp per call; everything else — the
    # actual findings — must be identical regardless of the request body.
    baseline_body.pop("report_submitted_at")
    attacker_body.pop("report_submitted_at")
    assert attacker_body == baseline_body


def test_verify_endpoint_driver_cannot_bias_policy_outcome(client, create_disp002_case):
    create_disp002_case()
    driver_attempt = client.post(
        "/api/v1/cases/DISP-002/verify",
        headers={"X-Party-Id": "D-2398"},
        json={"no_show_threshold_seconds": 999999, "free_wait_period_seconds": 999999},
    )
    assert driver_attempt.status_code == 200
    body = driver_attempt.json()
    all_facts = body["verified_facts"] + body["disputed_facts"] + body["missing_facts"]
    policy_facts = [f for f in all_facts if "policy eligibility" in f["description"].lower() or "no-show threshold" in f["description"].lower()]
    assert policy_facts, "expected a policy-eligibility fact in the report"
    # The policy-eligibility fact must be VERIFIED, using 480 seconds from the
    # policy file — never the client-supplied 999999.
    assert all(f in body["verified_facts"] for f in policy_facts), (
        "policy eligibility must be VERIFIED regardless of client-supplied numbers"
    )
    for f in policy_facts:
        assert "999999" not in f["description"]
        assert "480" in f["description"]


def test_verify_endpoint_response_has_no_policy_params_schema_leftover():
    """Guards against re-introducing a PolicyParams request model on the route."""
    import inspect

    from app.api.routes import verification as verification_route

    sig = inspect.signature(verification_route.verify_case)
    assert "policy_params" not in sig.parameters


# ---------------------------------------------------------------------------
# ISSUE 3 — malformed timestamp handling regression tests
# ---------------------------------------------------------------------------
def test_malformed_driver_arrival_timestamp_no_crash():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["trip_data"]["driver_arrival_time"] = "not-a-timestamp"

    arrival_result = check_arrival_time_verification(data)
    assert arrival_result["status"] == "MISSING"

    waiting_result = check_waiting_duration(data)
    assert waiting_result["status"] == "MISSING"

    # Full report generation must still succeed, never raise.
    report = generate_prosecutor_report(data)
    assert "verified_facts" in report


def test_malformed_gps_timestamp_flagged_not_verified():
    data = normalize_evidence(load_case_data("DISP-002"))
    for point in data["data_sources"]["gps_telemetry"]["actual_route"]:
        if point.get("status") == "arrived":
            point["timestamp"] = "definitely-not-a-date"

    result = check_arrival_time_verification(data)
    assert result["status"] == "DISPUTED"
    assert result["status"] != "VERIFIED"

    gps_completeness = check_missing_gps_records(data)
    assert gps_completeness["status"] == "DISPUTED"
    assert gps_completeness["details"]["malformed_point_count"] >= 1
    # The malformed point's evidence_id is still traceable, not dropped.
    assert gps_completeness["evidence_refs"], "malformed GPS point must remain traceable"


def test_malformed_app_event_timestamp_flagged_not_verified():
    data = normalize_evidence(load_case_data("DISP-002"))
    for evt in data["data_sources"]["app_events"]:
        if evt["event_type"] == "driver_arrived":
            evt["timestamp"] = "garbled"

    result = check_arrival_time_verification(data)
    assert result["status"] == "DISPUTED"

    ordering_result = check_event_ordering(data)
    assert ordering_result["status"] == "DISPUTED"
    assert any("malformed" in issue.lower() for issue in ordering_result["details"]["issues"])


def test_missing_cancellation_timestamp_no_crash():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["trip_data"]["cancellation_time"] = ""

    assert check_cancellation_timestamp(data)["status"] == "MISSING"
    assert check_waiting_duration(data)["status"] == "MISSING"
    assert check_policy_eligibility(data)["status"] == "MISSING"

    report = generate_prosecutor_report(data)
    assert "verified_facts" in report


def test_mixed_timezone_aware_and_naive_timestamps_no_crash():
    data = normalize_evidence(load_case_data("DISP-002"))
    # driver_arrival_time loses its UTC+8 offset; cancellation_time keeps it.
    data["data_sources"]["trip_data"]["driver_arrival_time"] = "2026-09-13T08:43:00"

    result = check_waiting_duration(data)
    assert result["status"] == "MISSING"
    assert "timezone" in result["description"].lower()

    policy_result = check_policy_eligibility(data)
    assert policy_result["status"] == "MISSING"

    report = generate_prosecutor_report(data)
    assert "verified_facts" in report


def test_normalize_evidence_skips_non_dict_actual_route_entries():
    data = load_case_data("DISP-002")
    data["data_sources"]["gps_telemetry"]["actual_route"] = [
        {"latitude": 1.0, "longitude": 103.0, "timestamp": "2026-09-13T08:30:00+08:00"},
        None,
        "not-a-dict",
        123,
        {},
        {"latitude": 1.1, "longitude": 103.1, "timestamp": "2026-09-13T08:35:00+08:00"},
    ]
    result = normalize_evidence(data)  # must not raise
    route = result["data_sources"]["gps_telemetry"]["actual_route"]

    assert route[0]["evidence_id"] == "GPS-000"
    assert route[1] is None
    assert route[2] == "not-a-dict"
    assert route[3] == 123
    # An empty dict is still a dict — it gets an evidence_id like any valid
    # entry, but no coordinate fields are fabricated for it.
    assert route[4]["evidence_id"] == "GPS-004"
    assert set(route[4].keys()) == {"evidence_id"}
    assert route[5]["evidence_id"] == "GPS-005"  # index preserved, not shifted

    # Malformed non-dict entries never enter the evidence map.
    for entry in (None, "not-a-dict", 123):
        assert entry not in result["_evidence_map"].values()

    # NOTE: intentionally does not call generate_prosecutor_report() here.
    # NO_SHOW_CHARGE's own check functions (e.g. check_arrival_time_verification)
    # separately assume every actual_route/app_events entry is a dict and are
    # not hardened against a raw None surviving in the list — a distinct,
    # newly-observed, out-of-scope crash risk reported (not fixed) alongside
    # this pass's two authorized fixes. See test_p3_full_integration.py's
    # test_ingestion_normalize_evidence_handles_non_dict_list_entries for the
    # downstream-still-runs proof against a category whose checks are
    # already hardened (ROUTE_DEVIATION).


def test_normalize_evidence_skips_non_dict_optimal_route_entries():
    data = load_case_data("DISP-002")
    data["data_sources"]["gps_telemetry"]["optimal_route"] = [
        None,
        {"latitude": 1.0, "longitude": 103.0, "timestamp": "2026-09-13T08:30:00+08:00"},
    ]
    result = normalize_evidence(data)  # must not raise
    optimal = result["data_sources"]["gps_telemetry"]["optimal_route"]
    assert optimal[0] is None
    assert optimal[1]["evidence_id"] == "OPT-001"


def test_normalize_evidence_skips_non_dict_app_event_entries():
    data = load_case_data("DISP-002")
    data["data_sources"]["app_events"] = [
        None,
        "not-a-dict",
        {"event_type": "booking_confirmed", "timestamp": "2026-09-13T08:30:00+08:00"},
    ]
    result = normalize_evidence(data)  # must not raise
    events = result["data_sources"]["app_events"]
    assert events[0] is None
    assert events[1] == "not-a-dict"
    assert events[2]["evidence_id"] == "EVT-002"


def test_pickup_gps_consistency_handles_malformed_coordinates():
    base = normalize_evidence(load_case_data("DISP-002"))
    arrival_point = next(
        p for p in base["data_sources"]["gps_telemetry"]["actual_route"] if p.get("status") == "arrived"
    )

    for bad_value in (
        None, "invalid", True, False,
        float("nan"), float("inf"), float("-inf"),
        95.0,  # out of latitude range
    ):
        data = normalize_evidence(load_case_data("DISP-002"))
        point = next(
            p for p in data["data_sources"]["gps_telemetry"]["actual_route"] if p.get("status") == "arrived"
        )
        point["latitude"] = bad_value
        result = check_pickup_gps_consistency(data)
        assert result["status"] == "MISSING", f"latitude={bad_value!r} -> {result['status']}"
        assert "nan" not in result["description"].lower()
        assert "inf" not in result["description"].lower()


def test_pickup_gps_consistency_rejects_out_of_range_longitude():
    data = normalize_evidence(load_case_data("DISP-002"))
    point = next(
        p for p in data["data_sources"]["gps_telemetry"]["actual_route"] if p.get("status") == "arrived"
    )
    point["longitude"] = 185.0
    result = check_pickup_gps_consistency(data)
    assert result["status"] == "MISSING"


def test_pickup_gps_consistency_valid_coordinates_unaffected():
    """DISP-002's real, valid coordinates must still verify exactly as before."""
    data = normalize_evidence(load_case_data("DISP-002"))
    result = check_pickup_gps_consistency(data)
    assert result["status"] == "VERIFIED"
    assert "0.0 metres" in result["description"]


# ---------------------------------------------------------------------------
# NO_SHOW_CHARGE robustness hardening: non-dict list entries must never
# crash any NO_SHOW check, and must never change the result for valid
# entries already present in the canonical DISP-002 fixture.
# ---------------------------------------------------------------------------

_NO_SHOW_CHECK_FNS = (
    check_arrival_time_verification,
    check_waiting_duration,
    check_pickup_gps_consistency,
    check_communication_attempts,
    check_cancellation_timestamp,
    check_event_ordering,
    check_missing_gps_records,
    check_contradictory_timestamps,
    check_policy_eligibility,
)


def _disp002_expected_results():
    data = normalize_evidence(load_case_data("DISP-002"))
    return {fn.__name__: fn(data)["status"] for fn in _NO_SHOW_CHECK_FNS}


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["data_sources"]["app_events"].insert(1, None),
        lambda d: d["data_sources"]["app_events"].insert(1, "not-a-dict"),
        lambda d: d["data_sources"]["app_events"].insert(1, 42),
    ],
    ids=["app_events_none", "app_events_string", "app_events_int"],
)
def test_no_show_checks_survive_malformed_app_events_entry(mutate):
    expected = _disp002_expected_results()
    data = normalize_evidence(load_case_data("DISP-002"))
    mutate(data)
    for fn in _NO_SHOW_CHECK_FNS:
        result = fn(data)  # must not raise
        assert result["status"] == expected[fn.__name__], fn.__name__


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["data_sources"]["gps_telemetry"]["actual_route"].insert(1, None),
        lambda d: d["data_sources"]["gps_telemetry"]["actual_route"].insert(1, "not-a-dict"),
        lambda d: d["data_sources"]["gps_telemetry"].setdefault("optimal_route", []).insert(0, None),
    ],
    ids=["actual_route_none", "actual_route_string", "optimal_route_none"],
)
def test_no_show_checks_survive_malformed_gps_route_entry(mutate):
    expected = _disp002_expected_results()
    data = normalize_evidence(load_case_data("DISP-002"))
    mutate(data)
    for fn in _NO_SHOW_CHECK_FNS:
        result = fn(data)  # must not raise
        assert result["status"] == expected[fn.__name__], fn.__name__


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["data_sources"]["chat_communication"]["transcript"].insert(0, None),
        lambda d: d["data_sources"]["chat_communication"]["transcript"].insert(0, "not-a-dict"),
    ],
    ids=["transcript_none", "transcript_string"],
)
def test_no_show_checks_survive_malformed_transcript_entry(mutate):
    expected = _disp002_expected_results()
    data = normalize_evidence(load_case_data("DISP-002"))
    mutate(data)
    for fn in _NO_SHOW_CHECK_FNS:
        result = fn(data)  # must not raise
        assert result["status"] == expected[fn.__name__], fn.__name__


def test_no_show_full_pipeline_survives_combined_malformed_entries():
    """The complete normalize_evidence -> generate_prosecutor_report chain
    must produce the byte-identical canonical DISP-002 result even with
    malformed non-dict entries scattered across every evidence list at
    once."""
    baseline = generate_prosecutor_report(normalize_evidence(load_case_data("DISP-002")))

    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["app_events"].insert(1, None)
    data["data_sources"]["app_events"].insert(2, "bad")
    data["data_sources"]["gps_telemetry"]["actual_route"].insert(1, None)
    data["data_sources"]["gps_telemetry"]["actual_route"].insert(2, "bad")
    data["data_sources"]["chat_communication"]["transcript"].insert(0, None)
    data["data_sources"]["chat_communication"]["transcript"].insert(1, "bad")

    report = generate_prosecutor_report(data)  # must not raise
    assert report["verified_facts"] == baseline["verified_facts"]
    assert report["disputed_facts"] == baseline["disputed_facts"]
    assert report["missing_facts"] == baseline["missing_facts"]
    assert report["prosecutor_summary"] == baseline["prosecutor_summary"]


def test_report_with_partially_valid_evidence_still_well_formed():
    data = normalize_evidence(load_case_data("DISP-002"))
    data["data_sources"]["trip_data"]["driver_arrival_time"] = "invalid"

    report = generate_prosecutor_report(data)
    assert set(report.keys()) >= {
        "verified_facts",
        "disputed_facts",
        "missing_facts",
        "prosecutor_summary",
        "report_submitted_at",
    }
    all_facts = report["verified_facts"] + report["disputed_facts"] + report["missing_facts"]
    assert len(all_facts) >= 7  # still one fact per check, nothing silently dropped
    for fact in all_facts:
        assert "fact_id" in fact and "description" in fact and "supporting_evidence" in fact


def test_verify_endpoint_malformed_case_metadata_id_still_safe(client, create_disp002_case, monkeypatch):
    """Even if ingestion ever returned a case_metadata.case_id mismatch, the
    route's existing check must reject it without leaking internals."""
    create_disp002_case()

    def _tampered_loader(case_id: str):
        data = load_case_data(case_id)
        data["case_metadata"]["case_id"] = "SOMETHING-ELSE"
        return data

    from app.api.routes import verification as verification_route

    monkeypatch.setattr(verification_route, "load_case_data", _tampered_loader)
    resp = client.post("/api/v1/cases/DISP-002/verify", headers={"X-Party-Id": "R-7823"})
    assert resp.status_code == 422
