"""
Test for the Judge Agent using the DISP-002 (NO_SHOW_CHARGE) case.

Run with the real DeepSeek API:
    python backend/tests/test_judge_disp002.py

Run in mock mode (no API key needed):
    python backend/tests/test_judge_disp002.py --mock
"""

import asyncio
import copy
import json
import sys
from pathlib import Path

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend.agents...` imports work

from backend.agents import judge_agent  # noqa: E402
from backend.agents.judge_agent import run_judge  # noqa: E402


# --- Load mock data + fixture --------------------------------------------------

_MOCK_DATA = _BACKEND_DIR / "mock_data" / "DISP-002.json"
_FIXTURE = _BACKEND_DIR / "tests" / "fixtures" / "DISP-002_judge_input.json"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _build_context() -> dict:
    """Build the judge context from DISP-002 mock data and the test fixture."""
    mock_case = _load_json(_MOCK_DATA)
    fixture = _load_json(_FIXTURE)

    return {
        "case_metadata": mock_case["case_metadata"],
        "data_sources": mock_case["data_sources"],
        "round_1_statements": fixture["round_1_statements"],
        "round_2_cross_exam": {
            "targeted_questions": [],
            "targeted_responses": [],
            "round2_completed": True,
        },
        "prosecutor_findings": fixture["prosecutor_findings"],
        "policy_consultation": fixture.get("policy_consultation", {}),
        "bonus_modules": {},
    }


# --- Mock LLM response --------------------------------------------------------

# Simulates what the LLM would return for DISP-002: all no-show conditions met,
# so the claim is REJECTED (rider's refund request denied).
_MOCK_LLM_RESPONSE = {
    "ruling_type": "REJECTED",
    "confidence_score": 0.90,
    "reasoning_summary": (
        "All five no-show conditions under POL-3 are verified by system "
        "records: driver arrived within radius, remained stationary, rider "
        "was notified, driver made multiple contact attempts, and "
        "cancellation occurred at the 8-minute threshold. The rider's claim "
        "of being present is unsupported by evidence (F-DIS-001, F-MIS-001). "
        "The cancellation fee is upheld."
    ),
    "verified_fact_references": [
        "F-VER-001",
        "F-VER-002",
        "F-VER-003",
        "F-VER-004",
        "F-VER-005",
    ],
    "policy_clauses_applied": ["POL-3"],
    "precedent_references": [],
    "recommended_action": {
        "action_type": "NO_REFUND",
        "refund_amount": 0,
        "cleaning_fee_amount": 0,
        "currency": "SGD",
        "penalty_target": "NONE",
        "account_action": "NONE",
    },
    "explanations": {
        "explanation_for_rider": (
            "We understand you feel you were at the lobby waiting, and "
            "this outcome may be disappointing. Our records show that the "
            "driver arrived at the pickup point early, waited for the "
            "full waiting period, and that the system sent you a "
            "notification that the driver had arrived. The driver also "
            "sent several messages and made a call. Because the waiting "
            "period was fully reached without you boarding, the "
            "cancellation fee of $5.00 will remain in place. A tip for "
            "future trips: confirming the exact pickup entrance or "
            "landmark in the app can help the driver locate you quickly. "
            "You may appeal or request human review within 7 days."
        ),
        "explanation_for_driver": (
            "We appreciate that you arrived on time, waited patiently, "
            "and made multiple efforts to contact the rider. Your "
            "patience and professionalism are noted. The cancellation "
            "fee of $5.00 is upheld because the full waiting period was "
            "reached, the system had notified the rider of your arrival, "
            "and you made contact attempts as required. No penalty will "
            "be applied to your account. You may appeal or request "
            "human review within 7 days."
        ),
    },
}


async def _mock_call_llm_json(system_prompt: str, user_prompt: str, **kwargs) -> dict:
    """Drop-in replacement for call_llm_json that returns a canned response."""
    return _MOCK_LLM_RESPONSE


# --- Test 1: agreement with policy consultant ---------------------------------


async def _run_test1(mock: bool = False) -> None:
    """Test 1: facts show a no-show, policy says REJECTED, judge agrees."""
    context = _build_context()

    if mock:
        original = judge_agent.call_llm_json
        judge_agent.call_llm_json = _mock_call_llm_json
        print("[MOCK MODE] Using fake LLM response (no API key needed)\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    # --- Print the verdict ---
    print("=" * 60)
    print("TEST 1 — JUDGE VERDICT for DISP-002 (agreement)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    # --- Assertions ---
    ruling = verdict.get("ruling_type", "")
    action = verdict.get("recommended_action", {})
    action_type = action.get("action_type", "")
    refund_amount = action.get("refund_amount", -1)
    clauses = verdict.get("policy_clauses_applied", [])

    errors: list[str] = []

    if ruling != "REJECTED":
        errors.append(f"Expected ruling_type == REJECTED, got {ruling}")

    if action_type != "NO_REFUND":
        errors.append(f"Expected action_type == NO_REFUND, got {action_type}")

    if refund_amount != 0:
        errors.append(f"Expected refund_amount == 0, got {refund_amount}")

    if "POL-3" not in clauses:
        errors.append(f"Expected 'POL-3' in policy_clauses_applied, got {clauses}")

    if errors:
        print("\nTEST 1 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 1 RESULT: PASS")
        print("  - ruling_type == REJECTED")
        print("  - action_type == NO_REFUND")
        print("  - refund_amount == 0")
        print("  - 'POL-3' in policy_clauses_applied")


# --- Test 2: judge disagrees with policy consultant ---------------------------


async def _run_test2(mock: bool = False) -> None:
    """Test 2: suggestion says APPROVED + FULL_REFUND 5.0, facts still show
    a no-show. The judge disagrees with the suggestion.
    Assert confidence_score <= 0.70.
    """
    context = _build_context()

    # Override the suggestion to say APPROVED + FULL_REFUND.
    context["policy_consultation"] = {
        "suggestion": {
            "suggestion_id": "SUG-DISP-002-002",
            "request_id": "REQ-DISP-002-001",
            "applicable_clauses": [
                {
                    "clause_id": "POL-3",
                    "clause_title": "No-Show Cancellation Charge",
                    "clause_text_summary": "If a driver arrives and waits for the full no-show threshold while the rider does not board, a cancellation fee may be charged.",
                    "relevance_summary": "All five no-show conditions verified."
                }
            ],
            "matched_precedents": [],
            "suggested_ruling_type": "APPROVED",
            "suggested_recommended_action": {
                "action_type": "FULL_REFUND",
                "refund_amount": 5.0,
                "currency": "SGD"
            },
            "policy_confidence": 0.9,
            "rationale": "Driver waited the full no-show threshold per POL-3.",
            "suggested_at": "2026-09-13T09:19:00+08:00"
        }
    }

    # Mock LLM returns REJECTED (judge disagrees with APPROVED suggestion).
    mock_response = copy.deepcopy(_MOCK_LLM_RESPONSE)
    # action_type matches the suggestion's FULL_REFUND so amounts are copied,
    # but ruling_type differs from suggested APPROVED -> confidence capped at 0.70.
    mock_response["recommended_action"]["action_type"] = "FULL_REFUND"
    mock_response["recommended_action"]["refund_amount"] = 5.0

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_disagree(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response

        judge_agent.call_llm_json = _mock_llm_disagree
        print("[MOCK MODE] Using fake LLM response for test 2\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 2 — JUDGE VERDICT for DISP-002 (disagreement, confidence cap)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    confidence = verdict.get("confidence_score", 1.0)

    errors: list[str] = []

    if confidence > 0.70:
        errors.append(
            f"Expected confidence_score <= 0.70 (ruling differs from suggestion), "
            f"got {confidence}"
        )

    if errors:
        print("\nTEST 2 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 2 RESULT: PASS")
        print(f"  - confidence_score == {confidence} (<= 0.70)")


# --- Test 3: missing policy consultation ---------------------------------------


async def _run_test3(mock: bool = False) -> None:
    """Test 3: policy_consultation removed from context.
    Assert ruling_type == ESCALATED and confidence_score == 0.
    """
    context = _build_context()
    # Remove policy_consultation entirely.
    context.pop("policy_consultation", None)

    if mock:
        original = judge_agent.call_llm_json
        judge_agent.call_llm_json = _mock_call_llm_json
        print("[MOCK MODE] Using fake LLM response for test 3\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 3 — JUDGE VERDICT for DISP-002 (missing policy consultation)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    ruling = verdict.get("ruling_type", "")
    confidence = verdict.get("confidence_score", -1)

    errors: list[str] = []

    if ruling != "ESCALATED":
        errors.append(f"Expected ruling_type == ESCALATED, got {ruling}")

    if confidence != 0:
        errors.append(f"Expected confidence_score == 0, got {confidence}")

    if errors:
        print("\nTEST 3 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 3 RESULT: PASS")
        print("  - ruling_type == ESCALATED")
        print("  - confidence_score == 0")


# --- Test 4: inconsistent ruling and action -----------------------------------


async def _run_test4(mock: bool = False) -> None:
    """Test 4: mock LLM returns REJECTED with FULL_REFUND (inconsistent).
    Assert ruling_type == ESCALATED and confidence_score <= 0.50.
    """
    context = _build_context()

    # Mock LLM returns REJECTED + FULL_REFUND (inconsistent pair).
    mock_response = copy.deepcopy(_MOCK_LLM_RESPONSE)
    mock_response["ruling_type"] = "REJECTED"
    mock_response["recommended_action"]["action_type"] = "FULL_REFUND"
    mock_response["recommended_action"]["refund_amount"] = 5.0

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_inconsistent(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response

        judge_agent.call_llm_json = _mock_llm_inconsistent
        print("[MOCK MODE] Using fake LLM response for test 4\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 4 — JUDGE VERDICT for DISP-002 (inconsistent ruling + action)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    ruling = verdict.get("ruling_type", "")
    confidence = verdict.get("confidence_score", 1.0)

    errors: list[str] = []

    if ruling != "ESCALATED":
        errors.append(f"Expected ruling_type == ESCALATED, got {ruling}")

    if confidence > 0.50:
        errors.append(
            f"Expected confidence_score <= 0.50 (ESCALATED cap), got {confidence}"
        )

    if errors:
        print("\nTEST 4 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 4 RESULT: PASS")
        print("  - ruling_type == ESCALATED")
        print(f"  - confidence_score == {confidence} (<= 0.50)")


# --- Test 5: account actions come from the policy suggestion -------------------


async def _run_test5(mock: bool = False) -> None:
    """Test 5: account_action / penalty_target always come
    from the policy suggestion, never from the LLM.

    (a) Mock LLM returns account_action "ACCOUNT_BAN" while the suggestion
        has "NONE" → verdict must have "NONE".
    (b) Suggestion has account_action "WARNING_ISSUED", penalty_target
        "DRIVER" → verdict copies both.
    """
    context = _build_context()

    # --- Case (a): LLM tries to set ACCOUNT_BAN; suggestion says NONE ---
    context["policy_consultation"] = {
        "suggestion": {
            "suggestion_id": "SUG-DISP-002-005a",
            "request_id": "REQ-DISP-002-001",
            "applicable_clauses": [
                {
                    "clause_id": "POL-3",
                    "clause_title": "No-Show Cancellation Charge",
                    "clause_text_summary": "If a driver arrives and waits for the full no-show threshold while the rider does not board, a cancellation fee may be charged.",
                    "relevance_summary": "All five no-show conditions verified."
                }
            ],
            "matched_precedents": [],
            "suggested_ruling_type": "REJECTED",
            "suggested_recommended_action": {
                "action_type": "NO_REFUND",
                "refund_amount": 0,
                "currency": "SGD",
                "account_action": "NONE",
                "penalty_target": "NONE",
            },
            "policy_confidence": 0.9,
            "rationale": "Driver waited the full no-show threshold per POL-3.",
            "suggested_at": "2026-09-13T09:19:00+08:00"
        }
    }

    mock_response_a = copy.deepcopy(_MOCK_LLM_RESPONSE)
    mock_response_a["recommended_action"]["account_action"] = "ACCOUNT_BAN"
    mock_response_a["recommended_action"]["penalty_target"] = "DRIVER"

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_account_ban(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response_a

        judge_agent.call_llm_json = _mock_llm_account_ban
        print("[MOCK MODE] Using fake LLM response for test 5a\n")
    else:
        original = None

    try:
        verdict_a = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 5a — LLM tries ACCOUNT_BAN, suggestion says NONE")
    print("=" * 60)
    print(json.dumps(verdict_a, indent=2, ensure_ascii=False))
    print("=" * 60)

    action_a = verdict_a.get("recommended_action", {})

    errors: list[str] = []

    if action_a.get("account_action") != "NONE":
        errors.append(
            f"5a: Expected account_action == NONE, got {action_a.get('account_action')}"
        )
    if action_a.get("penalty_target") != "NONE":
        errors.append(
            f"5a: Expected penalty_target == NONE, got {action_a.get('penalty_target')}"
        )
    if "penalty_points" in action_a:
        errors.append(
            "5a: Expected penalty_points to not be in recommended_action"
        )

    if errors:
        print("\nTEST 5a RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 5a RESULT: PASS")
        print("  - account_action == NONE (from suggestion, not LLM)")
        print("  - penalty_target == NONE")
        print("  - penalty_points not in recommended_action")

    # --- Case (b): suggestion has WARNING_ISSUED + DRIVER ---
    context_b = _build_context()
    context_b["policy_consultation"] = {
        "suggestion": {
            "suggestion_id": "SUG-DISP-002-005b",
            "request_id": "REQ-DISP-002-001",
            "applicable_clauses": [
                {
                    "clause_id": "POL-3",
                    "clause_title": "No-Show Cancellation Charge",
                    "clause_text_summary": "If a driver arrives and waits for the full no-show threshold while the rider does not board, a cancellation fee may be charged.",
                    "relevance_summary": "All five no-show conditions verified."
                }
            ],
            "matched_precedents": [],
            "suggested_ruling_type": "REJECTED",
            "suggested_recommended_action": {
                "action_type": "NO_REFUND",
                "refund_amount": 0,
                "currency": "SGD",
                "account_action": "WARNING_ISSUED",
                "penalty_target": "DRIVER",
            },
            "policy_confidence": 0.9,
            "rationale": "Driver waited the full no-show threshold per POL-3.",
            "suggested_at": "2026-09-13T09:19:00+08:00"
        }
    }

    # LLM tries to override with different values.
    mock_response_b = copy.deepcopy(_MOCK_LLM_RESPONSE)
    mock_response_b["recommended_action"]["account_action"] = "ACCOUNT_BAN"
    mock_response_b["recommended_action"]["penalty_target"] = "RIDER"

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_warning(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response_b

        judge_agent.call_llm_json = _mock_llm_warning
        print("[MOCK MODE] Using fake LLM response for test 5b\n")
    else:
        original = None

    try:
        verdict_b = await run_judge(context_b)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 5b — suggestion has WARNING_ISSUED + DRIVER")
    print("=" * 60)
    print(json.dumps(verdict_b, indent=2, ensure_ascii=False))
    print("=" * 60)

    action_b = verdict_b.get("recommended_action", {})

    if action_b.get("account_action") != "WARNING_ISSUED":
        errors.append(
            f"5b: Expected account_action == WARNING_ISSUED, got {action_b.get('account_action')}"
        )
    if action_b.get("penalty_target") != "DRIVER":
        errors.append(
            f"5b: Expected penalty_target == DRIVER, got {action_b.get('penalty_target')}"
        )
    if "penalty_points" in action_b:
        errors.append(
            "5b: Expected penalty_points to not be in recommended_action"
        )

    if errors:
        print("\nTEST 5b RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 5b RESULT: PASS")
        print("  - account_action == WARNING_ISSUED (from suggestion)")
        print("  - penalty_target == DRIVER (from suggestion)")
        print("  - penalty_points not in recommended_action")


# --- Test 6: different ruling, same action type — no disagreement cap --------


async def _run_test6(mock: bool = False) -> None:
    """Test 6: suggestion ruling APPROVED + action PARTIAL_REFUND 3.25,
    mock LLM ruling PARTIAL_REFUND + action PARTIAL_REFUND.

    The action types match, so the judge agrees with the suggestion and the
    confidence is NOT capped at 0.70. With a mock LLM confidence of 0.9 and
    a suggestion policy_confidence of 0.85, the result should be 0.85 minus
    the rule deductions (i.e. above 0.70).
    """
    context = _build_context()

    # Override the suggestion: APPROVED + PARTIAL_REFUND 3.25.
    context["policy_consultation"] = {
        "suggestion": {
            "suggestion_id": "SUG-DISP-002-006",
            "request_id": "REQ-DISP-002-001",
            "applicable_clauses": [
                {
                    "clause_id": "POL-3",
                    "clause_title": "No-Show Cancellation Charge",
                    "clause_text_summary": "If a driver arrives and waits for the full no-show threshold while the rider does not board, a cancellation fee may be charged.",
                    "relevance_summary": "All five no-show conditions verified."
                }
            ],
            "matched_precedents": [],
            "suggested_ruling_type": "APPROVED",
            "suggested_recommended_action": {
                "action_type": "PARTIAL_REFUND",
                "refund_amount": 3.25,
                "currency": "SGD",
                "account_action": "NONE",
                "penalty_target": "NONE",
            },
            "policy_confidence": 0.85,
            "rationale": "Driver waited the full no-show threshold per POL-3.",
            "suggested_at": "2026-09-13T09:19:00+08:00"
        }
    }

    # Mock LLM: ruling PARTIAL_REFUND, action PARTIAL_REFUND (same as suggestion),
    # confidence 0.9.
    mock_response = copy.deepcopy(_MOCK_LLM_RESPONSE)
    mock_response["ruling_type"] = "PARTIAL_REFUND"
    mock_response["confidence_score"] = 0.9
    mock_response["recommended_action"]["action_type"] = "PARTIAL_REFUND"
    mock_response["recommended_action"]["refund_amount"] = 3.25

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_same_action(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response

        judge_agent.call_llm_json = _mock_llm_same_action
        print("[MOCK MODE] Using fake LLM response for test 6\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 6 — DIFFERENT RULING, SAME ACTION TYPE (NO CAP)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    confidence = verdict.get("confidence_score", 1.0)
    action = verdict.get("recommended_action", {})
    action_type = action.get("action_type", "")

    errors: list[str] = []

    if action_type != "PARTIAL_REFUND":
        errors.append(f"Expected action_type == PARTIAL_REFUND, got {action_type}")

    if confidence <= 0.70:
        errors.append(
            f"Expected confidence_score > 0.70 (action types match, no cap), "
            f"got {confidence}"
        )

    if errors:
        print("\nTEST 6 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 6 RESULT: PASS")
        print(f"  - action_type == PARTIAL_REFUND (matches suggestion)")
        print(f"  - confidence_score == {confidence} (> 0.70, not capped)")


# --- Test 7: explanation guard for account actions ----------------------------


async def _run_test7(mock: bool = False) -> None:
    """Test 7: suggestion has account_action WARNING_ISSUED, penalty_target
    DRIVER. The mock LLM's explanation_for_driver says "No penalty will be
    applied to your account." → the code guard must remove that sentence and
    append the account-action notice (containing "warning"). The
    explanation_for_rider must be unchanged.
    """
    context = _build_context()

    context["policy_consultation"] = {
        "suggestion": {
            "suggestion_id": "SUG-DISP-002-007",
            "request_id": "REQ-DISP-002-001",
            "applicable_clauses": [
                {
                    "clause_id": "POL-3",
                    "clause_title": "No-Show Cancellation Charge",
                    "clause_text_summary": "If a driver arrives and waits for the full no-show threshold while the rider does not board, a cancellation fee may be charged.",
                    "relevance_summary": "All five no-show conditions verified."
                }
            ],
            "matched_precedents": [],
            "suggested_ruling_type": "REJECTED",
            "suggested_recommended_action": {
                "action_type": "NO_REFUND",
                "refund_amount": 0,
                "currency": "SGD",
                "account_action": "WARNING_ISSUED",
                "penalty_target": "DRIVER",
            },
            "policy_confidence": 0.9,
            "rationale": "Driver waited the full no-show threshold per POL-3.",
            "suggested_at": "2026-09-13T09:19:00+08:00"
        }
    }

    mock_response = copy.deepcopy(_MOCK_LLM_RESPONSE)
    mock_response["explanations"]["explanation_for_driver"] = (
        "We appreciate that you arrived on time, waited patiently, "
        "and made multiple efforts to contact the rider. Your "
        "patience and professionalism are noted. The cancellation "
        "fee of $5.00 is upheld because the full waiting period was "
        "reached, the system had notified the rider of your arrival, "
        "and you made contact attempts as required. No penalty will "
        "be applied to your account. You may appeal or request "
        "human review within 7 days."
    )

    # Keep the rider explanation from _MOCK_LLM_RESPONSE for comparison.
    original_rider = _MOCK_LLM_RESPONSE["explanations"]["explanation_for_rider"]

    if mock:
        original = judge_agent.call_llm_json

        async def _mock_llm_explanation_guard(system_prompt: str, user_prompt: str, **kwargs) -> dict:
            return mock_response

        judge_agent.call_llm_json = _mock_llm_explanation_guard
        print("[MOCK MODE] Using fake LLM response for test 7\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        if original is not None:
            judge_agent.call_llm_json = original

    print("=" * 60)
    print("TEST 7 — EXPLANATION GUARD (account action consistency)")
    print("=" * 60)
    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    print("=" * 60)

    explanations = verdict.get("explanations", {})
    driver_exp = explanations.get("explanation_for_driver", "")
    rider_exp = explanations.get("explanation_for_rider", "")

    errors: list[str] = []

    if "No penalty" in driver_exp:
        errors.append(
            "7: Expected 'No penalty' to be removed from explanation_for_driver"
        )
    if "warning" not in driver_exp.lower():
        errors.append(
            "7: Expected 'warning' to be present in explanation_for_driver"
        )
    if rider_exp != original_rider:
        errors.append(
            "7: Expected explanation_for_rider to be unchanged"
        )

    if errors:
        print("\nTEST 7 RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST 7 RESULT: PASS")
        print("  - 'No penalty' removed from explanation_for_driver")
        print("  - 'warning' present in explanation_for_driver")
        print("  - explanation_for_rider unchanged")


# ---------------------------------------------------------------------------


async def _run_all_tests(mock: bool = False) -> None:
    await _run_test1(mock=mock)
    print()
    await _run_test2(mock=mock)
    print()
    await _run_test3(mock=mock)
    print()
    await _run_test4(mock=mock)
    print()
    await _run_test5(mock=mock)
    print()
    await _run_test6(mock=mock)
    print()
    await _run_test7(mock=mock)
    print()
    print("=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)


def main() -> None:
    """Entry point: parse --mock flag and run the async tests."""
    mock = "--mock" in sys.argv
    asyncio.run(_run_all_tests(mock=mock))


if __name__ == "__main__":
    main()
