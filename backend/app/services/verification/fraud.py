"""P3 Fraud & Bad-Faith Detection — deterministic risk-assessment layer.

This module assesses fraud RISK only.  It does NOT:
- decide rider/driver liability,
- issue the final dispute ruling,
- interpret Ryde policy,
- modify Judge confidence,
- automatically block an account,
- claim that fraud is proven,
- treat historical bad-faith data as proof of the current case.

All weights are fraud-detection technical heuristics, NOT Ryde policy.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Scoring constants — centralized and named
# ---------------------------------------------------------------------------

# --- Current-case image evidence weights ---
_WEIGHT_RECYCLED_IMAGE: float = 0.40
_WEIGHT_RECYCLED_RECEIPT: float = 0.40
_WEIGHT_AI_GENERATED_MAX: float = 0.35
_WEIGHT_EXIF_INCONSISTENT: float = 0.25
_WEIGHT_MULTI_SIGNAL_BONUS: float = 0.10

# --- Historical-profile weights ---
_WEIGHT_BAD_FAITH_FLAG: float = 0.15
_WEIGHT_RISK_SCORE_FACTOR: float = 0.10
_WEIGHT_DISPUTES_30D: float = 0.05
_WEIGHT_DISPUTES_90D: float = 0.05

# --- Safeguards ---
_HISTORY_ONLY_SCORE_CAP: float = 0.40

# --- Action thresholds ---
_THRESHOLD_NO_ACTION: float = 0.20
_THRESHOLD_REFER_TO_FRAUD_TEAM: float = 0.55


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_number(value: Any) -> bool:
    """Return True for real numbers (not bool)."""
    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _extract_receipts(context: dict[str, Any]) -> list[dict[str, Any]]:
    """Return receipt_evidence list from context.data_sources, or empty."""
    ds = context.get("data_sources", {})
    if not isinstance(ds, dict):
        return []
    raw = ds.get("receipt_evidence")
    if not isinstance(raw, list):
        return []
    return [r for r in raw if isinstance(r, dict)]


def _count_current_signals(
    image_analyses: list[dict[str, Any]],
    receipt_analyses: list[dict[str, Any]] | None = None,
) -> tuple[int, list[str]]:
    """Count independent current-case fraud signals and collect risk-factor strings.

    Returns (signal_count, risk_factors).
    """
    if receipt_analyses is None:
        receipt_analyses = []

    factors: list[str] = []
    signal_count = 0

    for analysis in image_analyses:
        img_id = analysis.get("image_id", "unknown")

        # A. Recycled image
        if analysis.get("recycled_image_detected") is True:
            signal_count += 1
            match_case = analysis.get("recycled_image_match_case_id")
            if match_case:
                factors.append(
                    f"Image reuse detected: {img_id} matches prior case {match_case}"
                )
            else:
                factors.append(f"Image reuse detected: {img_id} (matched prior case)")

        # B. AI-generated image
        if analysis.get("is_ai_generated") is True:
            conf = analysis.get("ai_generated_confidence", 0.0)
            if _is_number(conf):
                signal_count += 1
                factors.append(
                    f"AI-generated image risk signal: {img_id} "
                    f"(confidence {float(conf):.2f})"
                )

        # C. EXIF inconsistent with trip
        exif_consistent = analysis.get("exif_consistent_with_trip")
        if exif_consistent is False:
            signal_count += 1
            factors.append(
                f"EXIF mismatch risk signal: {img_id} metadata inconsistent with trip data"
            )

    # D. Recycled receipt (independent signal, counted separately from image)
    for receipt in receipt_analyses:
        rcp_id = receipt.get("receipt_id", "unknown")
        if receipt.get("recycled_receipt_detected") is True:
            signal_count += 1
            match_case = receipt.get("recycled_receipt_match_case_id")
            if match_case:
                factors.append(
                    f"Receipt reuse risk signal detected: {rcp_id} matches prior case {match_case}"
                )
            else:
                factors.append(
                    f"Receipt reuse risk signal detected: {rcp_id} (matched prior case)"
                )

    return signal_count, factors


def _score_current_evidence(
    image_analyses: list[dict[str, Any]],
    receipt_analyses: list[dict[str, Any]] | None = None,
) -> float:
    """Compute raw score contribution from current-case evidence."""
    if receipt_analyses is None:
        receipt_analyses = []

    score = 0.0
    has_recycled_image = False
    has_recycled_receipt = False
    has_ai = False
    has_exif_mismatch = False

    for analysis in image_analyses:
        if analysis.get("recycled_image_detected") is True:
            score += _WEIGHT_RECYCLED_IMAGE
            has_recycled_image = True

        if analysis.get("is_ai_generated") is True:
            conf = analysis.get("ai_generated_confidence", 0.0)
            if _is_number(conf):
                score += float(conf) * _WEIGHT_AI_GENERATED_MAX
                has_ai = True

        if analysis.get("exif_consistent_with_trip") is False:
            score += _WEIGHT_EXIF_INCONSISTENT
            has_exif_mismatch = True

    for receipt in receipt_analyses:
        if receipt.get("recycled_receipt_detected") is True:
            score += _WEIGHT_RECYCLED_RECEIPT
            has_recycled_receipt = True

    # Multiple independent current signals bonus
    independent_signals = sum([has_recycled_image, has_recycled_receipt, has_ai, has_exif_mismatch])
    if independent_signals >= 2:
        score += _WEIGHT_MULTI_SIGNAL_BONUS

    return score


def _extract_historical_profiles(context: dict[str, Any]) -> list[dict[str, Any]]:
    """Return historical_profiles list, or empty if missing/malformed."""
    ds = context.get("data_sources", {})
    profiles = ds.get("historical_profiles", [])
    if isinstance(profiles, list):
        return profiles
    return []


def _score_historical_profiles(profiles: list[dict[str, Any]]) -> tuple[float, list[str], bool, str]:
    """Compute raw score contribution from historical profiles.

    Returns (score, risk_factors, abuse_detected, abuse_description).
    """
    score = 0.0
    factors: list[str] = []
    abuse_detected = False
    abuse_parts: list[str] = []

    for profile in profiles:
        if not isinstance(profile, dict):
            continue

        party = profile.get("party", "UNKNOWN")
        party_id = profile.get("party_id", "?")
        bad_faith = profile.get("bad_faith_flag")
        risk_score = profile.get("risk_score")
        d30 = profile.get("dispute_history_30d")
        d90 = profile.get("dispute_history_90d")
        reason = profile.get("bad_faith_reason")

        if bad_faith is True:
            score += _WEIGHT_BAD_FAITH_FLAG
            factors.append(
                f"Historical profile contains prior bad-faith flag for {party} {party_id}"
            )
            if reason:
                factors.append(f"  Reason: {reason}")

        if _is_number(risk_score):
            score += float(risk_score) * _WEIGHT_RISK_SCORE_FACTOR
            factors.append(
                f"Historical risk score for {party} {party_id}: {float(risk_score):.2f}"
            )

        if isinstance(d30, int) and d30 > 2:
            score += _WEIGHT_DISPUTES_30D
            factors.append(
                f"Historical dispute frequency for {party} {party_id}: "
                f"{d30} disputes in 30 days"
            )

        if isinstance(d90, int) and d90 > 4:
            score += _WEIGHT_DISPUTES_90D
            factors.append(
                f"Historical dispute frequency for {party} {party_id}: "
                f"{d90} disputes in 90 days"
            )

        # Abuse-pattern detection (historical)
        if bad_faith is True and ((isinstance(d90, int) and d90 >= 3) or isinstance(reason, str)):
            abuse_detected = True
            desc = f"{party} {party_id}"
            if reason:
                desc += f" — {reason}"
            if isinstance(d90, int) and d90 >= 3:
                desc += f" ({d90} disputes in 90d)"
            abuse_parts.append(desc)

    if abuse_parts:
        abuse_description = "HISTORICAL pattern: " + "; ".join(abuse_parts)
    else:
        abuse_description = ""
    return score, factors, abuse_detected, abuse_description


def has_current_case_signals(
    image_analyses: list[dict[str, Any]],
    receipt_analyses: list[dict[str, Any]] | None = None,
) -> bool:
    """Return True if any objective current-case fraud signal is present."""
    count, _ = _count_current_signals(image_analyses, receipt_analyses)
    return count > 0


def _determine_action(score: float, has_current_signals: bool) -> str:
    """Map score to recommended fraud action.

    Never auto-recommends BLOCK_ACCOUNT.
    History-only cases are capped and cannot reach REFER_TO_FRAUD_TEAM.
    """
    if score < _THRESHOLD_NO_ACTION:
        return "NO_ACTION"
    if score < _THRESHOLD_REFER_TO_FRAUD_TEAM:
        return "FLAG_FOR_REVIEW"
    if has_current_signals:
        return "REFER_TO_FRAUD_TEAM"
    # History-only capped cases should not reach here, but guard anyway
    return "FLAG_FOR_REVIEW"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def assess_fraud_risk(
    context: dict[str, Any],
    image_analyses: list[dict[str, Any]],
    prosecutor_findings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assess fraud risk and return a schema-valid FraudAssessment dict.

    The assessment is deterministic, stateless, and explainable.
    All risk language uses "risk signal" / "detected" phrasing;
    it never describes risk as certainty or proven fraud.
    """
    # 1. Current-case evidence (images + receipts)
    receipt_analyses = _extract_receipts(context)
    current_signal_count, current_factors = _count_current_signals(
        image_analyses, receipt_analyses
    )
    current_score = _score_current_evidence(image_analyses, receipt_analyses)
    has_current_signals = current_signal_count > 0

    # 2. Historical profiles
    profiles = _extract_historical_profiles(context)
    hist_score, hist_factors, hist_abuse, hist_abuse_desc = _score_historical_profiles(profiles)

    # 3. Combine
    total_score = current_score + hist_score

    # 4. History-only safeguard: cap when no objective current-case signals
    if not has_current_signals:
        total_score = min(total_score, _HISTORY_ONLY_SCORE_CAP)

    # 5. Final clamp [0, 1]
    total_score = _clamp(total_score, 0.0, 1.0)

    # 6. Build risk factors (current first, then historical)
    risk_factors: list[str] = []
    if current_factors:
        risk_factors.extend(current_factors)
    if hist_factors:
        risk_factors.extend(hist_factors)
    if not risk_factors:
        risk_factors.append("No objective fraud risk signals detected")

    # 7. Abuse pattern
    abuse_detected = hist_abuse
    abuse_description = hist_abuse_desc

    # Current-case abuse signal (recycled image from another case)
    if any(a.get("recycled_image_detected") is True for a in image_analyses):
        abuse_detected = True
        if abuse_description:
            abuse_description = f"CURRENT evidence: image reuse detected; {abuse_description}"
        else:
            abuse_description = "CURRENT evidence: image reuse detected across cases"

    # Current-case abuse signal (recycled receipt from another case)
    if any(r.get("recycled_receipt_detected") is True for r in receipt_analyses):
        abuse_detected = True
        if abuse_description:
            abuse_description = f"CURRENT evidence: receipt reuse detected; {abuse_description}"
        else:
            abuse_description = "CURRENT evidence: receipt reuse detected across cases"

    # 8. Collusion — conservative; no structured collusion graph available
    collusion_flag = False
    collusion_evidence: str | None = None

    # 9. Recommended action
    action = _determine_action(total_score, has_current_signals)

    result: dict[str, Any] = {
        "fraud_risk_score": round(total_score, 3),
        "risk_factors": risk_factors,
        "collusion_warning_flag": collusion_flag,
        "abuse_pattern_detected": abuse_detected,
    }

    if collusion_evidence is not None:
        result["collusion_evidence"] = collusion_evidence
    if abuse_description:
        result["abuse_pattern_description"] = abuse_description
    if action:
        result["recommended_fraud_action"] = action

    return result
