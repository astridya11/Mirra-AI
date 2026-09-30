"""
Standalone test for the human-review feedback loop (learning feedback).

Verifies that apply_human_review reads the completed pipeline result
(not raw mock_data), rejects double reviews, and records precedents
into a temp knowledge base so the real one is never touched.

Run from backend/:
    python -m tests.test_feedback_loop

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import asyncio
import copy
import json
import sys
import tempfile
from pathlib import Path

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.policy import precedent_store  # noqa: E402
from backend.orchestrator import state_machine  # noqa: E402
from backend.orchestrator.state_machine import HumanReviewDecision  # noqa: E402
from backend.agents.policy_consultant_agent import run_policy_consultation  # noqa: E402

# --- Load mock data + fixtures ------------------------------------------------

_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"
_FIXTURES_DIR = _BACKEND_DIR / "tests" / "fixtures"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def make_case() -> dict:
    """
    Build a fake completed DISP-002 result.

    case_metadata and data_sources from mock_data; round_1_statements,
    prosecutor_findings and policy_consultation from fixtures; judge_verdict
    and policy_kb_update set explicitly.
    """
    mock_case = _load_json(_MOCK_DATA_DIR / "DISP-002.json")
    fixture = _load_json(_FIXTURES_DIR / "DISP-002_judge_input.json")

    return {
        "case_metadata": mock_case["case_metadata"],
        "data_sources": mock_case["data_sources"],
        "round_1_statements": fixture["round_1_statements"],
        "prosecutor_findings": fixture["prosecutor_findings"],
        "policy_consultation": fixture["policy_consultation"],
        "judge_verdict": {
            "ruling_type": "ESCALATED",
            "recommended_action": {
                "action_type": "ESCALATED_NO_ACTION",
                "amount": 0.0,
                "currency": "SGD",
            },
            "execution_payload": {
                "execution_status": "PENDING_HUMAN_REVIEW",
            },
        },
        "policy_kb_update": None,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    errors: list[str] = []

    # --- Patch storage helpers so backend.main is not needed ----------------

    store: dict[str, dict] = {}
    state_machine._get_completed_case = lambda cid: store.get(cid)
    state_machine._save_case = lambda r: store.__setitem__(
        r["case_metadata"]["case_id"], r
    )

    # --- Temp KB so the real one is never touched ---------------------------

    tmp_dir = tempfile.mkdtemp(prefix="mirra_kb_test_")
    tmp_kb_path = str(Path(tmp_dir) / "kb.json")

    try:
        precedent_store.reset_for_testing(kb_path=tmp_kb_path)

        # =====================================================================
        # CHECK 1: NOT RUN YET
        # =====================================================================
        print("=" * 70)
        print("CHECK 1: NOT RUN YET — store empty")
        print("=" * 70)

        store.clear()
        check1_errors: list[str] = []
        try:
            await state_machine.apply_human_review(
                case_id="DISP-002",
                reviewer_id="reviewer-1",
                decision=HumanReviewDecision.CONFIRMED_AUTO,
            )
            check1_errors.append(
                "Expected ValueError but apply_human_review did not raise"
            )
        except ValueError as exc:
            msg = str(exc)
            if "Run the pipeline first" not in msg:
                check1_errors.append(
                    f"ValueError message does not contain 'Run the pipeline first': {msg!r}"
                )

        if check1_errors:
            print("\nCHECK 1 RESULT: FAIL")
            for e in check1_errors:
                print(f"  - {e}")
            errors.extend(check1_errors)
        else:
            print("\nCHECK 1 RESULT: PASS")
            print("  - ValueError raised with 'Run the pipeline first'")

        # =====================================================================
        # CHECK 2: CONFIRMED_AUTO
        # =====================================================================
        print("\n" + "=" * 70)
        print("CHECK 2: CONFIRMED_AUTO")
        print("=" * 70)

        store.clear()
        case = copy.deepcopy(make_case())
        store["DISP-002"] = case

        precedent_count_before = len(precedent_store._load_kb()["precedents"])
        check2_errors: list[str] = []

        result = await state_machine.apply_human_review(
            case_id="DISP-002",
            reviewer_id="reviewer-1",
            decision=HumanReviewDecision.CONFIRMED_AUTO,
        )

        exec_payload = result.get("judge_verdict", {}).get("execution_payload", {})
        exec_status = exec_payload.get("execution_status")
        case_final = exec_payload.get("case_final_status")
        kb_update = result.get("policy_kb_update")
        precedent_count_after = len(precedent_store._load_kb()["precedents"])

        if exec_status != "HUMAN_CONFIRMED":
            check2_errors.append(
                f"execution_status is {exec_status!r}, expected 'HUMAN_CONFIRMED'"
            )
        if case_final != "HUMAN_RESOLVED":
            check2_errors.append(
                f"case_final_status is {case_final!r}, expected 'HUMAN_RESOLVED'"
            )
        if kb_update is not None:
            check2_errors.append(
                f"policy_kb_update is {kb_update!r}, expected None"
            )
        if precedent_count_after != precedent_count_before:
            check2_errors.append(
                f"KB precedent count changed: {precedent_count_before} -> {precedent_count_after}"
            )

        if check2_errors:
            print("\nCHECK 2 RESULT: FAIL")
            for e in check2_errors:
                print(f"  - {e}")
            errors.extend(check2_errors)
        else:
            print("\nCHECK 2 RESULT: PASS")
            print(f"  - execution_status: {exec_status}")
            print(f"  - case_final_status: {case_final}")
            print(f"  - policy_kb_update: None")
            print(f"  - KB precedent count unchanged: {precedent_count_after}")

        # =====================================================================
        # CHECK 3: OVERRIDDEN
        # =====================================================================
        print("\n" + "=" * 70)
        print("CHECK 3: OVERRIDDEN")
        print("=" * 70)

        store.clear()
        case = copy.deepcopy(make_case())
        store["DISP-002"] = case

        precedent_count_before = len(precedent_store._load_kb()["precedents"])
        check3_errors: list[str] = []

        adjusted_verdict = {
            "action_type": "FULL_REFUND",
            "amount": 5.0,
            "currency": "SGD",
            "ruling_type": "APPROVED",
        }
        review_notes = "Rider was at a different lobby entrance."

        result = await state_machine.apply_human_review(
            case_id="DISP-002",
            reviewer_id="reviewer-1",
            decision=HumanReviewDecision.OVERRIDDEN,
            adjusted_verdict=adjusted_verdict,
            review_notes=review_notes,
        )

        exec_payload = result.get("judge_verdict", {}).get("execution_payload", {})
        exec_status = exec_payload.get("execution_status")
        case_final = exec_payload.get("case_final_status")
        kb_update = result.get("policy_kb_update")
        new_precedent_id = (kb_update or {}).get("new_precedent_id")
        clauses_flagged = (kb_update or {}).get("clauses_flagged", [])
        trigger = (kb_update or {}).get("trigger")

        if exec_status != "HUMAN_OVERRIDDEN":
            check3_errors.append(
                f"execution_status is {exec_status!r}, expected 'HUMAN_OVERRIDDEN'"
            )
        if case_final != "HUMAN_OVERRIDDEN":
            check3_errors.append(
                f"case_final_status is {case_final!r}, expected 'HUMAN_OVERRIDDEN'"
            )
        if trigger != "OVERRIDDEN":
            check3_errors.append(
                f"kb_update.trigger is {trigger!r}, expected 'OVERRIDDEN'"
            )
        if not new_precedent_id:
            check3_errors.append("kb_update has no new_precedent_id")
        if "POL-3" not in clauses_flagged:
            check3_errors.append(
                f"'POL-3' not in clauses_flagged: {clauses_flagged!r}"
            )

        # Verify the precedent was written to the KB
        kb_precedents = precedent_store._load_kb()["precedents"]
        precedent_record = None
        for p in kb_precedents:
            if p.get("precedent_id") == new_precedent_id:
                precedent_record = p
                break

        if precedent_record is None:
            check3_errors.append(
                f"new_precedent_id {new_precedent_id!r} not found in KB precedents"
            )
        else:
            if precedent_record.get("approved") is not True:
                check3_errors.append(
                    f"precedent approved is {precedent_record.get('approved')!r}, expected True"
                )
            if precedent_record.get("source") != "HUMAN_OVERRIDE":
                check3_errors.append(
                    f"precedent source is {precedent_record.get('source')!r}, expected 'HUMAN_OVERRIDE'"
                )

        precedent_count_after = len(kb_precedents)
        if precedent_count_after != precedent_count_before + 1:
            check3_errors.append(
                f"KB precedent count: {precedent_count_before} -> {precedent_count_after}, "
                f"expected +1"
            )

        if check3_errors:
            print("\nCHECK 3 RESULT: FAIL")
            for e in check3_errors:
                print(f"  - {e}")
            errors.extend(check3_errors)
        else:
            print("\nCHECK 3 RESULT: PASS")
            print(f"  - execution_status: {exec_status}")
            print(f"  - case_final_status: {case_final}")
            print(f"  - trigger: {trigger}")
            print(f"  - new_precedent_id: {new_precedent_id}")
            print(f"  - POL-3 in clauses_flagged: True")
            print(f"  - KB precedent: approved=True, source=HUMAN_OVERRIDE")

        # =====================================================================
        # CHECK 4: LOOP CLOSED
        # =====================================================================
        print("\n" + "=" * 70)
        print("CHECK 4: LOOP CLOSED — next case sees the human decision")
        print("=" * 70)

        check4_errors: list[str] = []

        consultation_context = {
            "case_metadata": case["case_metadata"],
            "data_sources": case["data_sources"],
            "prosecutor_findings": case["prosecutor_findings"],
        }
        consultation_result = await run_policy_consultation(consultation_context)
        matched_ids = [
            p["precedent_id"] for p in consultation_result.get("matched_precedents", [])
        ]
        if new_precedent_id not in matched_ids:
            check4_errors.append(
                f"new_precedent_id {new_precedent_id!r} not in matched_precedents: {matched_ids!r}"
            )

        if check4_errors:
            print("\nCHECK 4 RESULT: FAIL")
            for e in check4_errors:
                print(f"  - {e}")
            errors.extend(check4_errors)
        else:
            print("\nCHECK 4 RESULT: PASS")
            print(f"  - new_precedent_id {new_precedent_id} found in matched_precedents")
            print(f"  - matched_precedents: {matched_ids}")

        # =====================================================================
        # CHECK 5: REJECTED_AUTO
        # =====================================================================
        print("\n" + "=" * 70)
        print("CHECK 5: REJECTED_AUTO — precedent recorded but not citable")
        print("=" * 70)

        store.clear()
        case5 = copy.deepcopy(make_case())
        store["DISP-002"] = case5

        check5_errors: list[str] = []

        result5 = await state_machine.apply_human_review(
            case_id="DISP-002",
            reviewer_id="reviewer-1",
            decision=HumanReviewDecision.REJECTED_AUTO,
            review_notes="Rider claim is fraudulent.",
        )

        kb_update5 = result5.get("policy_kb_update")
        rejected_precedent_id = (kb_update5 or {}).get("new_precedent_id")

        if not rejected_precedent_id:
            check5_errors.append("REJECTED_AUTO: kb_update has no new_precedent_id")
        else:
            # Verify the precedent has approved=False
            kb_precedents5 = precedent_store._load_kb()["precedents"]
            rejected_record = None
            for p in kb_precedents5:
                if p.get("precedent_id") == rejected_precedent_id:
                    rejected_record = p
                    break

            if rejected_record is None:
                check5_errors.append(
                    f"REJECTED_AUTO: precedent {rejected_precedent_id!r} not found in KB"
                )
            else:
                if rejected_record.get("approved") is not False:
                    check5_errors.append(
                        f"REJECTED_AUTO: precedent approved is "
                        f"{rejected_record.get('approved')!r}, expected False"
                    )

            # Verify run_policy_consultation does NOT return it (POL-8)
            consultation_context5 = {
                "case_metadata": case5["case_metadata"],
                "data_sources": case5["data_sources"],
                "prosecutor_findings": case5["prosecutor_findings"],
            }
            consultation_result5 = await run_policy_consultation(consultation_context5)
            matched_ids5 = [
                p["precedent_id"]
                for p in consultation_result5.get("matched_precedents", [])
            ]
            if rejected_precedent_id in matched_ids5:
                check5_errors.append(
                    f"REJECTED_AUTO: unapproved precedent {rejected_precedent_id!r} "
                    f"appeared in matched_precedents (POL-8 violation)"
                )

        if check5_errors:
            print("\nCHECK 5 RESULT: FAIL")
            for e in check5_errors:
                print(f"  - {e}")
            errors.extend(check5_errors)
        else:
            print("\nCHECK 5 RESULT: PASS")
            print(f"  - new_precedent_id: {rejected_precedent_id}")
            print(f"  - approved: False")
            print(f"  - not citable in run_policy_consultation (POL-8)")

        # =====================================================================
        # CHECK 6: DOUBLE REVIEW
        # =====================================================================
        print("\n" + "=" * 70)
        print("CHECK 6: DOUBLE REVIEW — already reviewed case rejected")
        print("=" * 70)

        # The case from check 3 is still in the store, already reviewed.
        store.clear()
        store["DISP-002"] = result  # result from check 3 (HUMAN_OVERRIDDEN)

        check6_errors: list[str] = []

        precedent_count_before6 = len(precedent_store._load_kb()["precedents"])

        try:
            await state_machine.apply_human_review(
                case_id="DISP-002",
                reviewer_id="reviewer-2",
                decision=HumanReviewDecision.OVERRIDDEN,
                review_notes="Second review attempt.",
            )
            check6_errors.append(
                "Expected ValueError but apply_human_review did not raise on double review"
            )
        except ValueError as exc:
            msg = str(exc)
            if "already been reviewed" not in msg:
                check6_errors.append(
                    f"ValueError message does not contain 'already been reviewed': {msg!r}"
                )

        precedent_count_after6 = len(precedent_store._load_kb()["precedents"])
        if precedent_count_after6 != precedent_count_before6:
            check6_errors.append(
                f"KB precedent count changed: {precedent_count_before6} -> {precedent_count_after6}"
            )

        if check6_errors:
            print("\nCHECK 6 RESULT: FAIL")
            for e in check6_errors:
                print(f"  - {e}")
            errors.extend(check6_errors)
        else:
            print("\nCHECK 6 RESULT: PASS")
            print(f"  - ValueError raised with 'already been reviewed'")
            print(f"  - KB precedent count unchanged: {precedent_count_after6}")

        # =====================================================================
        # Summary
        # =====================================================================
        if errors:
            print("\n" + "=" * 70)
            print("SOME CHECKS FAILED")
            print("=" * 70)
            sys.exit(1)
        else:
            print("\n" + "=" * 70)
            print("ALL TESTS PASSED")
            print("=" * 70)

    finally:
        precedent_store.reset_for_testing(kb_path=precedent_store._DEFAULT_KB_PATH)
        # Clean up temp dir
        for f in Path(tmp_dir).glob("*"):
            f.unlink()
        Path(tmp_dir).rmdir()


if __name__ == "__main__":
    asyncio.run(main())