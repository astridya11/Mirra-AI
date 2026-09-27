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

from backend.app.services.verification.fraud import assess_fraud_risk
from backend.app.services.verification.image_analysis import (
    analyze_image_evidence_batch,
    extract_images_from_context,
)
from backend.app.services.verification.ingestion import normalize_evidence
from backend.app.services.verification.report import generate_prosecutor_report


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

    # 3. Build round_2_cross_exam (placeholder — no targeted questions yet)
    now = datetime.now(timezone.utc).isoformat()
    round_2_cross_exam: dict[str, Any] = {
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

    # 6. Build bonus_modules with explicit schema-valid defaults
    #    Escalation remains a placeholder for the next milestone.
    bonus_modules: dict[str, Any] = {
        "image_exif_analyses": image_exif_analyses,
        "fraud_assessment": fraud_assessment,
        "escalation_protocol": {
            "safety_threat_detected": False,
            "fraud_risk_level": "LOW",
            "escalation_reasons": [],
            "is_escalated": False,
            "priority_level": "STANDARD",
        },
    }

    return {
        "round_2_cross_exam": round_2_cross_exam,
        "bonus_modules": bonus_modules,
        "prosecutor_findings": prosecutor_findings,
    }