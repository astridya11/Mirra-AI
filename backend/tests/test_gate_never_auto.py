"""
Tests for the execution-gate never-auto-action-types check, safety keyword
matching, dispute_value, priority levels, and party-decision escalation.

No LLM, no network. Uses tmp dirs for any escalated files — patches the
escalated directory, never writes into the real backend/escalated.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, Optional
from unittest.mock import patch

from backend.orchestrator.state_machine import (
    CaseContext,
    PipelineEngine,
    PartyDecisionType,
    apply_party_decision,
    _write_escalated_case_file,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_engine(
    case_id: str = "TEST-CASE-001",
    *,
    verdict: Optional[Dict[str, Any]] = None,
    dispute_claim: Optional[Dict[str, Any]] = None,
    case_metadata: Optional[Dict[str, Any]] = None,
    bonus_modules: Optional[Dict[str, Any]] = None,
    data_sources: Optional[Dict[str, Any]] = None,
) -> PipelineEngine:
    """Build a PipelineEngine with a pre-populated CaseContext."""
    engine = PipelineEngine(case_id)

    raw_case: Dict[str, Any] = {
        "case_metadata": {
            "case_id": case_id,
            "dispute_type": "ROUTE_DEVIATION",
            "rider_id": "RIDER-001",
            "driver_id": "DRIVER-001",
            "trip_id": "TRIP-001",
            **(case_metadata or {}),
        },
        "dispute_claim": {
            "case_id": case_id,
            "description": "The driver took a bad route.",
            "dispute_type": "ROUTE_DEVIATION",
            "filed_by": "RIDER",
            **(dispute_claim or {}),
        },
        "data_sources": data_sources or {},
    }
    engine.ctx = CaseContext(case_id, raw_case)
    engine.ctx.data_sources = data_sources or {}
    engine.ctx.bonus_modules = bonus_modules or {"escalation_protocol": {}}
    engine.ctx.judge_verdict = verdict or {
        "ruling_type": "PARTIAL_REFUND",
        "confidence_score": 0.90,
        "recommended_action": {
            "action_type": "PARTIAL_REFUND",
            "refund_amount": 0,
            "cleaning_fee_amount": 0,
            "account_action": "NONE",
        },
    }
    return engine


def _patch_escalated_dir(tmp_path):
    """Monkeypatch _write_escalated_case_file so files go to *tmp_path*."""
    real_write = _write_escalated_case_file

    def _patched(case_id, reasons, confidence, priority_level,
                 ctx_meta, dispute_claim, dispute_value,
                 escalated_dir=None, now=None):
        return real_write(
            case_id=case_id,
            reasons=reasons,
            confidence=confidence,
            priority_level=priority_level,
            ctx_meta=ctx_meta,
            dispute_claim=dispute_claim,
            dispute_value=dispute_value,
            escalated_dir=str(tmp_path),
            now=now,
        )

    return patch(
        "backend.orchestrator.state_machine._write_escalated_case_file",
        side_effect=_patched,
    )


# ---------------------------------------------------------------------------
# 1. CLEANING_FEE_CHARGE → ESCALATED with POL-4/POL-6 reason
# ---------------------------------------------------------------------------

def test_cleaning_fee_charge_escalates(tmp_path):
    engine = _make_engine(
        verdict={
            "ruling_type": "APPROVED",
            "confidence_score": 0.90,
            "recommended_action": {
                "action_type": "CLEANING_FEE_CHARGE",
                "refund_amount": 0,
                "cleaning_fee_amount": 15.0,
                "account_action": "NONE",
            },
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert result["route"] == "ESCALATED_HUMAN_REVIEW"
    assert any("POL-4" in r and "POL-6" in r for r in result["escalation_reasons"])


# ---------------------------------------------------------------------------
# 2. PARTIAL_REFUND SGD 3.25, high confidence → FULLY_AUTOMATED
# ---------------------------------------------------------------------------

def test_partial_refund_small_amount_automated(tmp_path):
    engine = _make_engine(
        verdict={
            "ruling_type": "PARTIAL_REFUND",
            "confidence_score": 0.90,
            "recommended_action": {
                "action_type": "PARTIAL_REFUND",
                "refund_amount": 3.25,
                "cleaning_fee_amount": 0,
                "account_action": "NONE",
            },
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert result["route"] == "FULLY_AUTOMATED"
    assert result["requires_human_signoff"] is False


# ---------------------------------------------------------------------------
# 3. NO_REFUND → FULLY_AUTOMATED
# ---------------------------------------------------------------------------

def test_no_refund_automated(tmp_path):
    engine = _make_engine(
        verdict={
            "ruling_type": "REJECTED",
            "confidence_score": 0.90,
            "recommended_action": {
                "action_type": "NO_REFUND",
                "refund_amount": 0,
                "cleaning_fee_amount": 0,
                "account_action": "NONE",
            },
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert result["route"] == "FULLY_AUTOMATED"


# ---------------------------------------------------------------------------
# 4. Safety keyword whole-word matching
# ---------------------------------------------------------------------------

def test_white_seat_not_safety_threat(tmp_path):
    """'white' must not match as a substring inside another word."""
    engine = _make_engine(
        dispute_claim={"description": "The white seat was dirty.", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    # Should not be escalated for safety reasons
    assert not any("Security threat" in r for r in result["escalation_reasons"])


def test_hit_me_is_safety_threat(tmp_path):
    """'hit' as a whole word should match."""
    engine = _make_engine(
        dispute_claim={"description": "He hit me during the trip.", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert any("Security threat" in r for r in result["escalation_reasons"])
    assert result["route"] == "ESCALATED_HUMAN_REVIEW"


def test_grape_not_safety_threat(tmp_path):
    """'rape' must not match inside 'grape'."""
    engine = _make_engine(
        dispute_claim={"description": "I was eating grapes in the car.", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert not any("Security threat" in r for r in result["escalation_reasons"])


def test_scrape_not_safety_threat(tmp_path):
    """'rape' must not match inside 'scrape'."""
    engine = _make_engine(
        dispute_claim={"description": "There was a scrape on the door.", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert not any("Security threat" in r for r in result["escalation_reasons"])


def test_chinese_keyword_substring_match(tmp_path):
    """Chinese keywords should match as substrings."""
    engine = _make_engine(
        dispute_claim={"description": "司机很危险", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert any("Security threat" in r for r in result["escalation_reasons"])


# ---------------------------------------------------------------------------
# 5. Escalated cleaning-fee case writes dispute_value
# ---------------------------------------------------------------------------

def test_escalated_cleaning_fee_writes_dispute_value(tmp_path):
    case_id = "TEST-DV-001"
    engine = _make_engine(
        case_id=case_id,
        verdict={
            "ruling_type": "APPROVED",
            "confidence_score": 0.90,
            "recommended_action": {
                "action_type": "CLEANING_FEE_CHARGE",
                "refund_amount": 0,
                "cleaning_fee_amount": 30.0,
                "account_action": "NONE",
            },
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()

    assert result["route"] == "ESCALATED_HUMAN_REVIEW"
    escalated_file = os.path.join(str(tmp_path), f"{case_id}.json")
    assert os.path.exists(escalated_file)
    with open(escalated_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["dispute_value"] == 30.0


# ---------------------------------------------------------------------------
# 6. Priority levels — party-decision path
# ---------------------------------------------------------------------------

def _make_completed_case_for_party(
    case_id: str = "TEST-PARTY-001",
    *,
    confidence: float = 0.90,
    recommended_action: Optional[Dict[str, Any]] = None,
    esc_proto: Optional[Dict[str, Any]] = None,
    dispute_claim: Optional[Dict[str, Any]] = None,
    data_sources: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a completed case dict as apply_party_decision expects."""
    action = recommended_action or {
        "action_type": "PARTIAL_REFUND",
        "refund_amount": 3.25,
        "cleaning_fee_amount": 0,
        "account_action": "NONE",
    }
    case: Dict[str, Any] = {
        "case_metadata": {
            "case_id": case_id,
            "dispute_type": "ROUTE_DEVIATION",
            "rider_id": "RIDER-001",
            "driver_id": "DRIVER-001",
            "trip_id": "TRIP-001",
            "resolution_channel": "FULLY_AUTOMATED",
        },
        "dispute_claim": {
            "case_id": case_id,
            "description": "Bad route.",
            "dispute_type": "ROUTE_DEVIATION",
            "filed_by": "RIDER",
            **(dispute_claim or {}),
        },
        "data_sources": data_sources or {},
        "bonus_modules": {
            "escalation_protocol": esc_proto or {
                "safety_threat_detected": False,
                "fraud_risk_level": "LOW",
                "escalation_reasons": [],
                "is_escalated": False,
                "priority_level": "STANDARD",
            },
        },
        "judge_verdict": {
            "ruling_type": "PARTIAL_REFUND",
            "confidence_score": confidence,
            "recommended_action": action,
            "execution_payload": {
                "execution_status": "AUTO_EXECUTED",
                "case_final_status": "AUTO_RESOLVED",
                "transaction_id": "TXN-EXISTING",
            },
        },
    }
    return case


def test_party_request_only_standard(tmp_path):
    """Party request only (no other escalation reason) → STANDARD."""
    case_id = "TEST-PARTY-STD"
    case = _make_completed_case_for_party(case_id=case_id)

    with patch("backend.orchestrator.state_machine._get_completed_case", return_value=case), \
         patch("backend.orchestrator.state_machine._save_case"), \
         _patch_escalated_dir(tmp_path):
        result = asyncio.run(apply_party_decision(case_id, PartyDecisionType.REQUEST_HUMAN_REVIEW))

    esc = result["bonus_modules"]["escalation_protocol"]
    assert esc["priority_level"] == "STANDARD"
    assert esc["is_escalated"] is True
    # The escalated file must exist
    fpath = os.path.join(str(tmp_path), f"{case_id}.json")
    assert os.path.exists(fpath)
    with open(fpath, "r", encoding="utf-8") as f:
        edata = json.load(f)
    assert edata["priority_level"] == "STANDARD"
    assert any("requests human review" in r for r in edata["escalation_reasons"])


def test_party_request_plus_low_confidence_high_priority(tmp_path):
    """Party request + low confidence → HIGH_PRIORITY."""
    case_id = "TEST-PARTY-LOW-CONF"
    case = _make_completed_case_for_party(
        case_id=case_id,
        confidence=0.50,
        esc_proto={
            "safety_threat_detected": False,
            "fraud_risk_level": "LOW",
            "escalation_reasons": [
                "The verdict confidence (0.50) is below the auto-execution threshold (0.75)",
            ],
            "is_escalated": True,
            "priority_level": "HIGH_PRIORITY",
            "party_requested_human": False,
        },
    )

    with patch("backend.orchestrator.state_machine._get_completed_case", return_value=case), \
         patch("backend.orchestrator.state_machine._save_case"), \
         _patch_escalated_dir(tmp_path):
        result = asyncio.run(apply_party_decision(case_id, PartyDecisionType.REQUEST_HUMAN_REVIEW))

    esc = result["bonus_modules"]["escalation_protocol"]
    assert esc["priority_level"] == "HIGH_PRIORITY"


def test_party_request_plus_safety_urgent(tmp_path):
    """Party request + safety threat → URGENT."""
    case_id = "TEST-PARTY-SAFETY"
    case = _make_completed_case_for_party(
        case_id=case_id,
        esc_proto={
            "safety_threat_detected": True,
            "fraud_risk_level": "LOW",
            "escalation_reasons": ["Security threat detection result marked as True"],
            "is_escalated": True,
            "priority_level": "URGENT",
            "party_requested_human": False,
        },
    )

    with patch("backend.orchestrator.state_machine._get_completed_case", return_value=case), \
         patch("backend.orchestrator.state_machine._save_case"), \
         _patch_escalated_dir(tmp_path):
        result = asyncio.run(apply_party_decision(case_id, PartyDecisionType.REQUEST_HUMAN_REVIEW))

    esc = result["bonus_modules"]["escalation_protocol"]
    assert esc["priority_level"] == "URGENT"


# ---------------------------------------------------------------------------
# 7. Auto-resolved case + REQUEST_HUMAN_REVIEW → escalated file with STANDARD
#    and English reason
# ---------------------------------------------------------------------------

def test_auto_resolved_then_party_request_writes_file(tmp_path):
    case_id = "TEST-AUTO-PARTY"
    case = _make_completed_case_for_party(case_id=case_id)

    with patch("backend.orchestrator.state_machine._get_completed_case", return_value=case), \
         patch("backend.orchestrator.state_machine._save_case"), \
         _patch_escalated_dir(tmp_path):
        result = asyncio.run(apply_party_decision(case_id, PartyDecisionType.REQUEST_HUMAN_REVIEW))

    # Escalated file exists
    fpath = os.path.join(str(tmp_path), f"{case_id}.json")
    assert os.path.exists(fpath)
    with open(fpath, "r", encoding="utf-8") as f:
        edata = json.load(f)
    assert edata["priority_level"] == "STANDARD"
    assert any("requests human review" in r for r in edata["escalation_reasons"])
    # No Chinese characters in the escalation reason
    assert not any(any("\u4e00" <= ch <= "\u9fff" for ch in r) for r in edata["escalation_reasons"])


# ---------------------------------------------------------------------------
# 8. Priority in the gate — party-only → STANDARD
# ---------------------------------------------------------------------------

def test_gate_party_only_standard(tmp_path):
    engine = _make_engine(
        bonus_modules={
            "escalation_protocol": {
                "safety_threat_detected": False,
                "fraud_risk_level": "LOW",
                "party_requested_human": True,
            }
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    assert result["route"] == "ESCALATED_HUMAN_REVIEW"
    # priority_level is stored in escalation_proto which is updated in-place
    esc = engine.ctx.bonus_modules["escalation_protocol"]
    assert esc["priority_level"] == "STANDARD"


def test_gate_safety_urgent(tmp_path):
    engine = _make_engine(
        dispute_claim={"description": "There was an assault during the trip.", "filed_by": "RIDER"},
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    esc = engine.ctx.bonus_modules["escalation_protocol"]
    assert esc["priority_level"] == "URGENT"


def test_gate_low_confidence_high_priority(tmp_path):
    engine = _make_engine(
        verdict={
            "ruling_type": "PARTIAL_REFUND",
            "confidence_score": 0.50,
            "recommended_action": {
                "action_type": "PARTIAL_REFUND",
                "refund_amount": 3.0,
                "cleaning_fee_amount": 0,
                "account_action": "NONE",
            },
        },
    )
    with _patch_escalated_dir(tmp_path):
        result = engine._evaluate_execution_gate()
    esc = engine.ctx.bonus_modules["escalation_protocol"]
    assert esc["priority_level"] == "HIGH_PRIORITY"
