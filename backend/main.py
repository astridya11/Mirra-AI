"""
Mirra AI — Ryde Multi-Agent Dispute Resolution Backend

FastAPI application exposing:
  - Dispute creation, listing & raw data loading (from backend/disputes/)
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
import logging
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone, timedelta
import sys
from pathlib import Path
from typing import Any, List, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from backend.routing.sla_router import router as review_router

from backend.app.db.auth import user_repo
from backend.app.api.routes import auth, cases, evidence, verification
from backend.app.core.config import get_settings
from backend.shared.evidence_upload import (
    UPLOADS_DIR,
    EvidenceUploadError,
    process_uploaded_evidence,
)
from backend.shared.verdict_caption import build_verdict_render_args
from backend.shared.verdict_image import render_verdict_image
from backend.shared.image_check import build_image_check
from backend.shared.voice_asr import (
    ASRNotConfigured,
    AudioRejected,
    VoiceError,
    parse_audio_data_url,
    transcribe,
)


from backend.orchestrator.state_machine import (
    HumanReviewDecision,
    PartyDecisionType,
    apply_human_review,
    apply_party_decision,
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

# 从环境变量获取允许的域名列表，以逗号分隔；若未配置则使用默认开发环境域名
raw_origins = os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
allowed_origins = [origin.strip() for origin in raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
settings = get_settings()

app.include_router(auth.router)
app.include_router(cases.router, prefix=settings.api_v1_prefix)
app.include_router(evidence.router, prefix=settings.api_v1_prefix)
app.include_router(verification.router, prefix=settings.api_v1_prefix)
app.include_router(review_router)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # 打印堆栈日志方便调试
    print(f"Global Exception Caught: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
    )

_SGT = timezone(timedelta(hours=8))
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path setup (all relative to the backend directory)
#
#   backend/data/trips/{trip_id}.json   -> trip source data
#   backend/data/users.json             -> user data
#   backend/disputes/{case_id}.json     -> dispute cases (DISP-001, DISP-002, ...)
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
TRIPS_DIR = DATA_DIR / "trips"
USERS_FILE = DATA_DIR / "users.json"
DISPUTES_DIR = BASE_DIR / "disputes"

for _d in (TRIPS_DIR, DISPUTES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=str(UPLOADS_DIR)), name="evidence")

# Serialises every write to backend/disputes/*.json: case-id generation +
# creation, and read-merge-write of pipeline results. Prevents duplicate
# DISP-xxx ids and lost updates under concurrent requests.
_case_file_lock = threading.Lock()

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _now_iso() -> str:
    return datetime.now(_SGT).isoformat()


def _is_safe_id(value: str) -> bool:
    """Reject ids that could escape the data directories (e.g. '../x')."""
    return bool(value) and bool(_SAFE_ID_RE.match(value))


def _read_json(path: Path) -> Any | None:
    """Read a JSON file; return None if missing or unreadable."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return None



def _write_json_atomic(path: Path, data: Any) -> None:
    """Write JSON via a temp file + rename so readers never see a half-written file."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


# ---------------------------------------------------------------------------
# Case persistence (consumed by state_machine.py)
#
# A dispute case lives in ONE file: backend/disputes/{case_id}.json.
# It starts with case_metadata / dispute_claim / data_sources (written by
# create-dispute); the pipeline and human review then merge their results
# (round_1_statements ... judge_verdict, policy_kb_update) into that file.
# ---------------------------------------------------------------------------


def get_case(case_id: str) -> dict[str, Any] | None:
    """
    Load a raw dispute case from backend/disputes/{case_id}.json.

    Returns the parsed JSON dict, or None if the case does not exist.
    """
    if not _is_safe_id(case_id):
        return None
    data = _read_json(DISPUTES_DIR / f"{case_id}.json")
    return data if isinstance(data, dict) else None


def is_completed_case(case_data: dict[str, Any] | None) -> bool:
    """A case is 'completed' once EXECUTION_ROUTER has written an execution_payload."""
    if not case_data:
        return False
    return bool((case_data.get("judge_verdict") or {}).get("execution_payload"))


def save_case(result: dict[str, Any]) -> None:
    """
    Persist a pipeline result into the dispute case file.

    The result (case_metadata, data_sources, round_1_statements, ...,
    judge_verdict, policy_kb_update) is merged on top of the existing
    backend/disputes/{case_id}.json, so any top-level section the result
    does not carry (e.g. dispute_claim) is preserved.

    Raises ValueError if the case id is invalid or the case file does not
    exist, so results are never silently dropped or written to a stray file.
    """
    case_id = (result.get("case_metadata") or {}).get("case_id") or result.get("case_id")
    if not case_id or not _is_safe_id(case_id):
        raise ValueError(f"Cannot save result: invalid case_id {case_id!r}")

    file_path = DISPUTES_DIR / f"{case_id}.json"
    with _case_file_lock:
        existing = _read_json(file_path)
        if not isinstance(existing, dict):
            raise ValueError(f"Cannot save result: case file for {case_id} not found")
        _write_json_atomic(file_path, {**existing, **result})


def get_completed_case(case_id: str) -> dict[str, Any] | None:
    """
    Return the case (with pipeline results) for case_id from its case file,
    or None if the case does not exist or the pipeline has not completed.

    Used by apply_human_review / apply_party_decision so decisions are
    applied to the real pipeline result.
    """
    case_data = get_case(case_id)
    return case_data if is_completed_case(case_data) else None


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class CreateDisputeRequest(BaseModel):
    trip_id: str
    dispute_type: str
    dispute_claim_description: str
    filed_by: str  # "RIDER" | "DRIVER", or the filing party_id (e.g. "R-1092" / "D-5541")
    rider_id: str
    driver_id: str
    # Plain URL/path strings or schema objects (ImageEvidenceInput / ReceiptEvidenceInput)
    image_evidence: List[str | dict[str, Any]] = []
    receipt_evidence: List[str | dict[str, Any]] = []

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


class PartyDecisionRequest(BaseModel):
    decision: str = Field(
        ...,
        description="ACCEPT | REQUEST_HUMAN_REVIEW",
    )
    comment: str = Field("", description="Optional comment from the party")


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
# Dispute creation, listing & raw data loading
# ---------------------------------------------------------------------------

def _find_user(party_id: str) -> Any | None:
    """Look up a user via user_repo, falling back to backend/data/users.json."""
    try:
        user = user_repo.get_by_party_id(party_id)
    except Exception as exc:  # repo misconfigured / file missing
        logger.warning("user_repo lookup failed for %s: %s", party_id, exc)
        user = None
    if user:
        return user

    data = _read_json(USERS_FILE)
    if isinstance(data, dict):
        if isinstance(data.get(party_id), dict):
            return data[party_id]
        data = data.get("users", list(data.values()))
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("party_id") == party_id:
                return item
    return None


def _get_trip_ids(user: Any) -> list[str]:
    """Extract trips_past_30_days from a Pydantic model or a dict."""
    if isinstance(user, dict):
        trip_ids = user.get("trips_past_30_days")
    else:
        trip_ids = getattr(user, "trips_past_30_days", None)
    return list(trip_ids or [])


@app.get("/api/v1/30-days-trips/{party_id}")
async def list_past_30_days_trips(party_id: str):
    """
    Retrieve the past 30 days of trips for a user by party_id.

    Reads trips_past_30_days from the user record (backend/data/users.json),
    then loads each backend/data/trips/{trip_id}.json and returns
    trip_data, payment_fare_data and historical_profiles per trip.
    """
    user = _find_user(party_id)
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    results: list[dict[str, Any]] = []

    for trip_id in _get_trip_ids(user):
        if not _is_safe_id(str(trip_id)):
            logger.warning("Skipping invalid trip id %r for %s", trip_id, party_id)
            continue

        trip_json = _read_json(TRIPS_DIR / f"{trip_id}.json")
        if not isinstance(trip_json, dict):
            continue  # missing / corrupted trip file: skip gracefully

        results.append(
            {
                "trip_id": trip_id,
                "trip_data": trip_json.get("trip_data"),
                "payment_fare_data": trip_json.get("payment_fare_data"),
                "historical_profiles": trip_json.get("historical_profiles"),
            }
        )

    return {
        "party_id": party_id,
        "total_trips": len(results),
        "trips": results,
    }


def _case_number(path: Path) -> int:
    """Numeric part of DISP-001.json -> 1 (non-matching names return -1)."""
    try:
        return int(path.stem.split("-")[1])
    except (IndexError, ValueError):
        return -1


def generate_next_case_id() -> str:
    """Scan backend/disputes and generate sequential ids: DISP-001, DISP-002, ...

    Call while holding _case_file_lock to avoid duplicate ids.
    """
    max_num = max(
        (_case_number(f) for f in DISPUTES_DIR.glob("DISP-*.json")),
        default=0,
    )
    return f"DISP-{max(max_num, 0) + 1:03d}"


def _resolve_filed_by(filed_by: str, rider_id: str, driver_id: str) -> str:
    """Map the filer to the schema enum (RIDER | DRIVER)."""
    value = filed_by.strip()
    if value.upper() in ("RIDER", "DRIVER"):
        return value.upper()
    if value == rider_id:
        return "RIDER"
    if value == driver_id:
        return "DRIVER"
    raise HTTPException(
        status_code=422,
        detail="filed_by must be RIDER, DRIVER, or match rider_id / driver_id",
    )


def _normalize_evidence(
    items: list[str | dict[str, Any]],
    *,
    id_prefix: str,
    id_key: str,
    url_key: str,
    uploaded_at: str | None = None,
) -> list[dict[str, Any]]:
    """Turn plain URL strings into schema objects; validate object entries."""
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        if isinstance(item, str):
            entry: dict[str, Any] = {url_key: item}
        else:
            entry = dict(item)
        if not entry.get(url_key):
            raise HTTPException(
                status_code=422,
                detail=f"Evidence item #{index} is missing '{url_key}'",
            )
        entry.setdefault(id_key, f"{id_prefix}-{index:03d}")
        if uploaded_at:
            entry.setdefault("uploaded_at", uploaded_at)
        normalized.append(entry)
    return normalized


@app.post("/api/v1/create-dispute", status_code=201)
async def create_dispute_case(payload: CreateDisputeRequest):
    """
    Create a dispute case file at backend/disputes/{case_id}.json.

    The case embeds the trip source data from backend/data/trips/{trip_id}.json
    under data_sources, and is immediately usable by every /api/disputes/*
    endpoint (list, raw data, SSE pipeline stream, human review, ...).
    """
    # 1. Validate and load trip source data
    if not _is_safe_id(payload.trip_id):
        raise HTTPException(status_code=422, detail="Invalid trip_id")

    trip_file_path = TRIPS_DIR / f"{payload.trip_id}.json"
    if not trip_file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Trip record {payload.trip_id} not found",
        )

    try:
        with open(trip_file_path, "r", encoding="utf-8") as tf:
            trip_json_data = json.load(tf)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read trip source file: {str(e)}",
        )

    filed_at = _now_iso()
    filed_by = _resolve_filed_by(payload.filed_by, payload.rider_id, payload.driver_id)

    # 2. Generate id + write file atomically under a lock (no duplicate ids)
    with _case_file_lock:
        case_id = generate_next_case_id()

        try:
            image_evidence, receipt_evidence = process_uploaded_evidence(
                case_id, payload.image_evidence, payload.receipt_evidence, filed_at
            )
        except EvidenceUploadError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        dispute_payload = {
            "case_metadata": {
                "case_id": case_id,
                "dispute_type": payload.dispute_type,
                "dispute_claim_description": payload.dispute_claim_description,
                "trip_id": payload.trip_id,
                "rider_id": payload.rider_id,
                "driver_id": payload.driver_id,
                "current_state": "INIT_CLAIM",
                "current_round": 1,
                # Placeholder required by the schema; EXECUTION_ROUTER sets the real value
                "resolution_channel": "FULLY_AUTOMATED",
                "created_at": filed_at,
                "updated_at": filed_at,
            },
            "dispute_claim": {
                "case_id": case_id,
                "trip_id": payload.trip_id,
                "dispute_type": payload.dispute_type,
                "description": payload.dispute_claim_description,
                "filed_by": filed_by,
                "filed_at": filed_at,
                "image_evidence": image_evidence,
                "receipt_evidence": receipt_evidence,
            },
            "data_sources": trip_json_data,
        }

        file_path = DISPUTES_DIR / f"{case_id}.json"
        try:
            # "x" = fail rather than overwrite an existing case
            with open(file_path, "x", encoding="utf-8") as f:
                json.dump(dispute_payload, f, indent=2, ensure_ascii=False)
        except Exception as e:
            shutil.rmtree(UPLOADS_DIR / case_id, ignore_errors=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save dispute file: {str(e)}",
            )

    return {
        "message": "Dispute case created successfully",
        "case_id": case_id,
        "file_path": str(file_path),
        "data": dispute_payload,
    }


@app.get("/api/disputes")
async def list_dispute_cases():
    """
    List all dispute cases by scanning backend/disputes/.

    For each case file, reads case_metadata to extract case_id, dispute_type
    and current_state. Fully dynamic, no hardcoded data.
    """
    cases: list[dict[str, Any]] = []

    # Numeric sort so DISP-1000 comes after DISP-999
    for file_path in sorted(DISPUTES_DIR.glob("*.json"), key=lambda p: (_case_number(p), p.stem)):
        case_data = _read_json(file_path)
        if not isinstance(case_data, dict):
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
                "created_at": meta.get("created_at"),
                "has_completed_result": is_completed_case(case_data),
            }
        )

    return cases


@app.get("/api/disputes/{dispute_id}")
async def get_dispute_data(dispute_id: str):
    """Load the raw dispute case from backend/disputes/{dispute_id}.json."""
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

@app.get("/api/disputes/{dispute_id}/stream")
async def stream_pipeline_realtime(dispute_id: str):
    """
    通过 SSE (Server-Sent Events) 实时推送 Pipeline 执行事件
    """
    case_data = get_case(dispute_id)
    if case_data is None:
        raise HTTPException(
            status_code=404, detail=f"Dispute dataset not found: {dispute_id}"
        )

    async def event_generator():
        try:
            # 实时产生事件，出一条就往前端推一条
            async for event in run_dispute_pipeline_realtime(dispute_id):
                # event now contains:
                # PHASE_STARTED
                # PHASE_COMPLETED
                # AGENT_CONVERSATION
                yield {
                    "event": "pipeline_event",  # 事件类型
                    "data": json.dumps(event),  # 转为 JSON 字符串传输
                }
        except Exception as exc:
            logger.exception("Pipeline failed for %s", dispute_id)
            yield {
                "event": "pipeline_error",
                "data": json.dumps({"case_id": dispute_id, "detail": str(exc)}),
            }
            return

        # 流结束时，推送一条完成通知及最终 verdict 结果
        final_result = get_completed_case(dispute_id)
        yield {
            "event": "pipeline_complete",
            "data": json.dumps({"result": final_result}),
        }

    return EventSourceResponse(event_generator())

# ---------------------------------------------------------------------------
# Completed results retrieval
# ---------------------------------------------------------------------------


@app.get("/api/disputes/{dispute_id}/result")
async def get_completed_result(dispute_id: str):
    """Retrieve the completed pipeline result for a previously-run case."""
    result = get_completed_case(dispute_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No completed result for case {dispute_id}. Run the pipeline first.",
        )
    return result


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
        status = 409 if "already been reviewed" in str(exc) else 404
        raise HTTPException(status_code=status, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Human review application failed: {exc}",
        )

    return result


# ---------------------------------------------------------------------------
# Party decision (terminal-user accept / request human review)
# ---------------------------------------------------------------------------


@app.post("/api/disputes/{dispute_id}/party-decision")
async def submit_party_decision(dispute_id: str, request: PartyDecisionRequest):
    """
    Submit a terminal-user (rider/driver) decision for a FULLY_AUTOMATED case.

    Only cases with resolution_channel=FULLY_AUTOMATED and no prior
    party_decision are eligible.

    ACCEPT: records the decision, case stays resolved.
    REQUEST_HUMAN_REVIEW: escalates the case to human review without
    rolling back any already-issued refund.

    Does not affect the human-review flow — a human reviewer can still
    review the case afterward via POST /human-review.
    """
    valid_decisions = {d.value for d in PartyDecisionType}
    if request.decision not in valid_decisions:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid decision: {request.decision}. "
                f"Must be one of: {', '.join(sorted(valid_decisions))}"
            ),
        )

    try:
        result = await apply_party_decision(
            case_id=dispute_id,
            decision=PartyDecisionType(request.decision),
            comment=request.comment,
        )
    except ValueError as exc:
        msg = str(exc)
        if "not eligible" in msg or "already received" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=404, detail=msg)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Party decision application failed: {exc}",
        )

    return result


# ---------------------------------------------------------------------------
# Verdict image (stain boxes + stamp + caption)
# ---------------------------------------------------------------------------


@app.get("/api/disputes/{dispute_id}/evidence/{image_id}/verdict.jpg")
async def get_verdict_image(dispute_id: str, image_id: str):
    """Render a verdict JPEG for an uploaded evidence photo."""
    if not _is_safe_id(dispute_id):
        raise HTTPException(status_code=422, detail="Invalid dispute_id")
    if not _is_safe_id(image_id):
        raise HTTPException(status_code=422, detail="Invalid image_id")

    case = get_case(dispute_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {dispute_id} not found")

    render_args = build_verdict_render_args(case, image_id)
    if render_args is None:
        raise HTTPException(status_code=404, detail=f"Image {image_id} not found in case {dispute_id}")

    # Find the image dict to get image_url
    claim = case.get("dispute_claim") or {}
    images = claim.get("image_evidence") or []
    image_url = None
    for img in images:
        if isinstance(img, dict) and img.get("image_id") == image_id:
            image_url = img.get("image_url")
            break

    if not isinstance(image_url, str) or not image_url.startswith("/evidence/"):
        raise HTTPException(status_code=404, detail="Only uploaded images have verdict renders")

    file_name = image_url.split("/")[-1]
    source_file = UPLOADS_DIR / dispute_id / file_name
    if not source_file.exists():
        raise HTTPException(status_code=404, detail="Source image file not found")

    output_path = UPLOADS_DIR / dispute_id / f"{image_id}_verdict.jpg"
    try:
        render_verdict_image(source_file, output_path, **render_args)
    except Exception:
        logger.exception("Failed to render verdict image for %s/%s", dispute_id, image_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to render verdict image",
        )

    return FileResponse(
        output_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# Image evidence check (structured summary for frontend)
# ---------------------------------------------------------------------------


@app.get("/api/disputes/{dispute_id}/evidence/image-check")
def get_image_check(dispute_id: str):
    """Return a structured image evidence check for the dispute case."""
    if not _is_safe_id(dispute_id):
        raise HTTPException(status_code=422, detail="Invalid dispute_id")

    case = get_case(dispute_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    return build_image_check(case)


# ---------------------------------------------------------------------------
# Voice transcription (TRTC ASR one-sentence recognition)
# ---------------------------------------------------------------------------


class VoiceTranscribeRequest(BaseModel):
    audio: str = Field(..., description="Audio data URL (base64)")
    language: Literal["en", "zh", "ms"] = Field("en")


@app.post("/api/voice/transcribe")
def transcribe_voice(payload: VoiceTranscribeRequest):
    """Transcribe a short audio clip to text via Tencent TRTC ASR."""
    try:
        audio_bytes, voice_format = parse_audio_data_url(payload.audio)
    except AudioRejected as exc:
        status = exc.status
        if status == 415:
            detail = "Unsupported audio format. Send WAV, MP3, M4A or OGG-Opus."
        elif status == 413:
            detail = "Recording too large (max 3 MB / 60 s)."
        else:
            detail = "Invalid audio data"
        raise HTTPException(status_code=status, detail=detail)

    # Check WAV duration.
    if voice_format == "wav":
        from backend.shared.voice_asr import _wav_duration_seconds

        try:
            duration = _wav_duration_seconds(audio_bytes)
        except AudioRejected:
            raise HTTPException(status_code=422, detail="Invalid audio data")
        if duration > 60.0:
            raise HTTPException(status_code=413, detail="Recording too large (max 3 MB / 60 s).")

    try:
        result = transcribe(audio_bytes, voice_format, payload.language)
    except ASRNotConfigured:
        raise HTTPException(status_code=503, detail="Voice input is not configured")
    except AudioRejected as exc:
        status = exc.status
        if status == 413:
            detail = "Recording too large (max 3 MB / 60 s)."
        elif status == 415:
            detail = "Unsupported audio format. Send WAV, MP3, M4A or OGG-Opus."
        else:
            detail = "Invalid audio data"
        raise HTTPException(status_code=status, detail=detail)
    except VoiceError:
        raise HTTPException(status_code=502, detail="Voice recognition failed")

    return {
        "text": result["text"],
        "duration_ms": result["duration_ms"],
        "language": result["language"],
    }


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
    result = get_completed_case(dispute_id)
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