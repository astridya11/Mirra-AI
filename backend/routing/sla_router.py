"""
Priority & SLA manager (single-reviewer demo version).

- Reads escalated cases from backend/escalated/*.json (read-only)
- Keeps SLA clocks + resolved flags in backend/routing/routing_state.json
- The one human support always sees one queue,
  ranked by urgency (priority tier + SLA pressure) and dispute value.
- URGENT cases (safety threat / HIGH fraud risk) are a strict fast-track lane:
  they always rank above every other case.
"""
import hashlib
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

BASE_DIR = Path(__file__).resolve().parent.parent
ESCALATED_DIR = BASE_DIR / "escalated"
STATE_FILE = BASE_DIR / "routing" / "routing_state.json"

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
# Mock human support
MOCK_SUPPORT = {"id": "support-demo", "name": "Alex Chen"}

# SLA window per priority tier, in minutes. SLA_SCALE=0.1 shrinks them for demos.
SLA_MINUTES = {"URGENT": 5, "HIGH_PRIORITY": 15, "STANDARD": 60}
SLA_SCALE = float(os.getenv("SLA_SCALE", "1"))

# "first_seen": SLA clock starts when the router first sees the case (demo friendly,
#               because sample escalated_at timestamps are old).
# "escalated_at": SLA clock starts at the escalated_at field (use for real).
SLA_CLOCK = os.getenv("SLA_CLOCK", "first_seen")

# Ranking score = tier weight + SLA pressure points + value points.
# Tier weights are 100 apart and the other two parts add at most 50,
# so a lower tier can never outrank a higher one (URGENT is a strict fast-track).
TIER_WEIGHT = {"URGENT": 200, "HIGH_PRIORITY": 100, "STANDARD": 0}
SLA_POINTS = 20       # grows from 0 -> 20 as the SLA window is used up
VALUE_POINTS = 30     # grows from 0 -> 30 as dispute value approaches VALUE_CAP
VALUE_CAP = 500.0

# Where to read the dispute value from the escalated JSON (first positive number wins).
VALUE_FIELDS = ["dispute_value", "amount_at_stake", "refund_amount",
                "cleaning_fee_amount", "fare_amount", "trip_fare"]

AT_RISK_RATIO = 0.3   # <30% of SLA window left -> AT_RISK

_lock = threading.RLock()
router = APIRouter(prefix="/api/review", tags=["review-routing"])


# ----------------------------------------------------------------------------
# Storage
# ----------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"cases": {}}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


def _load_escalated() -> dict:
    cases = {}
    for path in ESCALATED_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text("utf-8"))
            cases[data["case_id"]] = data
        except (json.JSONDecodeError, KeyError):
            continue
    return cases


# ----------------------------------------------------------------------------
# Priority logic
# ----------------------------------------------------------------------------
def _tier(case: dict) -> str:
    p = case.get("priority_level")
    return p if p in TIER_WEIGHT else "STANDARD"


def _dispute_value(case: dict) -> tuple:
    """Returns (value, source). Falls back to a stable mock value so the demo
    still shows value-based ranking if the JSON has no amount yet."""
    for key in VALUE_FIELDS:
        v = case.get(key)
        if isinstance(v, (int, float)) and v > 0:
            return float(v), key
    digest = int(hashlib.md5(case["case_id"].encode()).hexdigest()[:6], 16)
    return float(20 + (digest % 48) * 10), "mock"   # 20 .. 490


def _new_record(case: dict, now: datetime) -> dict:
    total = SLA_MINUTES[_tier(case)] * 60 * SLA_SCALE
    start = (datetime.fromisoformat(case["escalated_at"])
             if SLA_CLOCK == "escalated_at" else now)
    return {
        "first_seen": now.isoformat(),
        "sla_total_seconds": total,
        "sla_deadline": (start + timedelta(seconds=total)).astimezone(timezone.utc).isoformat(),
        "status": "OPEN",          # OPEN | RESOLVED
        "resolved_by": None,
        "resolved_at": None,
    }


def _register(state: dict, cases: dict) -> None:
    now = _now()
    for cid, case in cases.items():
        if cid not in state["cases"]:
            state["cases"][cid] = _new_record(case, now)


def _sla(rec: dict, now: datetime) -> tuple:
    """Returns (sla_status, seconds_remaining)."""
    if rec["status"] == "RESOLVED":
        return "RESOLVED", 0
    remaining = (datetime.fromisoformat(rec["sla_deadline"]) - now).total_seconds()
    if remaining <= 0:
        return "BREACHED", int(remaining)
    if remaining / max(rec["sla_total_seconds"], 1) <= AT_RISK_RATIO:
        return "AT_RISK", int(remaining)
    return "ON_TRACK", int(remaining)


def _score(case: dict, rec: dict, now: datetime) -> float:
    value, _ = _dispute_value(case)
    remaining = (datetime.fromisoformat(rec["sla_deadline"]) - now).total_seconds()
    used = 1 - max(0.0, min(remaining / max(rec["sla_total_seconds"], 1), 1.0))
    return round(TIER_WEIGHT[_tier(case)]
                 + used * SLA_POINTS
                 + min(value / VALUE_CAP, 1.0) * VALUE_POINTS, 1)


def _case_view(case: dict, rec: dict, now: datetime) -> dict:
    value, source = _dispute_value(case)
    sla_status, remaining = _sla(rec, now)
    return {
        **case,
        "priority_level": _tier(case),
        "dispute_value": value,
        "value_source": source,
        "priority_score": _score(case, rec, now),
        "status": rec["status"],
        "sla_deadline": rec["sla_deadline"],
        "sla_total_seconds": rec["sla_total_seconds"],
        "sla_status": sla_status,
        "seconds_remaining": remaining,
        "resolved_by": rec["resolved_by"],
        "resolved_at": rec["resolved_at"],
    }


def _ranked_views(state: dict, cases: dict) -> list:
    now = _now()
    views = [_case_view(cases[cid], rec, now)
             for cid, rec in state["cases"].items() if cid in cases]
    open_cases = sorted((v for v in views if v["status"] == "OPEN"),
                        key=lambda v: -v["priority_score"])
    done = sorted((v for v in views if v["status"] == "RESOLVED"),
                  key=lambda v: v["resolved_at"] or "", reverse=True)
    return open_cases + done


def _next_open_id(views: list, exclude: Optional[str] = None) -> Optional[str]:
    for v in views:
        if v["status"] == "OPEN" and v["case_id"] != exclude:
            return v["case_id"]
    return None


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------
@router.get("/queue")
def get_queue():
    """All cases, open ones ranked by priority score (highest first)."""
    with _lock:
        state, cases = _load_state(), _load_escalated()
        _register(state, cases)
        _save_state(state)
        return {"server_time": _now().isoformat(),
                "support": MOCK_SUPPORT,
                "cases": _ranked_views(state, cases)}


@router.get("/next")
def get_next_case():
    """The single highest-priority open case (for a 'Start next case' button)."""
    with _lock:
        state, cases = _load_state(), _load_escalated()
        _register(state, cases)
        _save_state(state)
        return {"case_id": _next_open_id(_ranked_views(state, cases))}


@router.get("/cases/{case_id}")
def get_case(case_id: str):
    with _lock:
        state, cases = _load_state(), _load_escalated()
        if case_id not in cases:
            raise HTTPException(404, "Case not found")
        _register(state, cases)
        _save_state(state)
        return {**_case_view(cases[case_id], state["cases"][case_id], _now()),
                "support": MOCK_SUPPORT}


@router.post("/cases/{case_id}/resolve")
def resolve_case(case_id: str):
    """Marks the case reviewed and tells the UI which case to open next."""
    with _lock:
        state, cases = _load_state(), _load_escalated()
        if case_id not in cases:
            raise HTTPException(404, "Case not found")
        _register(state, cases)
        rec = state["cases"][case_id]
        if rec["status"] != "RESOLVED":
            rec["status"] = "RESOLVED"
            rec["resolved_by"] = MOCK_SUPPORT["name"]
            rec["resolved_at"] = _now().isoformat()
        _save_state(state)
        return {"case": _case_view(cases[case_id], rec, _now()),
                "next_case_id": _next_open_id(_ranked_views(state, cases), exclude=case_id)}


@router.post("/demo/reset")
def reset_demo():
    """Clear SLA clocks and resolved flags so the demo can be replayed."""
    with _lock:
        _save_state({"cases": {}})
        return {"ok": True}