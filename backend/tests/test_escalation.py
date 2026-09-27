"""Tests for P3 Safety & Escalation Signals layer."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.verification.escalation import assess_escalation_signals


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empty_context() -> dict[str, Any]:
    return {"data_sources": {}}


def _make_fraud_assessment(score: float = 0.0, action: str = "NO_ACTION") -> dict[str, Any]:
    return {
        "fraud_risk_score": score,
        "risk_factors": [],
        "collusion_warning_flag": False,
        "abuse_pattern_detected": False,
        "recommended_fraud_action": action,
    }


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
# 1. clean case -> LOW / not escalated / STANDARD
# ---------------------------------------------------------------------------
def test_clean_case_low_not_escalated_standard():
    result = assess_escalation_signals(_empty_context(), _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is False
    assert result["fraud_risk_level"] == "LOW"
    assert result["escalation_reasons"] == []
    assert result["is_escalated"] is False
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 2. negative sentiment alone -> no safety threat
# ---------------------------------------------------------------------------
def test_negative_sentiment_alone_no_safety():
    ctx = {
        "data_sources": {
            "chat_communication": {
                "overall_sentiment_score": -0.9,
                "safety_threat_keywords_detected": False,
                "transcript": [
                    {"message_id": "M1", "sender": "driver", "content": "You idiot!", "sentiment_score": -0.9, "safety_threat_keywords": []}
                ],
            }
        }
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is False


# ---------------------------------------------------------------------------
# 3. structured safety flag true -> safety detected
# ---------------------------------------------------------------------------
def test_structured_safety_flag_detected():
    ctx = {
        "data_sources": {
            "chat_communication": {
                "safety_threat_keywords_detected": True,
                "transcript": [],
            }
        }
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is True
    assert result["is_escalated"] is True
    assert result["priority_level"] == "URGENT"


# ---------------------------------------------------------------------------
# 4. per-message safety keywords -> safety detected
# ---------------------------------------------------------------------------
def test_per_message_safety_keywords_detected():
    ctx = {
        "data_sources": {
            "chat_communication": {
                "safety_threat_keywords_detected": False,
                "transcript": [
                    {"message_id": "M1", "sender": "driver", "content": "watch out", "safety_threat_keywords": ["violence", "weapon"]}
                ],
            }
        }
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is True
    assert result["is_escalated"] is True


# ---------------------------------------------------------------------------
# 5. SAFETY_ALERT dispute -> safety detected
# ---------------------------------------------------------------------------
def test_safety_alert_dispute_detected():
    ctx = {
        "case_metadata": {"dispute_type": "SAFETY_ALERT"},
        "data_sources": {},
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is True
    assert result["is_escalated"] is True
    assert result["priority_level"] == "URGENT"


# ---------------------------------------------------------------------------
# 6. history-only DISP-002 -> LOW, not escalated
# ---------------------------------------------------------------------------
def test_disp002_history_only_low():
    import json
    from pathlib import Path

    mock_path = Path(__file__).resolve().parent.parent / "mock_data" / "DISP-002.json"
    with open(mock_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    fraud = _make_fraud_assessment(score=0.217, action="FLAG_FOR_REVIEW")
    result = assess_escalation_signals(raw, fraud)
    assert result["fraud_risk_level"] == "LOW"
    assert result["is_escalated"] is False
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 7. history-only DISP-003 -> LOW, not escalated
# ---------------------------------------------------------------------------
def test_disp003_history_only_low():
    import json
    from pathlib import Path

    mock_path = Path(__file__).resolve().parent.parent / "mock_data" / "DISP-003.json"
    with open(mock_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    fraud = _make_fraud_assessment(score=0.33, action="FLAG_FOR_REVIEW")
    result = assess_escalation_signals(raw, fraud)
    assert result["fraud_risk_level"] == "LOW"
    assert result["is_escalated"] is False
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 8. MEDIUM fraud -> not automatically escalated
# ---------------------------------------------------------------------------
def test_medium_fraud_not_escalated():
    fraud = _make_fraud_assessment(score=0.55, action="FLAG_FOR_REVIEW")
    img = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.80)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["fraud_risk_level"] == "MEDIUM"
    assert result["is_escalated"] is False
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 9. HIGH objective fraud -> HIGH + escalated
# ---------------------------------------------------------------------------
def test_high_objective_fraud_escalated():
    fraud = _make_fraud_assessment(score=0.85, action="REFER_TO_FRAUD_TEAM")
    img = _make_image_analysis(recycled_image_detected=True)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["fraud_risk_level"] == "HIGH"
    assert result["is_escalated"] is True
    assert result["priority_level"] == "HIGH_PRIORITY"
    assert any("HIGH technical risk level" in r for r in result["escalation_reasons"])


# ---------------------------------------------------------------------------
# 10. HIGH history-only synthetic input -> must not become HIGH
# ---------------------------------------------------------------------------
def test_high_history_only_synthetic_capped_to_medium():
    # Simulate a malformed/high history-only score without current signals
    fraud = _make_fraud_assessment(score=0.95, action="FLAG_FOR_REVIEW")
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[])
    # Without current signals, HIGH should be downgraded to MEDIUM
    assert result["fraud_risk_level"] != "HIGH"
    assert result["fraud_risk_level"] == "MEDIUM"
    assert result["is_escalated"] is False


# ---------------------------------------------------------------------------
# 11. safety -> URGENT
# ---------------------------------------------------------------------------
def test_safety_urgent_priority():
    ctx = {"case_metadata": {"dispute_type": "SAFETY_ALERT"}, "data_sources": {}}
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["priority_level"] == "URGENT"


# ---------------------------------------------------------------------------
# 12. HIGH fraud without safety -> HIGH_PRIORITY
# ---------------------------------------------------------------------------
def test_high_fraud_no_safety_high_priority():
    fraud = _make_fraud_assessment(score=0.85, action="REFER_TO_FRAUD_TEAM")
    img = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.95)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["priority_level"] == "HIGH_PRIORITY"
    assert result["priority_level"] != "URGENT"


# ---------------------------------------------------------------------------
# 13. safety + HIGH fraud -> URGENT
# ---------------------------------------------------------------------------
def test_safety_and_high_fraud_urgent():
    ctx = {"case_metadata": {"dispute_type": "SAFETY_ALERT"}, "data_sources": {}}
    fraud = _make_fraud_assessment(score=0.85, action="REFER_TO_FRAUD_TEAM")
    img = _make_image_analysis(recycled_image_detected=True)
    result = assess_escalation_signals(ctx, fraud, image_analyses=[img])
    assert result["priority_level"] == "URGENT"
    assert result["is_escalated"] is True


# ---------------------------------------------------------------------------
# 14. LOW -> STANDARD
# ---------------------------------------------------------------------------
def test_low_standard_priority():
    result = assess_escalation_signals(_empty_context(), _make_fraud_assessment(0.15))
    assert result["fraud_risk_level"] == "LOW"
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 15. no fabricated missing_crucial_evidence
# ---------------------------------------------------------------------------
def test_no_fabricated_missing_crucial_evidence():
    result = assess_escalation_signals(_empty_context(), _make_fraud_assessment(0.0))
    assert "missing_crucial_evidence" not in result


# ---------------------------------------------------------------------------
# 16. malformed fraud assessment fails safely
# ---------------------------------------------------------------------------
def test_malformed_fraud_assessment_safe():
    result = assess_escalation_signals(_empty_context(), "not-a-dict")
    assert result["fraud_risk_level"] == "LOW"
    assert result["is_escalated"] is False

    result2 = assess_escalation_signals(_empty_context(), {})
    assert result2["fraud_risk_level"] == "LOW"
    assert result2["is_escalated"] is False


# ---------------------------------------------------------------------------
# 17. fraud score bool rejected safely
# ---------------------------------------------------------------------------
def test_fraud_score_bool_rejected():
    fraud = {"fraud_risk_score": True, "risk_factors": [], "collusion_warning_flag": False, "abuse_pattern_detected": False}
    result = assess_escalation_signals(_empty_context(), fraud)
    assert result["fraud_risk_level"] == "LOW"


# ---------------------------------------------------------------------------
# 18. fraud score NaN/Infinity rejected safely
# ---------------------------------------------------------------------------
def test_fraud_score_nan_inf_rejected():
    import math

    fraud_nan = {"fraud_risk_score": float("nan"), "risk_factors": [], "collusion_warning_flag": False, "abuse_pattern_detected": False}
    result = assess_escalation_signals(_empty_context(), fraud_nan)
    assert result["fraud_risk_level"] == "LOW"

    fraud_inf = {"fraud_risk_score": float("inf"), "risk_factors": [], "collusion_warning_flag": False, "abuse_pattern_detected": False}
    result2 = assess_escalation_signals(_empty_context(), fraud_inf)
    assert result2["fraud_risk_level"] == "LOW"


# ---------------------------------------------------------------------------
# 19. escalation reasons neutral / evidence-grounded
# ---------------------------------------------------------------------------
def test_escalation_reasons_neutral():
    ctx = {"case_metadata": {"dispute_type": "SAFETY_ALERT"}, "data_sources": {}}
    fraud = _make_fraud_assessment(score=0.85, action="REFER_TO_FRAUD_TEAM")
    img = _make_image_analysis(recycled_image_detected=True)
    result = assess_escalation_signals(ctx, fraud, image_analyses=[img])
    for reason in result["escalation_reasons"]:
        assert "committed fraud" not in reason.lower()
        assert "is dangerous" not in reason.lower()
        assert "scam" not in reason.lower()
        assert "rider" not in reason.lower() or "signal" in reason.lower()


# ---------------------------------------------------------------------------
# 20. Judge confidence is not read or used
# ---------------------------------------------------------------------------
def test_judge_confidence_not_used():
    ctx = {
        "data_sources": {},
        "case_metadata": {"judge_confidence": 0.3, "dispute_type": "NO_SHOW_CHARGE"},
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    # Should not escalate solely because judge_confidence is low
    assert result["is_escalated"] is False
    assert result["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 21. missing_crucial_evidence flag only when many missing facts
# ---------------------------------------------------------------------------
def test_missing_crucial_evidence_conservative():
    findings_few = {"missing_facts": [{"fact_id": "F1", "description": "x"}]}
    result = assess_escalation_signals(_empty_context(), _make_fraud_assessment(0.0), findings_few)
    assert "missing_crucial_evidence" not in result

    findings_many = {"missing_facts": [{"fact_id": f"F{i}", "description": "x"} for i in range(5)]}
    result2 = assess_escalation_signals(_empty_context(), _make_fraud_assessment(0.0), findings_many)
    assert result2.get("missing_crucial_evidence") is True


# ---------------------------------------------------------------------------
# 22. MEDIUM fraud with current signals stays MEDIUM
# ---------------------------------------------------------------------------
def test_medium_fraud_with_current_signals():
    fraud = _make_fraud_assessment(score=0.55, action="FLAG_FOR_REVIEW")
    img = _make_image_analysis(is_ai_generated=True, ai_generated_confidence=0.80)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["fraud_risk_level"] == "MEDIUM"
    assert result["is_escalated"] is False


# ---------------------------------------------------------------------------
# 23. LOW boundary score
# ---------------------------------------------------------------------------
def test_low_boundary_score():
    fraud = _make_fraud_assessment(score=0.39)
    result = assess_escalation_signals(_empty_context(), fraud)
    assert result["fraud_risk_level"] == "LOW"


# ---------------------------------------------------------------------------
# 24. MEDIUM boundary score
# ---------------------------------------------------------------------------
def test_medium_boundary_score():
    fraud = _make_fraud_assessment(score=0.40)
    img = _make_image_analysis(exif_consistent_with_trip=False)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["fraud_risk_level"] == "MEDIUM"


# ---------------------------------------------------------------------------
# 25. HIGH boundary score with current signals
# ---------------------------------------------------------------------------
def test_high_boundary_score_with_signals():
    fraud = _make_fraud_assessment(score=0.70)
    img = _make_image_analysis(recycled_image_detected=True)
    result = assess_escalation_signals(_empty_context(), fraud, image_analyses=[img])
    assert result["fraud_risk_level"] == "HIGH"
    assert result["is_escalated"] is True


# ---------------------------------------------------------------------------
# 26. SAFETY_ALERT dispute with NO chat evidence must not claim chat evidence
# ---------------------------------------------------------------------------
def test_safety_alert_dispute_reason_does_not_fabricate_chat_evidence():
    ctx = {
        "case_metadata": {"dispute_type": "SAFETY_ALERT"},
        "data_sources": {
            "chat_communication": {
                "safety_threat_keywords_detected": False,
                "transcript": [
                    {"message_id": "M1", "sender": "driver", "content": "ok", "safety_threat_keywords": []}
                ],
            }
        },
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is True
    assert any("SAFETY_ALERT dispute" in r for r in result["escalation_reasons"])
    assert not any("chat evidence" in r.lower() for r in result["escalation_reasons"])


# ---------------------------------------------------------------------------
# 27. Chat evidence alone reports chat provenance, not dispute classification
# ---------------------------------------------------------------------------
def test_chat_safety_signal_reason_does_not_claim_dispute_classification():
    ctx = {
        "case_metadata": {"dispute_type": "NO_SHOW_CHARGE"},
        "data_sources": {
            "chat_communication": {
                "safety_threat_keywords_detected": True,
                "transcript": [],
            }
        },
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    assert result["safety_threat_detected"] is True
    assert any("chat safety signal" in r.lower() for r in result["escalation_reasons"])
    assert not any("SAFETY_ALERT dispute" in r for r in result["escalation_reasons"])


# ---------------------------------------------------------------------------
# 28. Both chat sources firing together collapse into one reason, not two
# ---------------------------------------------------------------------------
def test_both_chat_safety_sources_collapse_to_one_reason():
    ctx = {
        "data_sources": {
            "chat_communication": {
                "safety_threat_keywords_detected": True,
                "transcript": [
                    {"message_id": "M1", "sender": "driver", "content": "x", "safety_threat_keywords": ["weapon"]}
                ],
            }
        }
    }
    result = assess_escalation_signals(ctx, _make_fraud_assessment(0.0))
    chat_reasons = [r for r in result["escalation_reasons"] if "chat safety signal" in r.lower()]
    assert len(chat_reasons) == 1


# ---------------------------------------------------------------------------
# 29. No image_analyses input at all -> conservative False, not inferred
#     from the fraud assessment's advisory recommended_fraud_action string
# ---------------------------------------------------------------------------
def test_no_image_analyses_input_does_not_infer_current_signals_from_action():
    fraud = _make_fraud_assessment(score=0.85, action="REFER_TO_FRAUD_TEAM")
    # image_analyses omitted entirely (defaults to None) -- no objective
    # evidence input was actually supplied, so this must not become HIGH.
    result = assess_escalation_signals(_empty_context(), fraud)
    assert result["fraud_risk_level"] != "HIGH"
    assert result["is_escalated"] is False
