"""Backend-owned policy parameter source for deterministic evidence verification.

Policy thresholds (free-wait period, no-show threshold, ...) must never come
from the API caller: either disputing party has a stake in the outcome, so
letting them supply thresholds lets them bias the "eligibility" finding. This
module is the *only* place those numbers may come from.

Ryde's actual cancellation policy has not been documented or handed off by
P1/P2 (see workflow.md: "Ryde Policy RAG integration" is listed as P2 scope,
not yet built). The registry below is intentionally empty rather than
containing invented numbers — get_policy_params() returns None for every
dispute_type until a real policy source exists, and callers must treat that
as "eligibility unresolved," not silently fall back to a guess.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PolicyThresholds:
    free_wait_period_seconds: int
    no_show_threshold_seconds: int
    source: str
    version: str


# ponytail: empty by design — populate per dispute_type only once an authoritative
# Ryde policy document/RAG source exists. Do not hardcode guessed numbers here.
_POLICY_REGISTRY: dict[str, PolicyThresholds] = {}


def get_policy_params(dispute_type: str | None) -> PolicyThresholds | None:
    """Return the trusted policy thresholds for a dispute type, or None if none exist."""
    if not dispute_type:
        return None
    return _POLICY_REGISTRY.get(dispute_type)
