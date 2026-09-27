"""
Advocate Utils — shared, prompt-independent helpers used by both advocate
agents (rider and driver) so their sanitisation and fallback rules stay
identical.

All functions here are deterministic: they never call the LLM.  They ensure
that every advocate output conforms to the AgentStatement / TargetedResponse
schemas in shared/schemas.json, regardless of what the model returns.
"""

import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any

# Timezone for submitted_at / responded_at timestamps.
_SGT = timezone(timedelta(hours=8))

# Allowed requested_outcome values (schema: AgentStatement.requested_outcome).
_VALID_OUTCOMES = {
    "FULL_REFUND",
    "PARTIAL_REFUND",
    "CLEANING_FEE_CHARGE",
    "NO_PENALTY",
    "CASE_DISMISSED",
    "OTHER",
}

# Evidence-ID patterns that the LLM might inline in response_text.
# Used to detect references and verify them against the evidence index.
_EVIDENCE_ID_PATTERN = re.compile(
    r"(?:GPS-\d{3}|OPT-\d{3}|ROUTE-SUMMARY|EVT-\d{3}|CHAT-\d{3}|MSG-\d{3}|"
    r"CHAT-GEN-\d{3}|TRIP-DATA|PAYMENT-DATA|PROFILE-RIDER|PROFILE-DRIVER)"
)


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------


def get_claimant(context: dict) -> str:
    """Return the filing party ("RIDER" or "DRIVER"), inferring if absent.

    If dispute_claim.filed_by is present, return it uppercased.
    Otherwise infer from dispute_type: CLEANING_FEE -> "DRIVER",
    everything else -> "RIDER".
    """
    dispute_claim = context.get("dispute_claim") or {}
    filed_by = dispute_claim.get("filed_by")
    if filed_by:
        return str(filed_by).upper()

    case_meta = context.get("case_metadata", {})
    dispute_type = case_meta.get("dispute_type", "")
    if dispute_type == "CLEANING_FEE":
        return "DRIVER"
    return "RIDER"


def get_claim_text(context: dict) -> str:
    """Return dispute_claim.description if present, else empty string."""
    dispute_claim = context.get("dispute_claim") or {}
    desc = dispute_claim.get("description")
    return str(desc) if desc else ""


# ---------------------------------------------------------------------------
# Statement sanitisation (Round 1)
# ---------------------------------------------------------------------------


def sanitize_statement(
    raw: dict,
    party: str,
    is_claimant: bool,
    context: dict,
    evidence_index: dict,
) -> dict:
    """Return a dict with ONLY AgentStatement schema keys.

    - requested_amount: claimant is capped at the disputed_amount in
      payment_fare_data; respondent is forced to 0.
    - evidence_references: only items whose evidence_id exists in
      evidence_index are kept.  source_type and description are always
      taken from the index, never from the LLM.
    - argument_summary: must be 10-2000 chars; if too short, a fallback
      is used.
    """
    # --- argument_summary ---
    summary = str(raw.get("argument_summary", "")).strip()
    if len(summary) < 10:
        summary = "No argument could be produced."
    if len(summary) > 2000:
        summary = summary[:2000]

    detailed = str(raw.get("detailed_argument", ""))

    # --- requested_outcome (initial normalisation) ---
    outcome = str(raw.get("requested_outcome", "")).upper()
    if outcome not in _VALID_OUTCOMES:
        outcome = ""  # invalid -> will be fixed by role rules below

    # --- requested_amount ---
    if is_claimant:
        # Cap at the disputed amount from payment data.
        payment = context.get("data_sources", {}).get("payment_fare_data", {})
        cap = payment.get("disputed_amount", 0)
        try:
            cap = float(cap)
        except (TypeError, ValueError):
            cap = 0.0
        try:
            amount = float(raw.get("requested_amount", 0))
        except (TypeError, ValueError):
            amount = 0.0
        amount = max(0.0, min(amount, cap))
    else:
        # Respondent never requests money.
        amount = 0.0

    # --- requested_outcome must match the party's role ---
    # "OTHER" is no longer allowed for LLM output; only safe_statement
    # uses it.  Invalid or mismatched outcomes get a role-specific default.
    if not is_claimant:
        # Respondent defends; never requests money.
        if outcome not in ("NO_PENALTY", "CASE_DISMISSED"):
            outcome = "CASE_DISMISSED"
    elif party == "RIDER":
        # Rider as claimant asks for a refund.
        if outcome not in ("FULL_REFUND", "PARTIAL_REFUND"):
            # Fallback depends on the final capped amount vs total_fare.
            payment = context.get("data_sources", {}).get("payment_fare_data", {})
            total_fare = payment.get("original_fare", {}).get("total_fare", 0)
            try:
                total_fare = float(total_fare)
            except (TypeError, ValueError):
                total_fare = 0.0
            if amount < total_fare:
                outcome = "PARTIAL_REFUND"
            else:
                outcome = "FULL_REFUND"
    else:
        # Driver as claimant asks for a cleaning fee.
        if outcome != "CLEANING_FEE_CHARGE":
            outcome = "CLEANING_FEE_CHARGE"

    # --- evidence_references ---
    raw_refs = raw.get("evidence_references", [])
    if not isinstance(raw_refs, list):
        raw_refs = []
    clean_refs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for ref in raw_refs:
        if not isinstance(ref, dict):
            continue
        eid = ref.get("evidence_id")
        if not eid or eid not in evidence_index or eid in seen_ids:
            continue
        seen_ids.add(eid)
        entry = evidence_index[eid]
        clean_refs.append({
            "evidence_id": eid,
            "source_type": entry.get("source_type", "OTHER"),
            "description": entry.get("description", ""),
        })

    now = datetime.now(_SGT).isoformat()

    # Determine agent_role from party.
    agent_role = "RIDER_ADVOCATE" if party == "RIDER" else "DRIVER_ADVOCATE"

    # ONLY AgentStatement keys (additionalProperties: false).
    return {
        "party": party,
        "agent_role": agent_role,
        "argument_summary": summary,
        "detailed_argument": detailed,
        "requested_outcome": outcome,
        "requested_amount": amount,
        "currency": "SGD",
        "evidence_references": clean_refs,
        "submitted_at": now,
    }


# ---------------------------------------------------------------------------
# Response sanitisation (Round 2)
# ---------------------------------------------------------------------------


def sanitize_response(
    raw: dict,
    party: str,
    question: dict,
    evidence_index: dict,
) -> dict:
    """Return a dict with ONLY TargetedResponse schema keys.

    - response_id: "R-" + 10 uppercase hex chars.
    - In response_text, any token that looks like an evidence ID but is
      not in evidence_index is replaced with "[unverified reference]".
    """
    # Generate a stable response_id.
    response_id = "R-" + secrets.token_hex(5).upper()

    question_id = question.get("question_id", "")

    # Sanitise response_text: replace unverified evidence IDs.
    text = str(raw.get("response_text", "")).strip()

    def _replace_unverified(match: re.Match) -> str:
        token = match.group(0)
        if token in evidence_index:
            return token
        return "[unverified reference]"

    text = _EVIDENCE_ID_PATTERN.sub(_replace_unverified, text)

    now = datetime.now(_SGT).isoformat()

    # ONLY TargetedResponse keys (additionalProperties: false).
    return {
        "response_id": response_id,
        "question_id": question_id,
        "responding_party": party,
        "response_text": text,
        "responded_at": now,
    }


# ---------------------------------------------------------------------------
# Safe fallbacks
# ---------------------------------------------------------------------------


def safe_statement(party: str, reason: str) -> dict:
    """Return a schema-valid AgentStatement fallback.

    Amount 0, outcome "OTHER", no evidence, and a neutral argument
    that does not reveal any case-specific details.
    """
    now = datetime.now(_SGT).isoformat()
    agent_role = "RIDER_ADVOCATE" if party == "RIDER" else "DRIVER_ADVOCATE"
    neutral = (
        "The advocate was unable to produce a statement at this time. "
        "The case will be reviewed."
    )
    return {
        "party": party,
        "agent_role": agent_role,
        "argument_summary": neutral,
        "detailed_argument": neutral,
        "requested_outcome": "OTHER",
        "requested_amount": 0,
        "currency": "SGD",
        "evidence_references": [],
        "submitted_at": now,
    }


def safe_response(party: str, question: dict, reason: str) -> dict:
    """Return a schema-valid TargetedResponse fallback.

    A neutral text that does not reveal any case-specific details.
    """
    response_id = "R-" + secrets.token_hex(5).upper()
    question_id = question.get("question_id", "")
    now = datetime.now(_SGT).isoformat()
    neutral = (
        "The advocate was unable to respond to this question. "
        "The case will be reviewed."
    )
    return {
        "response_id": response_id,
        "question_id": question_id,
        "responding_party": party,
        "response_text": neutral,
        "responded_at": now,
    }


# ---------------------------------------------------------------------------
# Question targeting
# ---------------------------------------------------------------------------


def question_is_for(question: dict, party: str) -> bool:
    """Check whether a question is directed at the given party.

    Accepts both 'directed_to' and 'target' fields.  Values are matched
    case-insensitively against: RIDER, RIDER_ADVOCATE, DRIVER,
    DRIVER_ADVOCATE, and BOTH.
    """
    raw_target = (
        question.get("directed_to")
        or question.get("target")
        or ""
    )
    target = str(raw_target).upper()

    if target == "BOTH":
        return True

    if party == "RIDER":
        return target in ("RIDER", "RIDER_ADVOCATE")
    # party == "DRIVER"
    return target in ("DRIVER", "DRIVER_ADVOCATE")


# ---------------------------------------------------------------------------
# Allowed outcomes per role (for prompt construction)
# ---------------------------------------------------------------------------


def allowed_outcomes_for_role(party: str, is_claimant: bool) -> list[str]:
    """Return the list of requested_outcome values valid for this role.

    Used by both agent modules to tell the LLM which outcomes it may pick,
    so the model picks a valid value itself.  The rules mirror those in
    sanitize_statement.
    """
    if not is_claimant:
        return ["NO_PENALTY", "CASE_DISMISSED"]
    if party == "RIDER":
        return ["FULL_REFUND", "PARTIAL_REFUND"]
    return ["CLEANING_FEE_CHARGE"]
