"""
Mirra AI — Ryde Multi-Agent Dispute Resolution Backend

FastAPI application exposing:
  - Dispute listing & raw data loading (dynamically from mock_data/)
  - Full pipeline execution (6-phase state machine)
  - Pipeline execution with event streaming
  - Human review & override endpoints
  - Mock external payment/refund API
  - Policy knowledge-base update retrieval
  - Health check, agent info, state machine info

Schema reference: shared/schemas.json (RydeMultiAgentAutonomousDisputeResolutionSystemMasterSchema)
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backend.orchestrator.state_machine import (
    ExecutionRoute,
    HumanReviewDecision,
    apply_human_review,
    run_dispute_pipeline_realtime
)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Ryde Multi-Agent Dispute Resolution System — Mirra AI",
    description=(
        "Production-grade orchestrator API for the Ryde multi-agent "
        "autonomous dispute resolution pipeline. Implements the 6-phase "
        "state machine: INIT_CLAIM → ROUND_1_PLEADINGS → "
        "ROUND_2_PROSECUTOR_AUDIT → POLICY_CONSULTATION → "
        "JUDGE_DELIBERATION → EXECUTION_ROUTER."
    ),
    version="1.0.0",
)

_SGT = timezone(timedelta(hours=8))
_BACKEND_DIR = Path(__file__).resolve().parent
_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"

# In-memory store for completed pipeline results (keyed by dispute_id)
_completed_results: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(_SGT).isoformat()


# ---------------------------------------------------------------------------
# Case persistence (in-memory, consumed by state_machine.py)
# ---------------------------------------------------------------------------


def get_case(case_id: str) -> dict[str, Any] | None:
    """
    Load a raw dispute case from the mock_data directory by case_id.

    Returns the parsed JSON dict, or None if the file does not exist.
    """
    file_path = _MOCK_DATA_DIR / f"{case_id}.json"
    if not file_path.exists():
        return None
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_case(result: dict[str, Any]) -> None:
    """
    Persist a completed pipeline result to the in-memory store.

    The result dict follows the master schema (case_metadata, data_sources,
    round_1_statements, …, judge_verdict, policy_kb_update).
    """
    case_id = result.get("case_metadata", {}).get("case_id") or result.get("case_id", "UNKNOWN")
    _completed_results[case_id] = result


def get_completed_case(case_id: str) -> dict[str, Any] | None:
    """
    Return the completed pipeline result for case_id from the in-memory
    store, or None if the pipeline has not been run for this case.

    Used by apply_human_review so the human decision is applied to the
    real pipeline result (judge_verdict, policy_consultation,
    prosecutor_findings), not the raw mock_data file.
    """
    return _completed_results.get(case_id)


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------


class HumanReviewRequest(BaseModel):
    reviewer_id: str = Field(..., description="Unique ID of the human reviewer")
    reviewer_name: str = Field(..., description="Display name of the reviewer")
    approval_decision: str = Field(
        ...,
        description="CONFIRMED_AUTO | MODIFIED | OVERRIDDEN | REJECTED_AUTO",
    )
    override_reason: str = Field("", description="Reason if modified/overridden")
    modified_action: dict | None = Field(
        None,
        description="Modified RecommendedAction if decision is MODIFIED",
    )
    review_notes: str = Field("", description="Additional review notes")


class RefundRequest(BaseModel):
    amount: float = Field(..., ge=0)
    currency: str = Field("SGD")
    case_id: str | None = Field(None)
    rider_id: str | None = Field(None)


class CleaningFeeChargeRequest(BaseModel):
    amount: float = Field(..., ge=0)
    currency: str = Field("SGD")
    case_id: str | None = Field(None)
    rider_id: str | None = Field(None)
    driver_id: str | None = Field(None)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "Mirra AI Dispute Resolution",
        "version": "1.0.0",
        "timestamp": _now_iso(),
    }


# ---------------------------------------------------------------------------
# Dispute listing & raw data loading
# ---------------------------------------------------------------------------


@app.get("/api/disputes")
async def list_dispute_cases():
    """
    List all available dispute cases by scanning the mock_data directory.

    For each case file, reads case_metadata to extract case_id, dispute_type,
    and current_state. No hardcoded data — fully dynamic.
    """
    cases: list[dict[str, Any]] = []
    if not _MOCK_DATA_DIR.exists():
        return cases

    for file_path in sorted(_MOCK_DATA_DIR.glob("*.json")):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                case_data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        meta = case_data.get("case_metadata", {})
        case_id = meta.get("case_id", file_path.stem)

        cases.append(
            {
                "case_id": case_id,
                "dispute_type": meta.get("dispute_type", "UNKNOWN"),
                "current_state": meta.get("current_state", "INIT_CLAIM"),
                "trip_id": meta.get("trip_id"),
                "rider_id": meta.get("rider_id"),
                "driver_id": meta.get("driver_id"),
                "has_completed_result": case_id in _completed_results,
            }
        )

    return cases


@app.get("/api/disputes/{dispute_id}")
async def get_dispute_data(dispute_id: str):
    """Load the raw dispute dataset (simulates pulling from Ryde's database)."""
    case_data = get_case(dispute_id)
    if case_data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Dispute dataset not found: {dispute_id}",
        )
    return case_data


# ---------------------------------------------------------------------------
# Pipeline execution
# ---------------------------------------------------------------------------

@app.post("/api/disputes/{dispute_id}/run-realtime")
async def run_pipeline_realtime(dispute_id: str):
    """
    Execute the pipeline and return both the result and the phase event log.

    Each event captures a state transition with a phase, label, data summary,
    and timestamp — suitable for real-time UI updates via polling.
    """
    case_data = get_case(dispute_id)
    if case_data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Dispute dataset not found: {dispute_id}",
        )

    try:
        result, events = await run_dispute_pipeline_realtime(dispute_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {exc}",
        )

    _completed_results[dispute_id] = result
    return {"result": result, "events": events}


# ---------------------------------------------------------------------------
# Completed results retrieval
# ---------------------------------------------------------------------------


@app.get("/api/disputes/{dispute_id}/result")
async def get_completed_result(dispute_id: str):
    """Retrieve the completed pipeline result for a previously-run case."""
    if dispute_id not in _completed_results:
        raise HTTPException(
            status_code=404,
            detail=f"No completed result for case {dispute_id}. Run the pipeline first.",
        )
    return _completed_results[dispute_id]


# ---------------------------------------------------------------------------
# Human review & override
# ---------------------------------------------------------------------------


@app.post("/api/disputes/{dispute_id}/human-review")
async def submit_human_review(dispute_id: str, review: HumanReviewRequest):
    """
    Submit a human reviewer's decision for an escalated case.

    If the decision overrides the Judge's ruling (MODIFIED, OVERRIDDEN,
    REJECTED_AUTO), triggers a PolicyAgent knowledge-base update which
    is stored in policy_kb_update.

    Schema reference: HumanConfirmationDetails.approval_decision and
    PolicyKnowledgeBaseUpdate.
    """
    valid_decisions = {d.value for d in HumanReviewDecision}
    if review.approval_decision not in valid_decisions:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid approval_decision: {review.approval_decision}. "
                f"Must be one of: {', '.join(sorted(valid_decisions))}"
            ),
        )

    try:
        result = await apply_human_review(
            case_id=dispute_id,
            reviewer_id=review.reviewer_id,
            decision=HumanReviewDecision(review.approval_decision),
            adjusted_verdict=review.modified_action,
            review_notes=review.override_reason or review.review_notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Human review application failed: {exc}",
        )

    _completed_results[dispute_id] = result
    return result


# ---------------------------------------------------------------------------
# Policy knowledge-base update
# ---------------------------------------------------------------------------


@app.get("/api/disputes/{dispute_id}/policy-kb-update")
async def get_policy_kb_update(dispute_id: str):
    """
    Retrieve the PolicyKnowledgeBaseUpdate record for a case where the
    human reviewer overrode the Judge's ruling.

    Returns has_update=False for FULLY_AUTOMATED cases and for human
    reviews that confirmed the Judge's ruling (CONFIRMED_AUTO).
    """
    result = _completed_results.get(dispute_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No completed result for case {dispute_id}.",
        )

    kb_update = result.get("policy_kb_update")
    if kb_update is None:
        return {
            "case_id": dispute_id,
            "has_update": False,
            "message": "No knowledge-base update was triggered for this case.",
        }
    return {
        "case_id": dispute_id,
        "has_update": True,
        "policy_kb_update": kb_update,
    }


# ---------------------------------------------------------------------------
# Mock external payment APIs
# ---------------------------------------------------------------------------


@app.post("/api/mock-ryde-pay/refund")
async def execute_mock_refund(payload: RefundRequest):
    """
    Mock external API: simulate an automated refund to the rider's
    payment method (used by the EXECUTION_ROUTER for FULLY_AUTOMATED cases).

    Schema reference: ExecutionPayload with execution_status=AUTO_EXECUTED.
    """
    txn_id = f"TXN-RYDE-2026-{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "SUCCESS",
        "transaction_id": txn_id,
        "refund_amount": payload.amount,
        "currency": payload.currency,
        "case_id": payload.case_id,
        "rider_id": payload.rider_id,
        "executed_at": _now_iso(),
    }


@app.post("/api/mock-ryde-pay/cleaning-fee")
async def execute_mock_cleaning_fee_charge(payload: CleaningFeeChargeRequest):
    """
    Mock external API: simulate charging a cleaning fee to the rider
    and crediting the driver (used after human confirmation for
    CLEANING_FEE disputes).
    """
    txn_id = f"TXN-RYDE-2026-{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "SUCCESS",
        "transaction_id": txn_id,
        "cleaning_fee_amount": payload.amount,
        "currency": payload.currency,
        "case_id": payload.case_id,
        "rider_id": payload.rider_id,
        "driver_id": payload.driver_id,
        "executed_at": _now_iso(),
    }


@app.post("/api/mock-ryde-pay/cancellation-fee-reverse")
async def execute_mock_cancellation_fee_reverse(payload: dict):
    """
    Mock external API: simulate reversing a no-show cancellation fee
    (refunding the rider and debiting the driver).
    """
    txn_id = f"TXN-RYDE-2026-{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "SUCCESS",
        "transaction_id": txn_id,
        "reversed_amount": payload.get("amount", 5.0),
        "currency": payload.get("currency", "SGD"),
        "case_id": payload.get("case_id"),
        "executed_at": _now_iso(),
    }


# ---------------------------------------------------------------------------
# Agent status & system info
# ---------------------------------------------------------------------------


@app.get("/api/agents")
async def get_agent_info():
    """
    Return information about all agents in the pipeline.

    Currently implemented: JudgeAgent, PolicyAgent (deterministic).
    RiderAgent, DriverAgent, ProsecutorAgent are placeholders —
    their phases run with empty/stub data until implemented.
    """
    return [
        {
            "agent_id": "RiderAgent",
            "role": "Rider Advocate",
            "phase": "ROUND_1_PLEADINGS",
            "status": "NOT_IMPLEMENTED",
            "description": (
                "Extracts passenger claim, sentiment, and requested refund. "
                "Answers Prosecutor questions in Round 2."
            ),
        },
        {
            "agent_id": "DriverAgent",
            "role": "Driver Advocate",
            "phase": "ROUND_1_PLEADINGS",
            "status": "NOT_IMPLEMENTED",
            "description": (
                "Extracts driver response and counter-evidence. "
                "Answers Prosecutor questions in Round 2."
            ),
        },
        {
            "agent_id": "ProsecutorAgent",
            "role": "Prosecutor / Investigator",
            "phase": "ROUND_2_PROSECUTOR_AUDIT",
            "status": "NOT_IMPLEMENTED",
            "description": (
                "Queries external APIs (GPS, EXIF, chat, fraud) to build "
                "an immutable fact sheet. Emits ProsecutorReport."
            ),
        },
        {
            "agent_id": "PolicyAgent",
            "role": "Policy Advisor",
            "phase": "POLICY_CONSULTATION",
            "status": "IMPLEMENTED",
            "description": (
                "Retrieves applicable policy clauses and precedents via "
                "deterministic policy engine. Emits PolicySuggestion for "
                "the Judge."
            ),
        },
        {
            "agent_id": "JudgeAgent",
            "role": "Adjudicator / Judge",
            "phase": "JUDGE_DELIBERATION",
            "status": "IMPLEMENTED",
            "description": (
                "Weighs Prosecutor findings against Policy suggestion. "
                "Produces final verdict with confidence score."
            ),
        },
        {
            "agent_id": "StateEngine",
            "role": "Workflow Orchestrator",
            "phase": "ALL",
            "status": "IMPLEMENTED",
            "description": (
                "Controls state transitions, enforces 2-round limit, "
                "and controls execution routing gates."
            ),
        },
    ]


@app.get("/api/states")
async def get_state_machine_info():
    """
    Return the state machine definition and valid transitions.

    Schema reference: CaseMetadata.current_state and
    CaseMetadata.resolution_channel.
    """
    return {
        "states": [
            {
                "name": "INIT_CLAIM",
                "order": 1,
                "description": (
                    "Case ingestion. Evidence is collected and frozen at filing time."
                ),
            },
            {
                "name": "ROUND_1_PLEADINGS",
                "order": 2,
                "description": (
                    "Rider and Driver Advocate agents submit structured pleadings."
                ),
            },
            {
                "name": "ROUND_2_PROSECUTOR_AUDIT",
                "order": 3,
                "description": (
                    "Prosecutor runs tool-based verification, cross-examination, "
                    "and emits ProsecutorReport."
                ),
            },
            {
                "name": "POLICY_CONSULTATION",
                "order": 4,
                "description": (
                    "PolicyAgent retrieves applicable clauses and precedents, "
                    "emits PolicySuggestion."
                ),
            },
            {
                "name": "JUDGE_DELIBERATION",
                "order": 5,
                "description": (
                    "JudgeAgent weighs Prosecutor findings vs Policy suggestion, "
                    "produces JudgeVerdict."
                ),
            },
            {
                "name": "EXECUTION_ROUTER",
                "order": 6,
                "description": (
                    "Execution gate: FULLY_AUTOMATED (auto refund) or "
                    "ESCALATED_HUMAN_REVIEW."
                ),
            },
        ],
        "auto_execution_threshold": 0.75,
        "max_rounds": 2,
        "transitions": [
            "INIT_CLAIM → ROUND_1_PLEADINGS",
            "ROUND_1_PLEADINGS → ROUND_2_PROSECUTOR_AUDIT",
            "ROUND_2_PROSECUTOR_AUDIT → POLICY_CONSULTATION",
            "POLICY_CONSULTATION → JUDGE_DELIBERATION",
            "JUDGE_DELIBERATION → EXECUTION_ROUTER",
            "EXECUTION_ROUTER → FULLY_AUTOMATED | ESCALATED_HUMAN_REVIEW",
        ],
    }


# ---------------------------------------------------------------------------
# Dev / debug entry
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
