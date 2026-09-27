"""P3 Safety & Escalation Signals — deterministic evidence-layer routing input.

This module emits risk/safety signals that P1's Execution Router consumes.
It does NOT make the final routing decision (FULLY_AUTOMATED vs ESCALATED_HUMAN_REVIEW).

All logic is stateless, deterministic, and explainable.
"""

from __future__ import annotations

import math
from typing import Any

from .fraud import has_current_case_signals

# ---------------------------------------------------------------------------
# Thresholds for fraud-risk level bands (technical heuristics, NOT policy)
# ---------------------------------------------------------------------------
_BAND_LOW_MAX: float = 0.40
_BAND_MEDIUM_MAX: float = 0.70


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_fraud_score(fraud_assessment: dict[str, Any]) -> float:
    """Extract a safe numeric fraud score, defaulting to 0.0 for malformed input.

    Rejects bool, NaN, Infinity, and non-numeric values.
    """
    if not isinstance(fraud_assessment, dict):
        return 0.0
    raw = fraud_assessment.get("fraud_risk_score")
    if isinstance(raw, bool):
        return 0.0
    if not isinstance(raw, (int, float)):
        return 0.0
    if math.isnan(raw) or math.isinf(raw):
        return 0.0
    return float(raw)


def _has_current_case_signals_safe(
    image_analyses: list[dict[str, Any]] | None,
) -> bool:
    """Return True if objective current-case fraud signals exist.

    Only ever answers from actual structured evidence (image_analyses).
    When no evidence input is available at all, this returns False rather
    than treating fraud_assessment's advisory recommended_fraud_action
    string as proof that current-case evidence exists — that would be a
    circular inference (an advisory conclusion used as its own evidence),
    and fragile besides: it silently depends on fraud.py's internal
    invariant that REFER_TO_FRAUD_TEAM is never recommended without real
    current signals, an assumption this module has no way to verify.
    Conservative False is the correct default when the objective input is
    simply missing.
    """
    if image_analyses is not None:
        return has_current_case_signals(image_analyses)
    return False


def _detect_safety_signals(context: dict[str, Any]) -> dict[str, bool]:
    """Detect structured safety threat signals, per distinct source.

    Does NOT infer safety from sentiment, profanity, disagreement, or fraud.
    Returns which structured source(s) actually fired so callers can report
    accurate provenance — e.g. a SAFETY_ALERT-classified dispute with no
    chat evidence at all must never be described as a chat safety signal.
    """
    signals = {
        "dispute_classification": False,
        "chat_aggregate_flag": False,
        "chat_message_keywords": False,
    }

    # 1. Dispute type == SAFETY_ALERT
    case_meta = context.get("case_metadata", {})
    if isinstance(case_meta, dict) and case_meta.get("dispute_type") == "SAFETY_ALERT":
        signals["dispute_classification"] = True

    ds = context.get("data_sources", {})
    if not isinstance(ds, dict):
        return signals

    # 2. Structured chat-communication aggregate safety flag
    chat = ds.get("chat_communication")
    if isinstance(chat, dict):
        if chat.get("safety_threat_keywords_detected") is True:
            signals["chat_aggregate_flag"] = True

        # 3. Per-message safety keywords
        transcript = chat.get("transcript", [])
        if isinstance(transcript, list):
            for msg in transcript:
                if isinstance(msg, dict):
                    keywords = msg.get("safety_threat_keywords")
                    if isinstance(keywords, list) and len(keywords) > 0:
                        signals["chat_message_keywords"] = True
                        break

    return signals


def _compute_fraud_risk_level(
    score: float,
    has_current_signals: bool,
) -> str:
    """Map score to LOW / MEDIUM / HIGH with history-only safeguard.

    HIGH requires both score threshold AND at least one objective current-case signal.
    History-only assessments (which are capped at _BAND_LOW_MAX by fraud.py) will
    never reach MEDIUM or HIGH through this logic.
    """
    if score < _BAND_LOW_MAX:
        return "LOW"
    if score < _BAND_MEDIUM_MAX:
        return "MEDIUM"
    # score >= 0.70
    if has_current_signals:
        return "HIGH"
    # Extra safeguard: history-only must not become HIGH
    return "MEDIUM"


def _build_escalation_reasons(
    safety_signals: dict[str, bool],
    fraud_level: str,
    has_current_signals: bool,
) -> list[str]:
    """Build neutral, evidence-grounded escalation reasons with accurate provenance.

    Each safety source is named for what it actually is — a dispute-type
    classification is not chat evidence, and never claimed to be. The two
    chat-based sources (aggregate flag and per-message keywords) represent
    the same underlying "structured chat safety signal" class, so they
    collapse into one reason instead of two near-duplicates when both fire.
    """
    reasons: list[str] = []

    if safety_signals.get("dispute_classification"):
        reasons.append("Case is classified as a SAFETY_ALERT dispute")

    chat_aggregate = safety_signals.get("chat_aggregate_flag", False)
    chat_messages = safety_signals.get("chat_message_keywords", False)
    if chat_aggregate and chat_messages:
        reasons.append(
            "Structured chat safety signal detected "
            "(aggregate safety_threat_keywords_detected flag and per-message keywords)"
        )
    elif chat_aggregate:
        reasons.append(
            "Structured chat safety signal detected (aggregate safety_threat_keywords_detected flag)"
        )
    elif chat_messages:
        reasons.append(
            "Structured chat safety signal detected (per-message safety_threat_keywords)"
        )

    if fraud_level == "HIGH" and has_current_signals:
        reasons.append(
            "Fraud assessment reached HIGH technical risk level based on current-case evidence"
        )
    return reasons


def _compute_priority(
    safety_detected: bool,
    fraud_level: str,
) -> str:
    """Determine priority level."""
    if safety_detected:
        return "URGENT"
    if fraud_level == "HIGH":
        return "HIGH_PRIORITY"
    return "STANDARD"


def _compute_is_escalated(safety_detected: bool, fraud_level: str) -> bool:
    """Evidence-layer escalation recommendation.

    True when safety threat detected or fraud level is HIGH.
    MEDIUM fraud does NOT auto-escalate.
    """
    return safety_detected or fraud_level == "HIGH"


def _assess_missing_crucial_evidence(
    prosecutor_findings: dict[str, Any] | None,
) -> bool:
    """Conservative, count-based proxy for evidence incompleteness.

    This is NOT a materiality determination: ProsecutorReport's
    missing_facts carry no field indicating which facts are load-bearing
    for a ruling, so this engine has no structured way to know whether any
    given missing fact is "crucial." It only knows how many facts are
    missing. A high count (>= 5) is used purely as a conservative proxy for
    "the evidence set is too incomplete for confident automated resolution" —
    not a claim that specific facts were assessed as material.
    """
    if not isinstance(prosecutor_findings, dict):
        return False

    missing_facts = prosecutor_findings.get("missing_facts", [])
    if not isinstance(missing_facts, list) or len(missing_facts) == 0:
        return False

    if len(missing_facts) >= 5:
        return True

    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def assess_escalation_signals(
    context: dict[str, Any],
    fraud_assessment: dict[str, Any],
    prosecutor_findings: dict[str, Any] | None = None,
    image_analyses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Assess escalation signals and return a schema-valid EscalationProtocol dict.

    This is an evidence-layer signal only.  P1's Execution Router owns the
    final FULLY_AUTOMATED vs ESCALATED_HUMAN_REVIEW decision.
    """
    # 1. Safety detection (structured signals only, per source)
    safety_signals = _detect_safety_signals(context)
    safety_detected = any(safety_signals.values())

    # 2. Fraud risk level
    score = _safe_fraud_score(fraud_assessment)
    has_current = _has_current_case_signals_safe(image_analyses)
    fraud_level = _compute_fraud_risk_level(score, has_current)

    # 3. Escalation reasons
    reasons = _build_escalation_reasons(safety_signals, fraud_level, has_current)

    # 4. Priority & escalation flag
    priority = _compute_priority(safety_detected, fraud_level)
    is_escalated = _compute_is_escalated(safety_detected, fraud_level)

    # 5. Missing crucial evidence (conservative)
    missing_crucial = _assess_missing_crucial_evidence(prosecutor_findings)

    result: dict[str, Any] = {
        "safety_threat_detected": safety_detected,
        "fraud_risk_level": fraud_level,
        "escalation_reasons": reasons,
        "is_escalated": is_escalated,
        "priority_level": priority,
    }

    if missing_crucial:
        result["missing_crucial_evidence"] = missing_crucial

    return result
