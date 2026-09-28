"""P3 Prosecutor Agent adapter for P1's state machine.

Consumes the orchestrator context (case_metadata + data_sources) and returns
the exact 3-key structure required by the state-machine contract:

    {
        "round_2_cross_exam": {...},
        "bonus_modules": {...},
        "prosecutor_findings": {...}
    }

This module reuses the existing deterministic P3 Evidence Verification Engine;
it does not duplicate verification logic.
"""

from datetime import datetime, timezone
from typing import Any

from backend.app.services.verification.cross_exam import (
    build_cross_exam_summary,
    review_cross_exam,
)
from backend.app.services.verification.escalation import assess_escalation_signals
from backend.app.services.verification.fraud import assess_fraud_risk
from backend.app.services.verification.image_analysis import (
    analyze_image_evidence_batch,
    extract_images_from_context,
)
from backend.app.services.verification.ingestion import normalize_evidence
from backend.app.services.verification.report import generate_prosecutor_report
from backend.agents.prosecutor_questions import generateQuestion  # noqa: F401  (P2: cross-exam question generation)


async def run_prosecutor_audit(context: dict[str, Any]) -> dict[str, Any]:
    """Run the Prosecutor Agent audit phase.

    Args:
        context: Orchestrator context containing at minimum:
            - case_metadata (dict)
            - data_sources (dict)

    Returns:
        dict with exactly three top-level keys:
            - round_2_cross_exam
            - bonus_modules
            - prosecutor_findings
    """
    # 1. Normalize evidence in the incoming context
    normalized = normalize_evidence(context)

    # 2. Generate prosecutor_findings using the existing deterministic engine
    prosecutor_findings = generate_prosecutor_report(normalized)

    # 3. Determine initial vs final audit based on Round 2 responses
    now = datetime.now(timezone.utc).isoformat()
    existing_r2 = normalized.get("round_2_cross_exam", {})
    if not isinstance(existing_r2, dict):
        existing_r2 = {}

    existing_responses = existing_r2.get("targeted_responses", [])
    if not isinstance(existing_responses, list):
        existing_responses = []

    if existing_responses:
        # FINAL AUDIT — responses exist; enrich summary with cross-exam review
        round_2_cross_exam = existing_r2
        review = review_cross_exam(
            context=normalized,
            prosecutor_report=prosecutor_findings,
        )
        cross_exam_summary = build_cross_exam_summary(review)
        base_summary = prosecutor_findings.get("prosecutor_summary", "")
        prosecutor_findings["prosecutor_summary"] = f"{base_summary} {cross_exam_summary}"
        prosecutor_findings["report_submitted_at"] = now
    else:
        # INITIAL AUDIT — no responses yet; safe placeholder
        round_2_cross_exam = {
            "targeted_questions": [],
            "targeted_responses": [],
            "round2_completed": True,
            "completed_at": now,
        }

    # 4. Image evidence analysis — real P3 layer, empty when no images present
    image_inputs = extract_images_from_context(normalized)
    image_exif_analyses = analyze_image_evidence_batch(
        image_inputs, normalized.get("data_sources", {})
    )

    # 5. Fraud assessment — deterministic P3 layer
    fraud_assessment = assess_fraud_risk(
        context=normalized,
        image_analyses=image_exif_analyses,
        prosecutor_findings=prosecutor_findings,
    )

    # 6. Escalation signals — deterministic P3 layer
    escalation_protocol = assess_escalation_signals(
        context=normalized,
        fraud_assessment=fraud_assessment,
        prosecutor_findings=prosecutor_findings,
        image_analyses=image_exif_analyses,
    )

    # 7. Build bonus_modules with explicit schema-valid structure
    bonus_modules: dict[str, Any] = {
        "image_exif_analyses": image_exif_analyses,
        "fraud_assessment": fraud_assessment,
        "escalation_protocol": escalation_protocol,
    }

    return {
        "round_2_cross_exam": round_2_cross_exam,
        "bonus_modules": bonus_modules,
        "prosecutor_findings": prosecutor_findings,
    }