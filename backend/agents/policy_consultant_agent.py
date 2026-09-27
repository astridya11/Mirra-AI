"""
backend/agents/policy_consultant_agent.py - PolicyAgent's consultant entry point.

Implements the POLICY_CONSULTATION phase contract used by
backend/state_machine.py::PipelineEngine._phase_policy_consultation:

    run_policy_consultation(context: dict) -> dict   # schema: PolicySuggestion

`context` is the full accumulated case-state dict produced by
CaseContext.to_context_dict(). This module reads `case_metadata`,
`prosecutor_findings`, `data_sources`, and `bonus_modules` from it.

Design — grounded in ryde_policy_v1.json:
  - Clause retrieval, and the deterministic ground-truth computation for
    POL-2 (Route Deviation), POL-3 (No-Show), POL-4 (Cleaning Fee), and
    POL-5 (Safety) all live in backend/policy/precedent_store.py, sourced
    from ryde_policy_v1.json's actual params (refund formulas, no-show
    conditions, severity caps).
  - Per POL-8 ("a precedent can never override a policy clause"): when
    precedent_store.compute_policy_values() reaches a conclusion, THAT
    IS the suggested ruling — precedents are only consulted (a) to add
    supporting citations to the rationale, or (b) to derive a fallback
    suggestion when the policy computation can't reach a conclusion
    (missing data), in which case the resulting confidence is capped
    lower than a clause-grounded suggestion ever would be.
  - This is also where the "self-learning" behavior lives: as more human
    overrides get recorded via learn_from_human_override(), they become
    approved precedents that (1) show up as matched_precedents/citations
    on every future consultation for that pattern, and (2) can decide the
    suggestion outright on cases the deterministic policy math can't
    resolve — all without touching this file.
  - An LLM (Claude, via the Anthropic SDK) is used only for the
    natural-language `rationale` field, grounded strictly in the
    already-computed clauses/precedents/ruling. Optional: if no API key
    is configured, or the call fails or times out, a deterministic
    templated rationale is used instead so the pipeline never breaks on
    this step.

Schema reference: shared/schemas.json -> $defs.PolicySuggestion,
$defs.PolicyClauseReference, $defs.PrecedentReference,
$defs.RecommendedAction, $defs.PolicyKnowledgeBaseUpdate.
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from backend.policy import precedent_store

# ----------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------

_SGT = timezone(timedelta(hours=8))
_DEFAULT_ACTION: Dict[str, Any] = {"action_type": "ESCALATED_NO_ACTION", "refund_amount": 0, "currency": "SGD"}

# Confidence cap for suggestions derived purely from precedent voting
# (i.e. the deterministic policy computation was inconclusive). Keeps
# precedent-only guesses from ever looking as confident as a clause-
# grounded computation — consistent with POL-8's "a precedent can never
# override a policy clause".
_PRECEDENT_ONLY_CONFIDENCE_CAP = 0.6

_LLM_TIMEOUT_SECONDS = 12
_POLICY_MODEL = os.environ.get("POLICY_AGENT_MODEL", "claude-sonnet-5")

# ----------------------------------------------------------------------
# Optional LLM client (Claude via Anthropic SDK) — fails soft if absent
# ----------------------------------------------------------------------

try:
    from anthropic import AsyncAnthropic  # type: ignore

    _ANTHROPIC_SDK_AVAILABLE = True
except ImportError:
    _ANTHROPIC_SDK_AVAILABLE = False

_anthropic_client: Optional["AsyncAnthropic"] = None
if _ANTHROPIC_SDK_AVAILABLE and os.environ.get("ANTHROPIC_API_KEY"):
    _anthropic_client = AsyncAnthropic()


# ----------------------------------------------------------------------
# Suggested ruling / action derivation
# ----------------------------------------------------------------------


def _vote_from_precedents(precedents: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Any], float]:
    """
    Fallback path, used only when compute_policy_values() couldn't reach a
    conclusion. Weighted vote among matched (already-approved) precedents;
    HUMAN_OVERRIDE-sourced and more-relevant (earlier-ranked) precedents
    count more. Confidence is capped well below what a clause-grounded
    computation would report, since this is a weaker, precedent-only signal.
    """
    if not precedents:
        return "ESCALATED", dict(_DEFAULT_ACTION), 0.3

    votes: Dict[str, float] = {}
    action_by_ruling: Dict[str, Dict[str, Any]] = {}
    for rank, precedent in enumerate(precedents):
        ruling_type = precedent.get("ruling_type", "ESCALATED")
        base_weight = 1.2 if precedent.get("source") == "HUMAN_OVERRIDE" else 1.0
        rank_weight = max(1.0 - (rank * 0.15), 0.1)
        weight = base_weight * rank_weight
        votes[ruling_type] = votes.get(ruling_type, 0.0) + weight
        if rank == 0 or ruling_type not in action_by_ruling:
            action_by_ruling[ruling_type] = precedent.get("recommended_action", _DEFAULT_ACTION)

    winner = max(votes, key=votes.get)
    total = sum(votes.values())
    raw_confidence = votes[winner] / total if total > 0 else 0.3
    confidence = round(min(raw_confidence, _PRECEDENT_ONLY_CONFIDENCE_CAP), 2)

    action = dict(action_by_ruling.get(winner, _DEFAULT_ACTION))
    action.setdefault("refund_amount", 0)
    action.setdefault("currency", "SGD")
    return winner, action, confidence


def _derive_suggestion(
    computed: Dict[str, Any], precedent_records: List[Dict[str, Any]]
) -> Tuple[str, Dict[str, Any], float, str]:
    """
    Returns (ruling_type, action, confidence, basis) where basis is
    "POLICY_CLAUSE" or "PRECEDENT_ONLY" — used by the rationale builders to
    explain which source actually drove the suggestion.
    """
    if computed.get("computable"):
        action = dict(computed.get("action", _DEFAULT_ACTION))
        action.setdefault("refund_amount", 0)
        action.setdefault("currency", "SGD")
        return computed["ruling_type"], action, computed.get("confidence", 0.75), "POLICY_CLAUSE"

    ruling_type, action, confidence = _vote_from_precedents(precedent_records)
    return ruling_type, action, confidence, "PRECEDENT_ONLY"


# ----------------------------------------------------------------------
# Rationale (LLM-enriched, with deterministic fallback)
# ----------------------------------------------------------------------


def _deterministic_rationale(
    dispute_type: str,
    version: str,
    applicable_clauses: List[Dict[str, Any]],
    precedent_records: List[Dict[str, Any]],
    computed: Dict[str, Any],
    suggested_ruling_type: str,
    suggested_action: Dict[str, Any],
    basis: str,
) -> str:
    clause_titles = ", ".join(f"{c['clause_id']} ({c['clause_title']})" for c in applicable_clauses)
    if basis == "POLICY_CLAUSE":
        grounding = (
            f"Grounded directly in {computed.get('clause_id')}: {computed.get('reason', '')}"
        )
    else:
        grounding = (
            f"Policy computation was inconclusive ({computed.get('reason', 'insufficient data')}), "
            "so this suggestion falls back to matched precedent(s) and carries reduced confidence, "
            "consistent with POL-8 (a precedent can never override a policy clause)."
        )

    if precedent_records:
        top = precedent_records[0]
        learned_note = " (a prior human-corrected outcome)" if top.get("source") == "HUMAN_OVERRIDE" else ""
        precedent_note = (
            f" The closest matching precedent, {top['precedent_id']}{learned_note}, "
            f"was ruled {top.get('ruling_type', 'ESCALATED')}."
        )
    else:
        precedent_note = " No matching precedent was found in the knowledge base."

    return (
        f"Policy {version}, {dispute_type} dispute. Clauses considered: {clause_titles}. "
        f"{grounding}.{precedent_note} Suggested ruling: {suggested_ruling_type} "
        f"({suggested_action.get('action_type')})."
    )


async def _llm_rationale(
    dispute_type: str,
    version: str,
    prosecutor_summary: str,
    applicable_clauses: List[Dict[str, Any]],
    precedent_records: List[Dict[str, Any]],
    computed: Dict[str, Any],
    suggested_ruling_type: str,
    suggested_action: Dict[str, Any],
    basis: str,
    fallback: str,
) -> str:
    """
    RAG synthesis step: Claude receives retrieved policy clauses and approved
    precedents plus the deterministic policy result, then writes the rationale.
    It may synthesize/explain the supplied evidence but cannot invent facts,
    clauses, numbers, or override the deterministic policy result. Falls back
    to a deterministic grounded rationale on any error.
    """
    if _anthropic_client is None:
        return fallback

    clause_lines = "\n".join(
        f"- {c['clause_id']} ({c['clause_title']}): {c['clause_text_summary']}" for c in applicable_clauses
    )
    precedent_lines = (
        "\n".join(
            f"- {p['precedent_id']} [{p.get('source', 'SEED')}]: {p.get('similarity_summary', '')} "
            f"(ruled {p.get('ruling_type', 'ESCALATED')})"
            for p in precedent_records
        )
        or "None found."
    )
    basis_note = (
        f"This suggestion is grounded directly in clause {computed.get('clause_id')} "
        f"({computed.get('reason', '')})."
        if basis == "POLICY_CLAUSE"
        else "Policy computation could not reach a conclusion from available case data, "
        "so this suggestion leans on precedent only and should be presented as lower-confidence."
    )

    prompt = (
        "You are the synthesis step of a retrieval-augmented PolicyAgent in the Ryde dispute-resolution pipeline. "
        "Use the retrieved policy clauses and approved precedents as grounding context and write a short "
        "(2-4 sentence) rationale explaining the supplied suggested ruling and action. Use ONLY the facts, "
        "clauses, and precedents given here — do not invent new clause numbers, dollar "
        "amounts, or facts. If a precedent is marked HUMAN_OVERRIDE, you may note that it "
        "reflects a prior human-corrected outcome. Output only the rationale text, no preamble.\n\n"
        f"Policy version: {version}\n"
        f"Dispute type: {dispute_type}\n"
        f"Prosecutor summary: {prosecutor_summary or '(none provided)'}\n"
        f"Applicable clauses:\n{clause_lines}\n\n"
        f"Matched precedents:\n{precedent_lines}\n\n"
        f"{basis_note}\n"
        f"Suggested ruling: {suggested_ruling_type}\n"
        f"Suggested action: {suggested_action}\n"
    )

    try:
        response = await asyncio.wait_for(
            _anthropic_client.messages.create(
                model=_POLICY_MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=_LLM_TIMEOUT_SECONDS,
        )
        text_blocks = [b.text for b in response.content if getattr(b, "type", None) == "text"]
        text = "\n".join(text_blocks).strip()
        return text or fallback
    except Exception:
        # Network error, timeout, malformed response, rate limit, etc. —
        # never let rationale generation break the POLICY_CONSULTATION phase.
        return fallback


# ----------------------------------------------------------------------
# Public API #1 — the contract state_machine.py's lazy import expects
# ----------------------------------------------------------------------


async def run_policy_consultation(context: Dict[str, Any]) -> Dict[str, Any]:
    """
    PolicyAgent's entry point for the POLICY_CONSULTATION phase.

    Input:  the accumulated case context dict (CaseContext.to_context_dict()).
    Output: a PolicySuggestion dict (schema: PolicySuggestion) —
            suggestion_id, applicable_clauses,
            matched_precedents, suggested_ruling_type,
            suggested_recommended_action, policy_confidence, rationale,
            suggested_at.
    """
    now = datetime.now(_SGT).isoformat()
    case_metadata = context.get("case_metadata", {}) or {}
    prosecutor_findings = context.get("prosecutor_findings", {}) or {}

    dispute_type = case_metadata.get("dispute_type", "ROUTE_DEVIATION")
    verified_facts = prosecutor_findings.get("verified_facts", []) or []
    prosecutor_summary = prosecutor_findings.get("prosecutor_summary", "") or ""

    fact_text = " ".join(f.get("description", "") for f in verified_facts)
    keywords = precedent_store.extract_keywords(f"{prosecutor_summary} {fact_text}")
    version = precedent_store.policy_version()

    # -- Clause Retrieval (from ryde_policy_v1.json's dispute_type_clause_map) --
    raw_clauses = precedent_store.retrieve_clauses(dispute_type)
    applicable_clauses = [precedent_store.clause_reference(c, keywords) for c in raw_clauses]

    # -- Precedent Match (approved precedents only, per POL-8) --
    precedent_records = precedent_store.find_precedents(dispute_type, keywords=keywords)
    matched_precedents = [precedent_store.to_precedent_reference(p) for p in precedent_records]

    # -- Suggested Ruling: policy computation first (authoritative per POL-8),
    #    precedent vote only as a fallback when computation is inconclusive --
    computed = precedent_store.compute_policy_values(dispute_type, context)
    suggested_ruling_type, suggested_action, confidence, basis = _derive_suggestion(computed, precedent_records)

    # -- Narration --
    fallback_rationale = _deterministic_rationale(
        dispute_type, version, applicable_clauses, precedent_records, computed,
        suggested_ruling_type, suggested_action, basis,
    )
    rationale = await _llm_rationale(
        dispute_type=dispute_type,
        version=version,
        prosecutor_summary=prosecutor_summary,
        applicable_clauses=applicable_clauses,
        precedent_records=precedent_records,
        computed=computed,
        suggested_ruling_type=suggested_ruling_type,
        suggested_action=suggested_action,
        basis=basis,
        fallback=fallback_rationale,
    )

    return {
        "suggestion_id": f"PSG-{uuid.uuid4().hex[:8].upper()}",
        "applicable_clauses": applicable_clauses,
        "matched_precedents": matched_precedents,
        "suggested_ruling_type": suggested_ruling_type,
        "suggested_recommended_action": suggested_action,
        "policy_confidence": confidence,
        "rationale": rationale,
        "suggested_at": now,
    }


# ----------------------------------------------------------------------
# Public API #2 — self-learning entry point (human-override feedback loop)
# ----------------------------------------------------------------------


def learn_from_human_override(
    *,
    dispute_type: str,
    judge_ruling_type: str,
    judge_recommended_action: Dict[str, Any],
    human_final_action: Dict[str, Any],
    human_ruling_type: Optional[str] = None,
    clauses_flagged: Optional[List[str]] = None,
    mismatch_summary: str = "",
    keywords: Optional[List[str]] = None,
    trigger: str = "OVERRIDDEN",
) -> Dict[str, Any]:
    """
    PolicyAgent's self-learning entry point, per workflow.md's Phase 4
    design notes and POL-8 ("Precedents and Learning Feedback"): call this
    from EXECUTION_ROUTER once a human reviewer's final decision on a
    human-escalated case differs from JudgeVerdict (approval_decision
    MODIFIED / OVERRIDDEN / REJECTED_AUTO).

    Thin wrapper over precedent_store.record_knowledge_base_update: indexes
    the human-corrected outcome as a new precedent (auto-approved and
    citable only for MODIFIED/OVERRIDDEN, per POL-8; REJECTED_AUTO is
    recorded but left unapproved) and returns a schema-shaped
    PolicyKnowledgeBaseUpdate dict (schema: $defs.PolicyKnowledgeBaseUpdate),
    ready to store in self.ctx.policy_kb_update. Do not call this for
    FULLY_AUTOMATED cases or for human reviews that CONFIRMED_AUTO the
    Judge's ruling as-is.
    """
    return precedent_store.record_knowledge_base_update(
        dispute_type=dispute_type,
        judge_ruling_type=judge_ruling_type,
        judge_recommended_action=judge_recommended_action,
        human_final_action=human_final_action,
        human_ruling_type=human_ruling_type,
        clauses_flagged=clauses_flagged,
        mismatch_summary=mismatch_summary,
        keywords=keywords,
        trigger=trigger,
    )


# ----------------------------------------------------------------------
# Local smoke test
# ----------------------------------------------------------------------

if __name__ == "__main__":
    _now_iso = datetime.now(_SGT).isoformat()
    _sample_context = {
        "case_metadata": {"dispute_type": "ROUTE_DEVIATION"},
        "data_sources": {
            "gps_telemetry": {
                "actual_route": [{"latitude": 1.30, "longitude": 103.80, "timestamp": _now_iso}],
                "optimal_route": [{"latitude": 1.30, "longitude": 103.80, "timestamp": _now_iso}],
                "deviation_distance_km": 2.1,
                "trip_duration_seconds": 1800,
                "optimal_duration_seconds": 1200,
                "unexpected_stops": [],
            },
            "payment_fare_data": {
                "original_fare": {"base_fare": 3.0, "distance_fare": 8.0, "time_fare": 2.0, "total_fare": 13.0, "currency": "SGD"},
                "disputed_amount": 2.0,
                "disputed_amount_currency": "SGD",
            },
        },
        "prosecutor_findings": {
            "verified_facts": [{"fact_id": "F-VER-001", "description": "2km unexplained detour with no logged reason."}],
            "disputed_facts": [],
            "missing_facts": [],
            "prosecutor_summary": "Driver took a 2.1km detour with no valid reason recorded.",
            "report_submitted_at": datetime.now(_SGT).isoformat(),
        },
        "bonus_modules": {"image_exif_analyses": [], "fraud_assessment": {}, "escalation_protocol": {}},
        "policy_consultation": {},
    }

    async def _main() -> None:
        result = await run_policy_consultation(_sample_context)
        import json

        print(json.dumps(result, indent=2, ensure_ascii=False))

    asyncio.run(_main())