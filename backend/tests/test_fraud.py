"""Tests for P3 Fraud & Bad-Faith Detection layer."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.verification.fraud import assess_fraud_risk


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empty_context() -> dict[str, Any]:
    return {"data_sources": {}}


def _context_with_profiles(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    return {"data_sources": {"historical_profiles": profiles}}


def _make_image_analysis(**overrides) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "image_id": "IMG-001",
        "image_url": "https://example.com/photo.jpg",
        "exif_timestamp": "2026-09-13T08:44:00+08:00",
        "exif_gps_location": {"latitude": 1.2847, "longitude": 103.8382, "timestamp": "2026-09-13T08:44:00+08:00"},
        "is_ai_generated": False,
        "ai_generated_confidence": 0.05,
        "stain_damage_classification": "NO_DAMAGE_DETECTED",
        "damage_severity": "MINOR",
        "exif_consistent_with_trip": True,
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# 1. No signals -> score 0 or appropriately minimal risk
# ---------------------------------------------------------------------------
def test_no_signals_minimal_risk():
    result = assess_fraud_risk(_empty_context(), [])
    assert result["fraud_risk_score"] == 0.0
    assert result["risk_factors"] == ["No objective fraud risk signals detected"]
    assert result["collusion_warning_flag"] is False
    assert result["abuse_pattern_detected"] is False
    assert result["recommended_fraud_action"] == "NO_ACTION"


# ---------------------------------------------------------------------------
# 2. Malformed/missing historical profile -> safe behavior
# ---------------------------------------------------------------------------
def test_malformed_historical_profiles_safe():
    ctx = {"data_sources": {"historical_profiles": "not-a-list"}}
    result = assess_fraud_risk(ctx, [])
    assert result["fraud_risk_score"] == 0.0
    assert result["recommended_fraud_action"] == "NO_ACTION"


def test_missing_historical_profiles_safe():
    result = assess_fraud_risk(_empty_context(), [])
    assert result["fraud_risk_score"] == 0.0


# ---------------------------------------------------------------------------
# 3. High historical risk alone does NOT become high current-case fraud
# ---------------------------------------------------------------------------
def test_high_historical_risk_alone_capped():
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-999",
            "risk_score": 0.95,
            "bad_faith_flag": True,
            "dispute_history_30d": 5,
            "dispute_history_90d": 10,
            "bad_faith_reason": "Extremely suspicious account",
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["fraud_risk_score"] < 0.55
    assert result["fraud_risk_score"] > 0.0
    assert result["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"
    assert result["recommended_fraud_action"] != "BLOCK_ACCOUNT"


# ---------------------------------------------------------------------------
# 4. bad_faith_flag alone is not proof of current fraud
# ---------------------------------------------------------------------------
def test_bad_faith_flag_alone_not_proof():
    profiles = [
        {
            "party": "DRIVER",
            "party_id": "D-001",
            "bad_faith_flag": True,
            "bad_faith_reason": "Prior issue",
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["fraud_risk_score"] < 0.55
    assert result["abuse_pattern_detected"] is True
    assert "recommended_fraud_action" in result
    assert result["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"


# ---------------------------------------------------------------------------
# 5. Repeated historical disputes can create historical pattern signal
# ---------------------------------------------------------------------------
def test_repeated_disputes_create_historical_pattern():
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-001",
            "bad_faith_flag": True,
            "dispute_history_90d": 5,
            "bad_faith_reason": "Frequent fake claims",
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["abuse_pattern_detected"] is True
    assert "HISTORICAL" in result.get("abuse_pattern_description", "")


# ---------------------------------------------------------------------------
# 6. DISP-002 does not become high-risk fraud solely because rider history is flagged
# ---------------------------------------------------------------------------
def test_disp002_not_high_risk_from_history():
    import json
    from pathlib import Path

    mock_path = Path(__file__).resolve().parent.parent / "mock_data" / "DISP-002.json"
    with open(mock_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    result = assess_fraud_risk(raw, [])
    assert result["fraud_risk_score"] < 0.55
    assert result["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"
    assert result["recommended_fraud_action"] != "BLOCK_ACCOUNT"


# ---------------------------------------------------------------------------
# 7. DISP-003 does not become high-risk fraud solely because driver history is flagged
# ---------------------------------------------------------------------------
def test_disp003_not_high_risk_from_history():
    import json
    from pathlib import Path

    mock_path = Path(__file__).resolve().parent.parent / "mock_data" / "DISP-003.json"
    with open(mock_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    result = assess_fraud_risk(raw, [])
    assert result["fraud_risk_score"] < 0.55
    assert result["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"
    assert result["recommended_fraud_action"] != "BLOCK_ACCOUNT"


# ---------------------------------------------------------------------------
# 8. Recycled image creates a strong current evidence signal
# ---------------------------------------------------------------------------
def test_recycled_image_creates_strong_signal():
    img = _make_image_analysis(recycled_image_detected=True, recycled_image_match_case_id="DISP-OLD-001")
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] >= 0.30
    assert any("reuse detected" in f for f in result["risk_factors"])


# ---------------------------------------------------------------------------
# 9. Recycled image includes matched-case context in risk_factors when available
# ---------------------------------------------------------------------------
def test_recycled_image_includes_match_context():
    img = _make_image_analysis(
        image_id="IMG-R1",
        recycled_image_detected=True,
        recycled_image_match_case_id="DISP-PRIOR-42",
    )
    result = assess_fraud_risk(_empty_context(), [img])
    factors = result["risk_factors"]
    assert any("DISP-PRIOR-42" in f for f in factors)
    assert any("IMG-R1" in f for f in factors)


# ---------------------------------------------------------------------------
# 10. AI-generated image contributes according to provider confidence
# ---------------------------------------------------------------------------
def test_ai_generated_low_confidence_modest_contribution():
    img = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.20)
    result = assess_fraud_risk(_empty_context(), [img])
    low = result["fraud_risk_score"]

    img2 = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.90)
    result2 = assess_fraud_risk(_empty_context(), [img2])
    high = result2["fraud_risk_score"]

    assert high > low
    assert low > 0.0


# ---------------------------------------------------------------------------
# 11. EXIF inconsistency contributes risk
# ---------------------------------------------------------------------------
def test_exif_inconsistency_contributes_risk():
    img = _make_image_analysis(exif_consistent_with_trip=False)
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] > 0.15
    assert any("EXIF mismatch" in f for f in result["risk_factors"])


# ---------------------------------------------------------------------------
# 12. Unknown/missing EXIF consistency does NOT count as mismatch
# ---------------------------------------------------------------------------
def test_missing_exif_consistency_not_counted():
    img = _make_image_analysis()
    del img["exif_consistent_with_trip"]
    result = assess_fraud_risk(_empty_context(), [img])
    assert not any("EXIF mismatch" in f for f in result["risk_factors"])
    assert result["fraud_risk_score"] == 0.0


# ---------------------------------------------------------------------------
# 13. Multiple independent current signals increase score
# ---------------------------------------------------------------------------
def test_multiple_signals_increase_score():
    img1 = _make_image_analysis(
        is_ai_generated=True,
        ai_generated_confidence=0.80,
        exif_consistent_with_trip=False,
    )
    single_ai = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.80)
    single_exif = _make_image_analysis(exif_consistent_with_trip=False)

    multi = assess_fraud_risk(_empty_context(), [img1])
    ai_only = assess_fraud_risk(_empty_context(), [single_ai])
    exif_only = assess_fraud_risk(_empty_context(), [single_exif])

    assert multi["fraud_risk_score"] > ai_only["fraud_risk_score"]
    assert multi["fraud_risk_score"] > exif_only["fraud_risk_score"]


# ---------------------------------------------------------------------------
# 14. Score is always clamped [0, 1]
# ---------------------------------------------------------------------------
def test_score_clamped_to_range():
    # Extreme scenario: many recycled images + high history
    images = [
        _make_image_analysis(image_id=f"IMG-{i}", recycled_image_detected=True)
        for i in range(10)
    ]
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-X",
            "risk_score": 1.0,
            "bad_faith_flag": True,
            "dispute_history_30d": 10,
            "dispute_history_90d": 20,
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), images)
    assert 0.0 <= result["fraud_risk_score"] <= 1.0


# ---------------------------------------------------------------------------
# 15. Clean image evidence does not create fraud signal
# ---------------------------------------------------------------------------
def test_clean_image_no_fraud_signal():
    img = _make_image_analysis(
        is_ai_generated=False,
        ai_generated_confidence=0.01,
        exif_consistent_with_trip=True,
    )
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] == 0.0
    assert result["recommended_fraud_action"] == "NO_ACTION"


# ---------------------------------------------------------------------------
# 16. Negative sentiment alone does not create fraud signal
# ---------------------------------------------------------------------------
def test_negative_sentiment_alone_no_fraud():
    ctx = {
        "data_sources": {
            "chat_communication": {
                "overall_sentiment_score": -0.9,
                "safety_threat_keywords_detected": False,
            }
        }
    }
    result = assess_fraud_risk(ctx, [])
    assert result["fraud_risk_score"] == 0.0


# ---------------------------------------------------------------------------
# 17. Disputed amount alone does not create fraud signal
# ---------------------------------------------------------------------------
def test_disputed_amount_alone_no_fraud():
    ctx = {
        "data_sources": {
            "payment_fare_data": {"disputed_amount": 999.0}
        }
    }
    result = assess_fraud_risk(ctx, [])
    assert result["fraud_risk_score"] == 0.0


# ---------------------------------------------------------------------------
# 18. Collusion remains false when no actual collusion evidence exists
# ---------------------------------------------------------------------------
def test_collusion_false_without_evidence():
    profiles = [
        {"party": "RIDER", "party_id": "R-1", "risk_score": 0.8, "bad_faith_flag": True},
        {"party": "DRIVER", "party_id": "D-1", "risk_score": 0.8, "bad_faith_flag": True},
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["collusion_warning_flag"] is False
    assert "collusion_evidence" not in result


# ---------------------------------------------------------------------------
# 19. BLOCK_ACCOUNT is never automatically recommended
# ---------------------------------------------------------------------------
def test_block_account_never_recommended():
    # Extreme current + historical signals
    img = _make_image_analysis(
        is_ai_generated=True,
        ai_generated_confidence=1.0,
        exif_consistent_with_trip=False,
        recycled_image_detected=True,
    )
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-X",
            "risk_score": 1.0,
            "bad_faith_flag": True,
            "dispute_history_90d": 20,
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [img])
    assert result["recommended_fraud_action"] != "BLOCK_ACCOUNT"


# ---------------------------------------------------------------------------
# 20. Objective high-risk multi-signal case can recommend REFER_TO_FRAUD_TEAM
# ---------------------------------------------------------------------------
def test_high_risk_multi_signal_refers_to_fraud_team():
    img = _make_image_analysis(
        is_ai_generated=True,
        ai_generated_confidence=0.90,
        exif_consistent_with_trip=False,
        recycled_image_detected=True,
        recycled_image_match_case_id="DISP-OLD-001",
    )
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] >= 0.55
    assert result["recommended_fraud_action"] == "REFER_TO_FRAUD_TEAM"


# ---------------------------------------------------------------------------
# 21. History-only case can recommend at most FLAG_FOR_REVIEW
# ---------------------------------------------------------------------------
def test_history_only_max_flag_for_review():
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-1",
            "risk_score": 0.95,
            "bad_faith_flag": True,
            "dispute_history_30d": 5,
            "dispute_history_90d": 10,
            "bad_faith_reason": "Many disputes",
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["recommended_fraud_action"] in ("NO_ACTION", "FLAG_FOR_REVIEW")
    assert result["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"


# ---------------------------------------------------------------------------
# 22-24. These are integration tests and live in test_prosecutor_agent.py
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Additional edge-case coverage
# ---------------------------------------------------------------------------

def test_boolean_risk_score_ignored():
    """Boolean True should not be treated as risk_score 1.0."""
    profiles = [
        {
            "party": "RIDER",
            "party_id": "R-1",
            "risk_score": True,  # bool, not number
            "bad_faith_flag": False,
        }
    ]
    result = assess_fraud_risk(_context_with_profiles(profiles), [])
    assert result["fraud_risk_score"] == 0.0


def test_ai_generated_false_does_not_contribute():
    img = _make_image_analysis(is_ai_generated=False, ai_generated_confidence=0.99)
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] == 0.0


def test_exif_consistent_true_does_not_contribute():
    img = _make_image_analysis(exif_consistent_with_trip=True)
    result = assess_fraud_risk(_empty_context(), [img])
    assert result["fraud_risk_score"] == 0.0


def test_abuse_pattern_description_distinguishes_current_and_historical():
    profiles = [
        {
            "party": "DRIVER",
            "party_id": "D-1",
            "bad_faith_flag": True,
            "dispute_history_90d": 4,
            "bad_faith_reason": "Suspicious claims",
        }
    ]
    img = _make_image_analysis(recycled_image_detected=True)
    result = assess_fraud_risk(_context_with_profiles(profiles), [img])
    assert result["abuse_pattern_detected"] is True
    desc = result.get("abuse_pattern_description", "")
    assert "CURRENT" in desc
    assert "HISTORICAL pattern" in desc
