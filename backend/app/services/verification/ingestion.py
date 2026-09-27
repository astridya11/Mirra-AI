import json
import os
import re
from typing import Any

_MOCK_DATA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "mock_data")
)

_CASE_ID_PATTERN = re.compile(r"^[A-Z]+-\d{3}$")

# ponytail: explicit allowlist, not a directory scan of mock_data/. Dropping a new
# file into mock_data/ never grants it API access by itself — it must be added
# here too. A user-created Case row sharing an ID with a demo fixture still only
# resolves to that fixture if the ID is in this set; DB existence alone is not
# sufficient (see load_case_data).
_ALLOWED_DEMO_FIXTURES: frozenset[str] = frozenset({"DISP-001", "DISP-002", "DISP-003"})


class FixtureAccessError(Exception):
    """Raised whenever case_id does not resolve to an approved, in-bounds fixture.

    Deliberately does not distinguish "bad format" / "not allowlisted" /
    "path escapes mock_data" / "file missing" in its message — those reasons
    are not exposed to API callers, and no filesystem path is ever included.
    """

    def __init__(self, case_id: str):
        super().__init__(f"No verification fixture available for case_id={case_id!r}")
        self.case_id = case_id


def load_case_data(case_id: str) -> dict[str, Any]:
    if not _CASE_ID_PATTERN.match(case_id) or case_id not in _ALLOWED_DEMO_FIXTURES:
        raise FixtureAccessError(case_id)

    candidate_path = os.path.realpath(os.path.join(_MOCK_DATA_DIR, f"{case_id}.json"))
    if os.path.commonpath([candidate_path, _MOCK_DATA_DIR]) != _MOCK_DATA_DIR:
        # Defense in depth: even an allowlisted, correctly-formatted case_id
        # should never be able to resolve outside mock_data/.
        raise FixtureAccessError(case_id)

    if not os.path.isfile(candidate_path):
        raise FixtureAccessError(case_id)

    with open(candidate_path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_evidence(data: dict[str, Any]) -> dict[str, Any]:
    """Generate stable deterministic reference IDs for evidence lacking them.

    Preserves existing chat message IDs. Keeps a mapping between generated
    reference IDs and original evidence records in _evidence_map.
    """
    normalized: dict[str, Any] = dict(data)
    ds = normalized.setdefault("data_sources", {})

    # GPS telemetry — actual route
    # ponytail: non-dict entries (None, str, ...) are skipped rather than
    # mutated/crashed on. idx is still taken from enumerate() over the
    # original list, so a valid entry's ID is always its own list position
    # (e.g. [valid, None, valid] -> "GPS-000", <skipped>, "GPS-002") — this
    # keeps IDs consistent with backend/shared/evidence_index.py, which
    # numbers by the same raw list position.
    gps = ds.setdefault("gps_telemetry", {})
    actual_route = gps.setdefault("actual_route", [])
    for idx, point in enumerate(actual_route):
        if not isinstance(point, dict):
            continue
        point["evidence_id"] = point.get("evidence_id") or f"GPS-{idx:03d}"

    # GPS telemetry — optimal route
    optimal_route = gps.setdefault("optimal_route", [])
    for idx, point in enumerate(optimal_route):
        if not isinstance(point, dict):
            continue
        point["evidence_id"] = point.get("evidence_id") or f"OPT-{idx:03d}"

    # App events
    app_events = ds.setdefault("app_events", [])
    for idx, event in enumerate(app_events):
        if not isinstance(event, dict):
            continue
        event["evidence_id"] = event.get("evidence_id") or f"EVT-{idx:03d}"

    # Chat transcript (preserve existing IDs, generate only if missing)
    chat = ds.setdefault("chat_communication", {})
    transcript = chat.setdefault("transcript", [])
    for idx, msg in enumerate(transcript):
        if not isinstance(msg, dict):
            continue
        if not msg.get("message_id"):
            msg["message_id"] = f"CHAT-GEN-{idx:03d}"

    # Build evidence map for quick lookup. Non-dict entries were never
    # assigned an ID above, so they are simply absent here — no fabricated
    # evidence is added for them.
    evidence_map: dict[str, Any] = {}
    for point in actual_route:
        if isinstance(point, dict):
            evidence_map[point["evidence_id"]] = point
    for point in optimal_route:
        if isinstance(point, dict):
            evidence_map[point["evidence_id"]] = point
    for event in app_events:
        if isinstance(event, dict):
            evidence_map[event["evidence_id"]] = event
    for msg in transcript:
        if isinstance(msg, dict):
            evidence_map[msg["message_id"]] = msg

    normalized["_evidence_map"] = evidence_map
    return normalized
