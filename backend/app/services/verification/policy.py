"""Backend-owned policy parameter source for deterministic evidence verification.

Policy thresholds (free-wait period, no-show threshold, ...) must never come
from the API caller: either disputing party has a stake in the outcome, so
letting them supply thresholds lets them bias the "eligibility" finding. This
module is the *only* place those numbers may come from.

The registry is loaded from ``backend/policy/ryde_policy_v1.json`` — a
backend-owned file that is never caller-supplied, so the original trust rule
still holds.  The JSON file is read once and cached via ``functools.lru_cache``.
"""

import functools
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PolicyThresholds:
    free_wait_period_seconds: int
    no_show_threshold_seconds: int
    source: str
    version: str


# Path to the backend-owned policy file (relative to this module).
_POLICY_FILE = Path(__file__).resolve().parent.parent.parent.parent / "policy" / "ryde_policy_v1.json"


@functools.lru_cache(maxsize=1)
def _load_policy_file() -> dict | None:
    """Load and cache the policy JSON file.  Returns None if missing or malformed."""
    try:
        with open(_POLICY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        return None


def get_policy_clause(dispute_type: str | None) -> dict | None:
    """Return the primary policy clause for a dispute type, or None.

    Looks up the clause IDs for *dispute_type* in the file's
    ``dispute_type_clause_map`` and returns the first clause whose
    ``applies_to`` list explicitly contains *dispute_type* (clauses that
    only apply to ``"ALL"`` are general and are skipped).

    Returns ``{"clause_id", "title", "params", "policy_version"}`` or
    ``None`` if the file, the map entry, or a matching clause is missing
    or malformed.  Never raises.
    """
    if not dispute_type:
        return None

    data = _load_policy_file()
    if data is None:
        return None

    clause_map = data.get("dispute_type_clause_map")
    if not isinstance(clause_map, dict):
        return None

    clause_ids = clause_map.get(dispute_type)
    if not isinstance(clause_ids, list):
        return None

    clauses = data.get("clauses")
    if not isinstance(clauses, dict):
        return None

    policy_version = data.get("policy_version", "")

    for cid in clause_ids:
        clause = clauses.get(cid)
        if not isinstance(clause, dict):
            continue
        applies_to = clause.get("applies_to")
        if not isinstance(applies_to, list):
            continue
        if dispute_type in applies_to:
            return {
                "clause_id": cid,
                "title": clause.get("title", ""),
                "params": clause.get("params", {}),
                "policy_version": policy_version,
            }

    return None


def get_policy_params(dispute_type: str | None) -> PolicyThresholds | None:
    """Return the trusted policy thresholds for a dispute type, or None if none exist."""
    clause = get_policy_clause(dispute_type)
    if clause is None:
        return None

    params = clause.get("params")
    if not isinstance(params, dict):
        return None

    free_wait = params.get("free_wait_time_min")
    no_show = params.get("no_show_threshold_min")

    if not isinstance(free_wait, (int, float)) or not isinstance(no_show, (int, float)):
        return None

    clause_id = clause.get("clause_id", "")
    policy_version = clause.get("policy_version", "")
    # Strip a leading "v" from the version (e.g. "v1" -> "1").
    version = policy_version[1:] if policy_version.startswith("v") else policy_version

    return PolicyThresholds(
        free_wait_period_seconds=int(free_wait * 60),
        no_show_threshold_seconds=int(no_show * 60),
        source=f"ryde_policy_v1.json {clause_id}",
        version=version,
    )
