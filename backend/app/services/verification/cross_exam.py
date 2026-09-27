"""P3 Cross-Examination Review — deterministic response audit against frozen evidence.

This module reviews Round 2 advocate responses against the frozen evidence record.
Party responses are treated as claims, not verified evidence.

No raw response text is ever copied into the ProsecutorReport.
"""

from __future__ import annotations

import re
from typing import Any

from backend.shared.evidence_index import build_evidence_index

# ---------------------------------------------------------------------------
# Evidence-ID extraction helpers
# ---------------------------------------------------------------------------

_EVIDENCE_ID_LIKE_RE = re.compile(
    r"^(?:[A-Z]{2,6}-\d{3,4}|CHAT-GEN-\d{3}|TRIP-DATA|PAYMENT-DATA|ROUTE-SUMMARY|PROFILE-[A-Z]+)$"
)


def _tokenize_for_evidence_ids(text: str) -> list[str]:
    """Split text into candidate tokens, preserving hyphens/underscores in IDs."""
    # Replace any character that is NOT alphanumeric, hyphen, or underscore with space
    normalized = "".join(c if c.isalnum() or c in "-_" else " " for c in text)
    return normalized.split()


def _extract_evidence_references(
    text: str, valid_ids: set[str]
) -> tuple[set[str], set[str]]:
    """Scan response text for evidence-ID references.

    Returns (resolved_ids, unknown_ids_like).

    - resolved_ids: IDs that exist in the frozen evidence index.
    - unknown_ids_like: strings that look like evidence IDs but are NOT in the index.

    Substring false positives are avoided by tokenizing first.
    """
    if not isinstance(text, str) or not text.strip():
        return set(), set()

    tokens = _tokenize_for_evidence_ids(text)
    resolved: set[str] = set()
    unknown: set[str] = set()

    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        if token in valid_ids:
            resolved.add(token)
        elif _EVIDENCE_ID_LIKE_RE.match(token):
            unknown.add(token)

    return resolved, unknown


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def review_cross_exam(
    context: dict[str, Any],
    prosecutor_report: dict[str, Any],
) -> dict[str, Any]:
    """Review Round 2 cross-examination responses against frozen evidence.

    Args:
        context: Normalized orchestrator context containing at minimum
            ``data_sources`` and optionally ``round_2_cross_exam``.
        prosecutor_report: The existing ProsecutorReport dict (read-only).

    Returns:
        A deterministic, JSON-safe dict describing the review outcome.
        No raw response text is included.
    """
    # ------------------------------------------------------------------
    # 1. Read Round 2 content safely
    # ------------------------------------------------------------------
    r2 = context.get("round_2_cross_exam", {})
    if not isinstance(r2, dict):
        r2 = {}

    questions = r2.get("targeted_questions", [])
    responses = r2.get("targeted_responses", [])
    if not isinstance(questions, list):
        questions = []
    if not isinstance(responses, list):
        responses = []

    # ------------------------------------------------------------------
    # 2. Build frozen evidence index
    # ------------------------------------------------------------------
    data_sources = context.get("data_sources", {})
    if not isinstance(data_sources, dict):
        data_sources = {}

    evidence_index = build_evidence_index(data_sources)
    valid_ids = set(evidence_index.keys())

    # ------------------------------------------------------------------
    # 3. Map questions by question_id
    # ------------------------------------------------------------------
    question_map: dict[str, dict[str, Any]] = {}
    for q in questions:
        if isinstance(q, dict):
            qid = q.get("question_id")
            if isinstance(qid, str) and qid:
                question_map[qid] = q

    # ------------------------------------------------------------------
    # 4. Review each response
    # ------------------------------------------------------------------
    reviewed_responses: list[dict[str, Any]] = []
    resolved_ids: set[str] = set()
    unknown_ids: set[str] = set()
    unmatched_count = 0
    malformed_count = 0

    for resp in responses:
        if not isinstance(resp, dict):
            malformed_count += 1
            continue

        resp_qid = resp.get("question_id")
        party = resp.get("responding_party", "unknown")
        text = resp.get("response_text", "")

        if not isinstance(resp_qid, str) or resp_qid not in question_map:
            unmatched_count += 1
            continue

        found_resolved, found_unknown = _extract_evidence_references(text, valid_ids)
        resolved_ids.update(found_resolved)
        unknown_ids.update(found_unknown)

        reviewed_responses.append(
            {
                "question_id": resp_qid,
                "responding_party": party,
                "has_resolved_evidence": len(found_resolved) > 0,
                "resolved_count": len(found_resolved),
            }
        )

    # ------------------------------------------------------------------
    # 5. Build deterministic review result
    # ------------------------------------------------------------------
    with_evidence = sum(1 for r in reviewed_responses if r["has_resolved_evidence"])
    without_evidence = len(reviewed_responses) - with_evidence

    result: dict[str, Any] = {
        "questions_seen": len(questions),
        "responses_reviewed": len(reviewed_responses),
        "responses_with_resolved_evidence": with_evidence,
        "responses_without_resolved_evidence": without_evidence,
        "resolved_evidence_ids": sorted(resolved_ids),
        "unknown_evidence_ids": sorted(unknown_ids),
        "unmatched_response_count": unmatched_count,
        "malformed_response_count": malformed_count,
    }

    return result


def build_cross_exam_summary(review: dict[str, Any]) -> str:
    """Build a deterministic, safe summary paragraph from a review result.

    No raw response text is included.
    """
    parts: list[str] = [
        f"Cross-examination review completed. {review['responses_reviewed']} advocate "
        f"response(s) were reviewed against the frozen evidence record. "
        f"{len(review['resolved_evidence_ids'])} valid frozen evidence reference(s) "
        f"were resolved. {review['responses_without_resolved_evidence']} response(s) "
        f"contained no resolvable frozen evidence reference. "
        "Party responses were treated as unverified claims and did not create or modify verified facts."
    ]

    if review["unknown_evidence_ids"]:
        parts.append(
            f"Unresolved evidence-like references detected: {', '.join(review['unknown_evidence_ids'])}."
        )

    if review["unmatched_response_count"]:
        parts.append(
            f"{review['unmatched_response_count']} response(s) referenced unknown question IDs."
        )

    if review["malformed_response_count"]:
        parts.append(
            f"{review['malformed_response_count']} malformed response entry(ies) were skipped."
        )

    return " ".join(parts)
