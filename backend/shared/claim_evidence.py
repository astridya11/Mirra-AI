"""Build the agent-facing view of claim evidence.

Evidence (``image_evidence``, ``receipt_evidence``) is stored in
``dispute_claim`` per the case schema.  Pipeline readers (image analysis,
cleaning-fee checks, prosecutor, precedent store, evidence index) all read
from ``data_sources``.  This function bridges that gap by returning a
shallow copy of ``data_sources`` with the two evidence keys injected from
``dispute_claim`` when they are present and non-empty.

The returned dict is an **agent view only** — it must never be persisted.
"""

from __future__ import annotations

from typing import Any, Dict


def merge_claim_evidence(
    data_sources: dict | None,
    dispute_claim: dict | None,
) -> Dict[str, Any]:
    """Return a new dict: shallow copy of *data_sources* with claim evidence.

    For each key in ``("image_evidence", "receipt_evidence")``: if
    *dispute_claim* has a non-empty list for that key, set it in the copy;
    otherwise keep whatever *data_sources* already has.

    ``None`` / non-dict inputs are treated as ``{}``.  Inputs are never
    mutated.
    """
    if not isinstance(data_sources, dict):
        data_sources = {}
    if not isinstance(dispute_claim, dict):
        dispute_claim = {}

    merged = dict(data_sources)

    for key in ("image_evidence", "receipt_evidence"):
        claim_value = dispute_claim.get(key)
        if isinstance(claim_value, list) and claim_value:
            merged[key] = claim_value

    return merged
