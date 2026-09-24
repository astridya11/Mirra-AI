"""
Test for the Judge Agent using the DISP-002 (NO_SHOW_CHARGE) case.

Run with the real DeepSeek API:
    python backend/tests/test_judge_disp002.py

Run in mock mode (no API key needed):
    python backend/tests/test_judge_disp002.py --mock
"""

import asyncio
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
        "round_3_rebuttal": {},
        "prosecutor_findings": fixture["prosecutor_findings"],
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
    "policy_clauses_applied": ["v1:POL-1", "v1:POL-3"],
    "precedent_references": [],
    "recommended_action": {
        "action_type": "NO_REFUND",
        "refund_amount": 0,
        "cleaning_fee_amount": 0,
        "currency": "SGD",
        "penalty_points": 0,
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


# --- Main test ----------------------------------------------------------------


async def _run_test(mock: bool = False) -> None:
    """Build context, optionally mock the LLM, run the judge, print + assert."""
    context = _build_context()

    if mock:
        # Replace the real LLM call with the fake response.
        original = judge_agent.call_llm_json
        judge_agent.call_llm_json = _mock_call_llm_json
        print("[MOCK MODE] Using fake LLM response (no API key needed)\n")
    else:
        original = None

    try:
        verdict = await run_judge(context)
    finally:
        # Restore original if we patched.
        if original is not None:
            judge_agent.call_llm_json = original

    # --- Print the verdict ---
    print("=" * 60)
    print("JUDGE VERDICT for DISP-002")
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

    if "v1:POL-3" not in clauses:
        errors.append(f"Expected 'v1:POL-3' in policy_clauses_applied, got {clauses}")

    if errors:
        print("\nTEST RESULT: FAIL")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nTEST RESULT: PASS")
        print("  - ruling_type == REJECTED")
        print("  - action_type == NO_REFUND")
        print("  - refund_amount == 0")
        print("  - 'v1:POL-3' in policy_clauses_applied")


def main() -> None:
    """Entry point: parse --mock flag and run the async test."""
    mock = "--mock" in sys.argv
    asyncio.run(_run_test(mock=mock))


if __name__ == "__main__":
    main()
