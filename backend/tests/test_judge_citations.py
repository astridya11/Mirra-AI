"""
Tests for the Judge agent's citation handling in _post_process.

Citing a disputed or missing fact is NOT a hallucination:
- IDs in verified_fact_references that exist in disputed_facts or missing_facts
  are dropped from the list without penalty.
- Only IDs that don't exist in verified/disputed/missing count as invalid
  citations (−0.20 each).

No LLM, no network — calls _post_process directly with synthetic inputs.
"""

from __future__ import annotations

from typing import Any

from backend.agents.judge_agent import _post_process


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _suggestion(action_type: str = "FULL_REFUND") -> dict:
    """A minimal policy suggestion that won't trigger caps or inconsistencies."""
    return {
        "suggested_recommended_action": {
            "action_type": action_type,
            "refund_amount": 5.0,
            "cleaning_fee_amount": 0,
            "currency": "SGD",
            "account_action": "NONE",
            "penalty_target": "NONE",
        },
        "policy_confidence": 1.0,
        "applicable_clauses": [],
        "matched_precedents": [],
    }


def _raw(
    refs: list[str],
    *,
    ruling: str = "APPROVED",
    action_type: str = "FULL_REFUND",
) -> dict:
    """A minimal LLM raw output."""
    return {
        "ruling_type": ruling,
        "confidence_score": 1.0,
        "reasoning_summary": "Test reasoning.",
        "verified_fact_references": refs,
        "recommended_action": {
            "action_type": action_type,
            "refund_amount": 5.0,
            "cleaning_fee_amount": 0,
            "currency": "SGD",
            "account_action": "NONE",
            "penalty_target": "NONE",
        },
        "policy_clauses_applied": [],
        "precedent_references": [],
        "explanations": {},
    }


# ---------------------------------------------------------------------------
# 1. Disputed fact in refs → dropped, no penalty
# ---------------------------------------------------------------------------

def test_disputed_fact_ref_dropped_without_penalty():
    """refs [F-VER-001, F-DIS-001] with 1 disputed fact:
    invalid_citations should be 0, list = [F-VER-001]."""
    prosecutor = {
        "verified_facts": [{"fact_id": "F-VER-001"}],
        "disputed_facts": [{"fact_id": "F-DIS-001"}],
        "missing_facts": [],
    }
    verdict = _post_process(
        raw=_raw(["F-VER-001", "F-DIS-001"]),
        dispute_type="ROUTE_DEVIATION",
        suggestion=_suggestion(),
        prosecutor=prosecutor,
    )

    # The disputed fact ID is dropped from the list ...
    assert verdict["verified_fact_references"] == ["F-VER-001"]
    # ... but does not count as an invalid citation.
    # rule_confidence = 1.0 - 0.05*1 (disputed) = 0.95
    # confidence_score = min(1.0, 0.95, 1.0) = 0.95
    assert verdict["confidence_score"] == 0.95


# ---------------------------------------------------------------------------
# 2. Non-existent fact in refs → counts as invalid citation
# ---------------------------------------------------------------------------

def test_nonexistent_fact_ref_counts_as_invalid():
    """refs [F-VER-001, F-FAKE-9] where F-FAKE-9 doesn't exist:
    invalid_citations should be 1."""
    prosecutor = {
        "verified_facts": [{"fact_id": "F-VER-001"}],
        "disputed_facts": [],
        "missing_facts": [],
    }
    verdict = _post_process(
        raw=_raw(["F-VER-001", "F-FAKE-9"]),
        dispute_type="ROUTE_DEVIATION",
        suggestion=_suggestion(),
        prosecutor=prosecutor,
    )

    # Only the verified fact survives ...
    assert verdict["verified_fact_references"] == ["F-VER-001"]
    # ... and F-FAKE-9 counts as an invalid citation.
    # rule_confidence = 1.0 - 0.20*1 = 0.80
    # confidence_score = min(1.0, 0.80, 1.0) = 0.80
    assert verdict["confidence_score"] == 0.80


# ---------------------------------------------------------------------------
# 3. Missing fact in refs → dropped, no penalty
# ---------------------------------------------------------------------------

def test_missing_fact_ref_dropped_without_penalty():
    """refs [F-VER-001, F-MIS-001] with 1 missing fact:
    invalid_citations should be 0, list = [F-VER-001]."""
    prosecutor = {
        "verified_facts": [{"fact_id": "F-VER-001"}],
        "disputed_facts": [],
        "missing_facts": [{"fact_id": "F-MIS-001"}],
    }
    verdict = _post_process(
        raw=_raw(["F-VER-001", "F-MIS-001"]),
        dispute_type="ROUTE_DEVIATION",
        suggestion=_suggestion(),
        prosecutor=prosecutor,
    )

    assert verdict["verified_fact_references"] == ["F-VER-001"]
    # rule_confidence = 1.0 - 0.10*1 (missing) = 0.90
    # confidence_score = min(1.0, 0.90, 1.0) = 0.90
    assert verdict["confidence_score"] == 0.90


# ---------------------------------------------------------------------------
# 4. Multiple disputed refs all dropped, no penalty
# ---------------------------------------------------------------------------

def test_all_disputed_refs_dropped():
    """refs [F-VER-001, F-DIS-001, F-DIS-002] with 2 disputed facts:
    invalid_citations should be 0, list = [F-VER-001]."""
    prosecutor = {
        "verified_facts": [{"fact_id": "F-VER-001"}],
        "disputed_facts": [
            {"fact_id": "F-DIS-001"},
            {"fact_id": "F-DIS-002"},
        ],
        "missing_facts": [],
    }
    verdict = _post_process(
        raw=_raw(["F-VER-001", "F-DIS-001", "F-DIS-002"]),
        dispute_type="ROUTE_DEVIATION",
        suggestion=_suggestion(),
        prosecutor=prosecutor,
    )

    assert verdict["verified_fact_references"] == ["F-VER-001"]
    # rule_confidence = 1.0 - 0.05*2 (disputed) = 0.90
    assert verdict["confidence_score"] == 0.90
