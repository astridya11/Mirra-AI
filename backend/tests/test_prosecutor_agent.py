import asyncio
import importlib
import json
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path setup: the test runner invokes pytest from backend/, so Python's
# sys.path contains backend/ (via CWD) but not the repo root.  The agent
# lives at backend.agents.prosecutor_agent, so the repo root must be on
# sys.path for the dotted import to resolve.  We insert it here *before*
# any imports that rely on it.
# ---------------------------------------------------------------------------
_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.services.verification.ingestion import load_case_data, normalize_evidence
from backend.agents.prosecutor_agent import run_prosecutor_audit


# ---------------------------------------------------------------------------
# 1. Module import succeeds
# ---------------------------------------------------------------------------
def test_module_import_succeeds():
    mod = importlib.import_module("backend.agents.prosecutor_agent")
    assert mod is not None


# ---------------------------------------------------------------------------
# 2. Module exposes run_prosecutor_audit
# ---------------------------------------------------------------------------
def test_module_exposes_run_prosecutor_audit():
    mod = importlib.import_module("backend.agents.prosecutor_agent")
    assert hasattr(mod, "run_prosecutor_audit")
    assert callable(mod.run_prosecutor_audit)


# ---------------------------------------------------------------------------
# 3. Agent returns exactly the three required top-level keys
# ---------------------------------------------------------------------------
def test_agent_returns_three_keys():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))

    assert isinstance(result, dict)
    assert set(result.keys()) == {"round_2_cross_exam", "bonus_modules", "prosecutor_findings"}


# ---------------------------------------------------------------------------
# 4. prosecutor_findings remains compatible with ProsecutorReport contract
# ---------------------------------------------------------------------------
def test_prosecutor_findings_schema_compatibility():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))

    findings = result["prosecutor_findings"]
    assert "verified_facts" in findings
    assert "disputed_facts" in findings
    assert "missing_facts" in findings
    assert "prosecutor_summary" in findings
    assert "report_submitted_at" in findings

    for fact in findings["verified_facts"] + findings["disputed_facts"] + findings["missing_facts"]:
        assert "fact_id" in fact
        assert "description" in fact
        assert "supporting_evidence" in fact
        for ref in fact["supporting_evidence"]:
            assert "evidence_id" in ref
            assert "source_type" in ref
            assert "description" in ref


# ---------------------------------------------------------------------------
# 5. round_2_cross_exam contains schema-required fields
# ---------------------------------------------------------------------------
def test_round_2_cross_exam_schema():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))

    r2 = result["round_2_cross_exam"]
    assert "targeted_questions" in r2
    assert "targeted_responses" in r2
    assert "round2_completed" in r2
    assert r2["round2_completed"] is True
    assert "completed_at" in r2
    assert isinstance(r2["targeted_questions"], list)
    assert isinstance(r2["targeted_responses"], list)


# ---------------------------------------------------------------------------
# 6. bonus_modules contains the three required sub-keys and schema-valid fraud assessment
# ---------------------------------------------------------------------------
def test_bonus_modules_structure():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))

    bm = result["bonus_modules"]
    assert "image_exif_analyses" in bm
    assert "fraud_assessment" in bm
    assert "escalation_protocol" in bm

    # fraud_assessment schema validity (now real, not hardcoded placeholder)
    fa = bm["fraud_assessment"]
    assert isinstance(fa["fraud_risk_score"], (int, float))
    assert 0.0 <= fa["fraud_risk_score"] <= 1.0
    assert isinstance(fa["risk_factors"], list)
    assert isinstance(fa["collusion_warning_flag"], bool)
    assert isinstance(fa["abuse_pattern_detected"], bool)
    assert fa["recommended_fraud_action"] in (
        "NO_ACTION", "FLAG_FOR_REVIEW", "BLOCK_ACCOUNT", "REFER_TO_FRAUD_TEAM"
    )

    # escalation_protocol schema validity (now real, not hardcoded placeholder)
    ep = bm["escalation_protocol"]
    assert isinstance(ep["safety_threat_detected"], bool)
    assert ep["fraud_risk_level"] in ("LOW", "MEDIUM", "HIGH")
    assert isinstance(ep["escalation_reasons"], list)
    assert isinstance(ep["is_escalated"], bool)
    assert ep["priority_level"] in ("STANDARD", "HIGH_PRIORITY", "URGENT")


# ---------------------------------------------------------------------------
# 7. Complete return object is JSON serializable
# ---------------------------------------------------------------------------
def test_result_is_json_serializable():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))

    try:
        json.dumps(result, default=str)
    except TypeError as exc:
        pytest.fail(f"Result is not JSON serializable: {exc}")


# ---------------------------------------------------------------------------
# 8. Existing P3 tests continue to pass (enforced by the full suite run)
# ---------------------------------------------------------------------------
# This test file does not break existing P3 tests; the CI/full-suite run
# confirms that.  We include a lightweight sanity check here that the
# deterministic engine still produces the same shape when invoked directly.
def test_underlying_engine_unchanged():
    from app.services.verification.report import generate_prosecutor_report

    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    direct = generate_prosecutor_report(context)
    via_agent = asyncio.run(run_prosecutor_audit(context))

    findings = via_agent["prosecutor_findings"]
    # Compare everything except the timestamp (which differs per call)
    assert findings["verified_facts"] == direct["verified_facts"]
    assert findings["disputed_facts"] == direct["disputed_facts"]
    assert findings["missing_facts"] == direct["missing_facts"]
    assert findings["prosecutor_summary"] == direct["prosecutor_summary"]
    assert "report_submitted_at" in findings


# ---------------------------------------------------------------------------
# 9. DISP-002 without image payload -> image_exif_analyses == []
# ---------------------------------------------------------------------------
def test_disp002_no_images_returns_empty_exif():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    assert result["bonus_modules"]["image_exif_analyses"] == []


# ---------------------------------------------------------------------------
# 10. DISP-003 without actual image payload -> image_exif_analyses == []
# ---------------------------------------------------------------------------
def test_disp003_no_images_returns_empty_exif():
    raw = load_case_data("DISP-003")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    assert result["bonus_modules"]["image_exif_analyses"] == []


# ---------------------------------------------------------------------------
# 11. Agent with valid image evidence returns real ExifAnalysis
# ---------------------------------------------------------------------------
def test_agent_with_image_evidence_returns_exif_analysis():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    # Inject a synthetic image_evidence payload into the context
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-TEST-001",
            "image_url": "s3://bucket/photo.jpg",
            "exif_timestamp": "2026-09-13T08:44:00+08:00",
            "exif_gps_location": {"latitude": 1.2847, "longitude": 103.8382},
            "provider_result": {
                "is_ai_generated": False,
                "ai_generated_confidence": 0.1,
                "stain_damage_classification": "NO_DAMAGE_DETECTED",
                "damage_severity": "MINOR",
            },
        }
    ]
    result = asyncio.run(run_prosecutor_audit(context))
    analyses = result["bonus_modules"]["image_exif_analyses"]
    assert len(analyses) == 1
    assert analyses[0]["image_id"] == "IMG-TEST-001"
    assert analyses[0]["exif_consistent_with_trip"] is True


# ---------------------------------------------------------------------------
# 12. Agent with incomplete image evidence skips, does not fabricate
# ---------------------------------------------------------------------------
def test_agent_skips_incomplete_image_evidence():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-PARTIAL",
            "image_url": "s3://bucket/partial.jpg",
            # Missing exif_timestamp, exif_gps, provider_result
        }
    ]
    result = asyncio.run(run_prosecutor_audit(context))
    analyses = result["bonus_modules"]["image_exif_analyses"]
    assert analyses == []


# ---------------------------------------------------------------------------
# 13. DISP-002 fraud assessment is real, not hardcoded zero
# ---------------------------------------------------------------------------
def test_disp002_fraud_assessment_is_real_not_placeholder():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    fa = result["bonus_modules"]["fraud_assessment"]
    # Rider history has bad_faith_flag + risk_score; score should be > 0
    assert fa["fraud_risk_score"] > 0.0
    assert len(fa["risk_factors"]) > 0
    assert fa["recommended_fraud_action"] in ("NO_ACTION", "FLAG_FOR_REVIEW")
    assert fa["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"


# ---------------------------------------------------------------------------
# 14. DISP-003 fraud assessment is real, not hardcoded zero
# ---------------------------------------------------------------------------
def test_disp003_fraud_assessment_is_real_not_placeholder():
    raw = load_case_data("DISP-003")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    fa = result["bonus_modules"]["fraud_assessment"]
    # Driver history has bad_faith_flag + risk_score; score should be > 0
    assert fa["fraud_risk_score"] > 0.0
    assert len(fa["risk_factors"]) > 0
    assert fa["recommended_fraud_action"] in ("NO_ACTION", "FLAG_FOR_REVIEW")
    assert fa["recommended_fraud_action"] != "REFER_TO_FRAUD_TEAM"


# ---------------------------------------------------------------------------
# 15. Prosecutor agent exact 3-key top-level contract remains unchanged
# ---------------------------------------------------------------------------
def test_prosecutor_agent_three_key_contract_unchanged():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    assert set(result.keys()) == {"round_2_cross_exam", "bonus_modules", "prosecutor_findings"}
    assert set(result["bonus_modules"].keys()) == {
        "image_exif_analyses",
        "fraud_assessment",
        "escalation_protocol",
    }


# ---------------------------------------------------------------------------
# 16. Image analysis behavior remains unchanged
# ---------------------------------------------------------------------------
def test_image_analysis_unchanged_with_real_fraud():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    assert result["bonus_modules"]["image_exif_analyses"] == []

    # With synthetic image evidence
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-TEST-001",
            "image_url": "s3://bucket/photo.jpg",
            "exif_timestamp": "2026-09-13T08:44:00+08:00",
            "exif_gps_location": {"latitude": 1.2847, "longitude": 103.8382},
            "provider_result": {
                "is_ai_generated": False,
                "ai_generated_confidence": 0.1,
                "stain_damage_classification": "NO_DAMAGE_DETECTED",
                "damage_severity": "MINOR",
            },
        }
    ]
    result2 = asyncio.run(run_prosecutor_audit(context))
    analyses = result2["bonus_modules"]["image_exif_analyses"]
    assert len(analyses) == 1
    assert analyses[0]["image_id"] == "IMG-TEST-001"


# ---------------------------------------------------------------------------
# 17. Synthetic strong-fraud scenario triggers REFER_TO_FRAUD_TEAM
# ---------------------------------------------------------------------------
def test_synthetic_strong_fraud_refers_to_fraud_team():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-FAKE-001",
            "image_url": "s3://bucket/fake.jpg",
            "exif_timestamp": "2026-09-13T10:44:00+08:00",  # outside trip window
            "exif_gps_location": {"latitude": 5.0, "longitude": 110.0},  # far away
            "provider_result": {
                "is_ai_generated": True,
                "ai_generated_confidence": 0.95,
                "stain_damage_classification": "VOMIT",
                "damage_severity": "SEVERE",
            },
            "image_hash": "hash-abc",
            "known_matches": {"hash-abc": "DISP-PRIOR-999"},
        }
    ]
    result = asyncio.run(run_prosecutor_audit(context))
    fa = result["bonus_modules"]["fraud_assessment"]
    assert fa["fraud_risk_score"] >= 0.55
    assert fa["recommended_fraud_action"] == "REFER_TO_FRAUD_TEAM"
    assert any("reuse detected" in f for f in fa["risk_factors"])
    assert any("AI-generated" in f for f in fa["risk_factors"])
    assert any("EXIF mismatch" in f for f in fa["risk_factors"])


# ---------------------------------------------------------------------------
# 18. DISP-002 escalation is LOW / not escalated / STANDARD
# ---------------------------------------------------------------------------
def test_disp002_escalation_low_not_escalated():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    ep = result["bonus_modules"]["escalation_protocol"]
    assert ep["safety_threat_detected"] is False
    assert ep["fraud_risk_level"] == "LOW"
    assert ep["escalation_reasons"] == []
    assert ep["is_escalated"] is False
    assert ep["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 19. DISP-003 escalation is LOW / not escalated / STANDARD
# ---------------------------------------------------------------------------
def test_disp003_escalation_low_not_escalated():
    raw = load_case_data("DISP-003")
    context = normalize_evidence(raw)
    result = asyncio.run(run_prosecutor_audit(context))
    ep = result["bonus_modules"]["escalation_protocol"]
    assert ep["safety_threat_detected"] is False
    assert ep["fraud_risk_level"] == "LOW"
    assert ep["escalation_reasons"] == []
    assert ep["is_escalated"] is False
    assert ep["priority_level"] == "STANDARD"


# ---------------------------------------------------------------------------
# 20. Synthetic HIGH fraud escalates with HIGH_PRIORITY
# ---------------------------------------------------------------------------
def test_synthetic_high_fraud_escalates_high_priority():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-FAKE-001",
            "image_url": "s3://bucket/fake.jpg",
            "exif_timestamp": "2026-09-13T10:44:00+08:00",
            "exif_gps_location": {"latitude": 5.0, "longitude": 110.0},
            "provider_result": {
                "is_ai_generated": True,
                "ai_generated_confidence": 0.95,
                "stain_damage_classification": "VOMIT",
                "damage_severity": "SEVERE",
            },
            "image_hash": "hash-abc",
            "known_matches": {"hash-abc": "DISP-PRIOR-999"},
        }
    ]
    result = asyncio.run(run_prosecutor_audit(context))
    ep = result["bonus_modules"]["escalation_protocol"]
    assert ep["fraud_risk_level"] == "HIGH"
    assert ep["is_escalated"] is True
    assert ep["priority_level"] == "HIGH_PRIORITY"
    assert any("HIGH technical risk level" in r for r in ep["escalation_reasons"])


# ---------------------------------------------------------------------------
# 21. Synthetic safety threat produces URGENT priority
# ---------------------------------------------------------------------------
def test_synthetic_safety_threat_urgent():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["case_metadata"]["dispute_type"] = "SAFETY_ALERT"
    result = asyncio.run(run_prosecutor_audit(context))
    ep = result["bonus_modules"]["escalation_protocol"]
    assert ep["safety_threat_detected"] is True
    assert ep["is_escalated"] is True
    assert ep["priority_level"] == "URGENT"
    # DISP-002 has no chat safety signal (safety_threat_keywords_detected is
    # False, no message carries safety_threat_keywords) — this case is
    # SAFETY_ALERT purely by dispute-type classification, so the reason must
    # say that, not fabricate chat evidence that was never present.
    assert any("SAFETY_ALERT dispute" in r for r in ep["escalation_reasons"])
    assert not any("chat evidence" in r.lower() for r in ep["escalation_reasons"])


# ---------------------------------------------------------------------------
# 22. Synthetic safety + HIGH fraud -> URGENT (safety dominates)
# ---------------------------------------------------------------------------
def test_synthetic_safety_and_high_fraud_urgent():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["case_metadata"]["dispute_type"] = "SAFETY_ALERT"
    context["data_sources"]["image_evidence"] = [
        {
            "image_id": "IMG-FAKE-001",
            "image_url": "s3://bucket/fake.jpg",
            "exif_timestamp": "2026-09-13T10:44:00+08:00",
            "exif_gps_location": {"latitude": 5.0, "longitude": 110.0},
            "provider_result": {
                "is_ai_generated": True,
                "ai_generated_confidence": 0.95,
                "stain_damage_classification": "VOMIT",
                "damage_severity": "SEVERE",
            },
            "image_hash": "hash-abc",
            "known_matches": {"hash-abc": "DISP-PRIOR-999"},
        }
    ]
    result = asyncio.run(run_prosecutor_audit(context))
    ep = result["bonus_modules"]["escalation_protocol"]
    assert ep["safety_threat_detected"] is True
    assert ep["fraud_risk_level"] == "HIGH"
    assert ep["is_escalated"] is True
    assert ep["priority_level"] == "URGENT"


# ---------------------------------------------------------------------------
# 23. Escalation reasons are neutral / evidence-grounded
# ---------------------------------------------------------------------------
def test_escalation_reasons_neutral():
    raw = load_case_data("DISP-002")
    context = normalize_evidence(raw)
    context["case_metadata"]["dispute_type"] = "SAFETY_ALERT"
    result = asyncio.run(run_prosecutor_audit(context))
    for reason in result["bonus_modules"]["escalation_protocol"]["escalation_reasons"]:
        assert "committed fraud" not in reason.lower()
        assert "is dangerous" not in reason.lower()
        assert "scam" not in reason.lower()