"""Tests for P3 CLEANING_FEE deterministic evidence checks and dispatch.

Covers: dispute dispatch selects the correct check list, each Cleaning check's
VERIFIED/DISPUTED/MISSING behavior (including malformed-input safety and
trust-boundary wording), and regression suites for DISP-001 and DISP-002.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

import pytest

from app.services.verification.checks_cleaning_fee import (
    _event_mentions_photo,
    _parse_claim_amount_from_event,
    check_cleaning_claim_amount_consistency,
    check_cleaning_claim_event_exists,
    check_cleaning_claim_submission_delay,
    check_cleaning_conflicting_party_accounts,
    check_cleaning_photo_reference_consistency,
    check_cleaning_structured_image_evidence,
)
from app.services.verification.ingestion import load_case_data, normalize_evidence
from app.services.verification.report import (
    CHECKS_BY_DISPUTE_TYPE,
    CLEANING_FEE_CHECKS,
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


@pytest.fixture
def disp003_data():
    return normalize_evidence(load_case_data("DISP-003"))


def _all_facts(report: dict[str, Any]) -> list[dict[str, Any]]:
    return report["verified_facts"] + report["disputed_facts"] + report["missing_facts"]


# ---------------------------------------------------------------------------
# 1. CLEANING_FEE dispatch uses Cleaning checks
# ---------------------------------------------------------------------------
def test_dispatch_selects_cleaning_checks_for_disp003(disp003_data):
    assert CHECKS_BY_DISPUTE_TYPE["CLEANING_FEE"] is CLEANING_FEE_CHECKS
    report = generate_prosecutor_report(disp003_data)
    assert len(_all_facts(report)) == len(CLEANING_FEE_CHECKS)


# ---------------------------------------------------------------------------
# 2. No NO_SHOW-specific facts appear
# ---------------------------------------------------------------------------
def test_disp003_report_has_no_no_show_noise(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "driver arrival" not in all_text
    assert "cancellation" not in all_text
    assert "waiting duration" not in all_text
    assert "no-show" not in all_text


# ---------------------------------------------------------------------------
# 3. No Route-specific facts appear
# ---------------------------------------------------------------------------
def test_disp003_report_has_no_route_noise(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "route deviation" not in all_text
    assert "endpoint" not in all_text
    assert "unexpected stop" not in all_text


# ---------------------------------------------------------------------------
# 4. Cleaning claim event -> VERIFIED
# ---------------------------------------------------------------------------
def test_cleaning_claim_event_verified(disp003_data):
    result = check_cleaning_claim_event_exists(disp003_data)
    assert result["status"] == "VERIFIED"
    assert "cleaning-fee claim is recorded" in result["description"].lower()


# ---------------------------------------------------------------------------
# 5. Missing claim event -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_claim_event_missing():
    data = {"data_sources": {"app_events": []}}
    result = check_cleaning_claim_event_exists(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 6. Malformed claim event safe
# ---------------------------------------------------------------------------
def test_cleaning_claim_event_malformed_timestamp():
    data = {
        "data_sources": {
            "app_events": [
                {"event_type": "cleaning_fee_claimed", "timestamp": "not-a-ts", "details": "x"}
            ]
        }
    }
    result = check_cleaning_claim_event_exists(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 7. Current $100 claim matches PAYMENT-DATA -> VERIFIED
# ---------------------------------------------------------------------------
def test_cleaning_claim_amount_consistency_verified(disp003_data):
    result = check_cleaning_claim_amount_consistency(disp003_data)
    assert result["status"] == "VERIFIED"
    assert "100" in result["description"]
    assert "consistent" in result["description"].lower()


# ---------------------------------------------------------------------------
# 8. Amount mismatch -> DISPUTED
# ---------------------------------------------------------------------------
def test_cleaning_claim_amount_mismatch(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = 50.0
    result = check_cleaning_claim_amount_consistency(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 9. Missing payment amount -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_claim_amount_missing_payment(disp003_data):
    data = copy.deepcopy(disp003_data)
    del data["data_sources"]["payment_fare_data"]["disputed_amount"]
    result = check_cleaning_claim_amount_consistency(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 10. NaN / Inf / bool amount -> MISSING
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), float("-inf"), True, False])
def test_cleaning_claim_amount_rejects_non_finite(disp003_data, bad_value):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["payment_fare_data"]["disputed_amount"] = bad_value
    result = check_cleaning_claim_amount_consistency(data)
    assert result["status"] == "MISSING"
    assert "nan" not in result["description"].lower()
    assert "inf" not in result["description"].lower()


# ---------------------------------------------------------------------------
# 11. Claim delay = 5100 sec / 85 min
# ---------------------------------------------------------------------------
def test_cleaning_claim_delay_verified(disp003_data):
    result = check_cleaning_claim_submission_delay(disp003_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["delta_seconds"] == 5100
    assert result["details"]["delta_minutes"] == 85


# ---------------------------------------------------------------------------
# 12. Claim before trip completion -> DISPUTED
# ---------------------------------------------------------------------------
def test_cleaning_claim_before_trip_completion(disp003_data):
    data = copy.deepcopy(disp003_data)
    # Swap timestamps so claim is before completion
    data["data_sources"]["app_events"][0]["timestamp"] = "2026-09-22T04:10:00+08:00"
    data["data_sources"]["app_events"][1]["timestamp"] = "2026-09-22T02:45:00+08:00"
    result = check_cleaning_claim_submission_delay(data)
    assert result["status"] == "DISPUTED"


# ---------------------------------------------------------------------------
# 13. Malformed timestamps -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_claim_delay_malformed_timestamps(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["app_events"][0]["timestamp"] = "bad"
    result = check_cleaning_claim_submission_delay(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 14. Missing trip_completed -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_claim_delay_missing_trip_completed(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["app_events"] = [
        e for e in data["data_sources"]["app_events"]
        if e.get("event_type") != "trip_completed"
    ]
    result = check_cleaning_claim_submission_delay(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 15. Driver allegation + rider denial -> VERIFIED conflicting-accounts fact
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_verified(disp003_data):
    result = check_cleaning_conflicting_party_accounts(disp003_data)
    assert result["status"] == "VERIFIED"
    assert result["details"]["party_relevance"] == "BOTH"


# ---------------------------------------------------------------------------
# 16. Unrelated driver message -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_missing_driver(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["chat_communication"]["transcript"][0]["content"] = "Hello there"
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"
    assert "driver allegation" in result["description"].lower()


# ---------------------------------------------------------------------------
# 17. Unrelated rider message -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_missing_rider(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["chat_communication"]["transcript"][1]["content"] = "Thanks for the ride"
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"
    assert "rider denial" in result["description"].lower()


# ---------------------------------------------------------------------------
# 18. Only one relevant side -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_only_one_side(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["chat_communication"]["transcript"] = [
        data["data_sources"]["chat_communication"]["transcript"][0]
    ]
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 19. Empty/malformed transcript -> safe
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_empty_transcript(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["chat_communication"]["transcript"] = []
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


def test_cleaning_conflicting_accounts_malformed_transcript():
    data = {"data_sources": {"chat_communication": {"transcript": ["not-a-dict", None, {}]}}}
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 20. No raw party text appears in fact description
# ---------------------------------------------------------------------------
def test_cleaning_conflicting_accounts_no_raw_text_in_description(disp003_data):
    result = check_cleaning_conflicting_party_accounts(disp003_data)
    desc = result["description"].lower()
    assert "mess" not in desc
    assert "vomit" not in desc
    assert "sober" not in desc
    assert "back seat" not in desc


# ---------------------------------------------------------------------------
# 21. Missing image_evidence -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_structured_image_evidence_missing(disp003_data):
    result = check_cleaning_structured_image_evidence(disp003_data)
    assert result["status"] == "MISSING"
    assert "frozen structured evidence record" in result["description"].lower()


# ---------------------------------------------------------------------------
# 22. Empty image_evidence -> MISSING
# ---------------------------------------------------------------------------
def test_cleaning_structured_image_evidence_empty(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = []
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "MISSING"


# ---------------------------------------------------------------------------
# 23. Non-empty structured image evidence -> VERIFIED availability
# ---------------------------------------------------------------------------
def test_cleaning_structured_image_evidence_verified(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = [
        {"image_id": "IMG-001", "image_url": "http://example.com/img.jpg"}
    ]
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "VERIFIED"
    assert "available" in result["description"].lower()


# ---------------------------------------------------------------------------
# 24. App event mentions photo + no structured record -> MISSING photo consistency
# ---------------------------------------------------------------------------
def test_cleaning_photo_reference_missing(disp003_data):
    result = check_cleaning_photo_reference_consistency(disp003_data)
    assert result["status"] == "MISSING"
    assert "references an attached photo" in result["description"].lower()
    assert "no structured image evidence" in result["description"].lower()


# ---------------------------------------------------------------------------
# 25. Photo mention + structured evidence -> VERIFIED
# ---------------------------------------------------------------------------
def test_cleaning_photo_reference_verified(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = [
        {"image_id": "IMG-001", "image_url": "http://example.com/img.jpg"}
    ]
    result = check_cleaning_photo_reference_consistency(data)
    assert result["status"] == "VERIFIED"


# ---------------------------------------------------------------------------
# 26. No fabricated EXIF analysis
# ---------------------------------------------------------------------------
def test_disp003_no_exif_analysis(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "exif" not in all_text


# ---------------------------------------------------------------------------
# 27. Historical bad_faith/risk data not copied into Prosecutor facts
# ---------------------------------------------------------------------------
def test_disp003_no_historical_risk_in_facts(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    all_text = " ".join(f["description"] for f in _all_facts(report)).lower()
    assert "bad_faith" not in all_text
    assert "risk_score" not in all_text
    assert "prior suspicious" not in all_text
    assert "dispute_history" not in all_text


# ---------------------------------------------------------------------------
# 28. Current DISP-003 report schema valid
# ---------------------------------------------------------------------------
def test_disp003_report_schema_keys_present(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    for key in ("verified_facts", "disputed_facts", "missing_facts", "prosecutor_summary", "report_submitted_at"):
        assert key in report
    for fact in _all_facts(report):
        assert "fact_id" in fact
        assert "description" in fact
        assert "supporting_evidence" in fact
        for ref in fact["supporting_evidence"]:
            assert {"evidence_id", "source_type", "description"} <= ref.keys()


# ---------------------------------------------------------------------------
# 29. No Judge confidence/ruling/recommended action leakage
# ---------------------------------------------------------------------------
def test_disp003_report_no_judge_verdict_leakage(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    for forbidden_key in ("judge_verdict", "ruling_type", "confidence_score", "recommended_action"):
        assert forbidden_key not in report


# ---------------------------------------------------------------------------
# 30. All emitted evidence IDs resolve against build_evidence_index
# ---------------------------------------------------------------------------
def test_disp003_evidence_refs_resolve_against_shared_index(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    index_ids = set(build_evidence_index(disp003_data["data_sources"]).keys())
    referenced_ids = {
        ref["evidence_id"]
        for fact in _all_facts(report)
        for ref in fact["supporting_evidence"]
    }
    assert referenced_ids
    assert referenced_ids.issubset(index_ids)


# ---------------------------------------------------------------------------
# 31. Malformed inputs never crash
# ---------------------------------------------------------------------------
def test_malformed_cleaning_values_never_crash():
    data = {
        "case_metadata": {"dispute_type": "CLEANING_FEE"},
        "data_sources": {
            "app_events": [
                {"event_type": "cleaning_fee_claimed", "timestamp": "bad", "details": 123},
                {"event_type": "trip_completed", "timestamp": None},
                "not-a-dict",
            ],
            "chat_communication": {"transcript": ["not-a-dict", {"sender": "driver"}]},
            "payment_fare_data": None,
            "image_evidence": "not-a-list",
        },
    }
    report = generate_prosecutor_report(data)
    assert "missing_facts" in report
    assert isinstance(report["prosecutor_summary"], str)


# ---------------------------------------------------------------------------
# 32. Summary says "cleaning fee dispute"
# ---------------------------------------------------------------------------
def test_disp003_summary_says_cleaning_fee_dispute(disp003_data):
    report = generate_prosecutor_report(disp003_data)
    assert "cleaning fee dispute" in report["prosecutor_summary"]
    assert "no-show" not in report["prosecutor_summary"].lower()
    assert "route deviation" not in report["prosecutor_summary"].lower()


# ===========================================================================
# BUG #1 — Amount parser regression tests
# ===========================================================================

@pytest.mark.parametrize(
    "details,expected",
    [
        ("claim of $100", 100.0),
        ("claim of $100.00", 100.0),
        ("cleaning fee SGD 100", 100.0),
        ("cleaning fee SGD 100.00", 100.0),
        ("100 SGD cleaning fee", 100.0),
        ("100.00 SGD cleaning fee", 100.0),
        ("submitted 1 photo with cleaning fee claim of $100", 100.0),
        ("2 photos attached, cleaning fee SGD 100", 100.0),
    ],
)
def test_amount_parser_currency_qualified(details, expected):
    event = {"details": details}
    assert _parse_claim_amount_from_event(event) == expected


def test_amount_parser_rejects_bare_numbers():
    event = {"details": "1 photo attached"}
    assert _parse_claim_amount_from_event(event) is None


def test_amount_parser_rejects_multiple_conflicting_amounts():
    event = {"details": "$100 or SGD 150"}
    assert _parse_claim_amount_from_event(event) is None


# ===========================================================================
# BUG #2 — Contradiction / denial detection regression tests
# ===========================================================================

def _make_conflict_data(driver_text: str, rider_text: str) -> dict[str, Any]:
    return {
        "data_sources": {
            "chat_communication": {
                "transcript": [
                    {
                        "message_id": "MSG-D1",
                        "sender": "driver",
                        "content": driver_text,
                        "timestamp": "2026-09-22T02:46:00+08:00",
                    },
                    {
                        "message_id": "MSG-R1",
                        "sender": "rider",
                        "content": rider_text,
                        "timestamp": "2026-09-22T02:47:00+08:00",
                    },
                ]
            }
        }
    }


def test_agreement_case_not_verified():
    data = _make_conflict_data(
        "The back seat is dirty.",
        "Yes, sorry, I spilled my drink.",
    )
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


def test_driver_allegation_plus_rider_denial_verified():
    data = _make_conflict_data(
        "There is a stain.",
        "I didn't spill anything.",
    )
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "VERIFIED"


def test_rider_admission_without_denial_missing():
    data = _make_conflict_data(
        "There is a stain.",
        "Okay.",
    )
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


def test_multiple_rider_messages_one_valid_denial():
    data = {
        "data_sources": {
            "chat_communication": {
                "transcript": [
                    {
                        "message_id": "MSG-R0",
                        "sender": "rider",
                        "content": "Thanks for the ride",
                        "timestamp": "2026-09-22T02:45:00+08:00",
                    },
                    {
                        "message_id": "MSG-D1",
                        "sender": "driver",
                        "content": "You made a mess in my back seat.",
                        "timestamp": "2026-09-22T02:46:00+08:00",
                    },
                    {
                        "message_id": "MSG-R1",
                        "sender": "rider",
                        "content": "I did not vomit at all.",
                        "timestamp": "2026-09-22T02:47:00+08:00",
                    },
                ]
            }
        }
    }
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "VERIFIED"


def test_whenever_not_a_denial():
    data = _make_conflict_data(
        "The seat is dirty.",
        "Whenever I ride I am careful about the seat.",
    )
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "MISSING"


def test_never_spilled_is_denial():
    data = _make_conflict_data(
        "The seat is dirty.",
        "I never spilled anything.",
    )
    result = check_cleaning_conflicting_party_accounts(data)
    assert result["status"] == "VERIFIED"


# ===========================================================================
# BUG #3 — Structured image validation regression tests
# ===========================================================================

def test_structured_image_empty_dict_missing(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = [{}]
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "MISSING"


def test_structured_image_garbage_dict_missing(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = [{"foo": "bar"}]
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "MISSING"


def test_structured_image_none_entry_missing(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = [None]
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "MISSING"


def test_structured_image_string_entry_missing(disp003_data):
    data = copy.deepcopy(disp003_data)
    data["data_sources"]["image_evidence"] = ["garbage"]
    result = check_cleaning_structured_image_evidence(data)
    assert result["status"] == "MISSING"


# ===========================================================================
# BUG #4 — Photo-mention positive/negative detection regression tests
# ===========================================================================

@pytest.mark.parametrize(
    "details",
    [
        "1 photo attached",
        "photo attached",
        "image uploaded",
        "picture submitted",
        "attached 2 photos",
        "driver provided one image",
    ],
)
def test_photo_mention_positive(details):
    event = {"details": details}
    assert _event_mentions_photo(event) is True


@pytest.mark.parametrize(
    "details",
    [
        "no photo attached",
        "without a photo",
        "photo not attached",
        "did not attach an image",
        "no image provided",
        "there is no picture",
    ],
)
def test_photo_mention_negative(details):
    event = {"details": details}
    assert _event_mentions_photo(event) is False


def test_photo_mention_ambiguous_unrelated():
    event = {"details": "We discussed the photo policy."}
    assert _event_mentions_photo(event) is False


# ===========================================================================
# Regression: DISP-001 (ROUTE_DEVIATION) must be unchanged
# ===========================================================================

_EXPECTED_DISP001_VERIFIED_COUNT = 8
_EXPECTED_DISP001_DISPUTED_COUNT = 0
_EXPECTED_DISP001_MISSING_COUNT = 0


def test_disp001_regression_counts(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    assert len(report["verified_facts"]) == _EXPECTED_DISP001_VERIFIED_COUNT
    assert len(report["disputed_facts"]) == _EXPECTED_DISP001_DISPUTED_COUNT
    assert len(report["missing_facts"]) == _EXPECTED_DISP001_MISSING_COUNT


def test_disp001_regression_summary(disp001_data):
    report = generate_prosecutor_report(disp001_data)
    assert "route deviation dispute" in report["prosecutor_summary"]
    assert "no-show" not in report["prosecutor_summary"].lower()
    assert "cleaning fee" not in report["prosecutor_summary"].lower()


# ===========================================================================
# Regression: DISP-002 (NO_SHOW_CHARGE) must be unchanged
# ===========================================================================

_EXPECTED_DISP002_VERIFIED_IDS = [f"F-VER-{i:03d}" for i in range(1, 8)]
_EXPECTED_DISP002_MISSING_IDS = [f"F-MIS-{i:03d}" for i in range(1, 4)]
_EXPECTED_DISP002_SUMMARY = (
    "Prosecutor audit completed for no-show cancellation dispute. "
    "7 of 9 evidentiary checks verified. 3 item(s) missing or unresolved."
)


def test_disp002_regression_dispatch_unchanged():
    assert CHECKS_BY_DISPUTE_TYPE["NO_SHOW_CHARGE"] is NO_SHOW_CHECKS
    assert len(NO_SHOW_CHECKS) == 9


def test_disp002_regression_verified_facts(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert [f["fact_id"] for f in report["verified_facts"]] == _EXPECTED_DISP002_VERIFIED_IDS
    assert len(report["verified_facts"]) == 7


def test_disp002_regression_disputed_facts(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert report["disputed_facts"] == []


def test_disp002_regression_missing_facts(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert [f["fact_id"] for f in report["missing_facts"]] == _EXPECTED_DISP002_MISSING_IDS
    assert len(report["missing_facts"]) == 3


def test_disp002_regression_summary(disp002_data):
    report = generate_prosecutor_report(disp002_data)
    assert report["prosecutor_summary"] == _EXPECTED_DISP002_SUMMARY


# ===========================================================================
# Prosecutor integration
# ===========================================================================

@pytest.mark.asyncio
async def test_disp003_prosecutor_integration_contract(disp003_data):
    result = await run_prosecutor_audit(disp003_data)
    assert set(result.keys()) == {"round_2_cross_exam", "bonus_modules", "prosecutor_findings"}
    assert result["bonus_modules"]["image_exif_analyses"] == []
    assert "fraud_assessment" in result["bonus_modules"]
    assert "escalation_protocol" in result["bonus_modules"]
