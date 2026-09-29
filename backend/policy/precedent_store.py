"""
backend/policy/precedent_store.py - PolicyAgent's own knowledge base.

Two parts, matching workflow.md's Phase 4 (Policy Consultation):

  1. Clause library: loaded from ryde_policy_v1.json (POLICY_FILE_PATH env
     var, default alongside this module). This is the real Ryde policy
     document — POL-1..POL-9, each with `applies_to`, `text`, and a
     `params` block with the actual computable rules (refund formulas,
     no-show conditions, cleaning-fee severity caps, execution-gate
     thresholds, etc.), plus a `dispute_type_clause_map`. Legal text
     doesn't change from case outcomes, so this is loaded read-only; no
     hardcoded clause library lives in Python anymore.

  2. Precedent store (growable case-outcome history): starts from a
     small seed set and GROWS every time a human reviewer overrides
     JudgeVerdict during ESCALATED_HUMAN_REVIEW. Per POL-8 ("Precedents
     and Learning Feedback"):
       - a precedent is only created from a human MODIFIED or OVERRIDDEN
         decision with a reason (POL-8.params.precedent_created_from,
         override_reason_required) — NOT from REJECTED_AUTO, which this
         store records for audit purposes but keeps unapproved/uncitable;
       - "a candidate becomes citable only after approval"
         (only_approved_precedents_citable) — find_precedents() only
         returns approved=True records;
       - "a precedent can never override a policy clause"
         (precedent_can_override_policy) — enforced in
         policy_consultant_agent.py's suggestion logic, not here: when
         compute_policy_values() is computable, its result wins outright;
         precedents only fill in when the policy computation can't reach
         a conclusion, or add citations/color to the rationale.

Persistence: precedents are persisted to a JSON file (POLICY_KB_PATH env
var, default alongside this module) so learning survives process
restarts. PolicyAgent owns its own knowledge base.

Schema reference: shared/schemas.json -> $defs.PolicyClauseReference,
$defs.PrecedentReference, $defs.PolicyKnowledgeBaseUpdate, $defs.RecommendedAction.
"""

import json
import math
import os
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

_SGT = timezone(timedelta(hours=8))

_DEFAULT_POLICY_PATH = os.path.join(os.path.dirname(__file__), "ryde_policy_v1.json")
_POLICY_PATH = os.environ.get("POLICY_FILE_PATH", _DEFAULT_POLICY_PATH)

_DEFAULT_KB_PATH = os.path.join(os.path.dirname(__file__), "policy_knowledge_base.json")
_KB_PATH = os.environ.get("POLICY_KB_PATH", _DEFAULT_KB_PATH)

_RULING_TYPES = ("APPROVED", "PARTIAL_REFUND", "REJECTED", "ESCALATED")
_PRECEDENT_CREATING_TRIGGERS = ("MODIFIED", "OVERRIDDEN")  # POL-8.params.precedent_created_from

_lock = threading.RLock()
_policy: Optional[Dict[str, Any]] = None  # lazy-loaded cache of ryde_policy_v1.json
_kb_state: Optional[Dict[str, Any]] = None  # lazy-loaded cache: {"precedents": [...]}


# ------------------------------------------------------------------
# Clause library — loaded from ryde_policy_v1.json
# ------------------------------------------------------------------


def _load_policy() -> Dict[str, Any]:
    global _policy
    with _lock:
        if _policy is None:
            with open(_POLICY_PATH, "r", encoding="utf-8") as f:
                _policy = json.load(f)
        return _policy


def policy_version() -> str:
    """e.g. 'v1'. Cited in rationale so every suggestion is traceable to a policy version (POL-1)."""
    return _load_policy().get("policy_version", "unknown")


def retrieve_clauses(dispute_type: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Return the clauses mapped to dispute_type via dispute_type_clause_map,
    in the order the policy lists them. Falls back to POL-1 (General
    Principles) alone if dispute_type isn't in the map at all, so callers
    always get at least one citable clause (schema requires >=1).
    """
    policy = _load_policy()
    clause_ids = policy.get("dispute_type_clause_map", {}).get(dispute_type)
    if not clause_ids:
        clause_ids = ["POL-1"]
    clauses = []
    for cid in clause_ids:
        raw = policy["clauses"].get(cid)
        if raw is None:
            continue
        clauses.append({**raw, "clause_id": cid})
    if top_k is not None:
        clauses = clauses[:top_k]
    return clauses


def clause_reference(clause: Dict[str, Any], keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """Project a raw policy clause down to schema PolicyClauseReference fields."""
    keywords = keywords or []
    overlap = sorted(set(k.lower() for k in clause.get("keywords", [])) & set(k.lower() for k in keywords))
    relevance = f"Applies to {', '.join(clause.get('applies_to', []))} disputes" + (
        f"; keyword overlap: {', '.join(overlap)}." if overlap else "."
    )
    return {
        "clause_id": clause["clause_id"],
        "clause_title": clause.get("title", clause["clause_id"]),
        "clause_text_summary": (clause.get("text", "") or "")[:600],
        "relevance_summary": relevance,
    }


# ------------------------------------------------------------------
# Deterministic policy computation (POL-2 / POL-3 / POL-4 / POL-5)
#
# This is the ground-truth math: when it reaches a conclusion
# ("computable": True), that conclusion is authoritative per POL-8
# ("a precedent can never override a policy clause") — precedents are
# only used when this returns "computable": False.
# ------------------------------------------------------------------


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _parse_dt(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _fact_text(context: Dict[str, Any]) -> str:
    findings = context.get("prosecutor_findings", {}) or {}
    parts = [findings.get("prosecutor_summary", "") or ""]
    for f in findings.get("verified_facts", []) or []:
        parts.append(f.get("description", "") or "")
    return " ".join(parts).lower()


def _compute_route_deviation(clause: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """POL-2: Route Deviation and Fare Adjustment."""
    params = clause.get("params", {})
    ds = context.get("data_sources", {}) or {}
    gps = ds.get("gps_telemetry") or {}
    fare = (ds.get("payment_fare_data") or {}).get("original_fare") or {}

    if not gps or "deviation_distance_km" not in gps:
        return {"computable": False, "reason": "gps_telemetry.deviation_distance_km not available"}

    deviation_km = gps.get("deviation_distance_km")
    if not isinstance(deviation_km, (int, float)) or deviation_km < 0:
        return {"computable": False, "reason": "gps_telemetry.deviation_distance_km is invalid"}

    trigger = params.get("review_trigger", {})
    min_deviation_km = trigger.get("min_deviation_km", 1.0)
    min_extra_time_pct = trigger.get("min_extra_time_pct", 10)

    trip_seconds = gps.get("trip_duration_seconds")
    optimal_seconds = gps.get("optimal_duration_seconds")
    extra_time_pct = None
    if trip_seconds is not None and optimal_seconds is not None:
        if not isinstance(trip_seconds, (int, float)) or not isinstance(optimal_seconds, (int, float)) or optimal_seconds <= 0:
            return {"computable": False, "reason": "trip/optimal duration values are invalid"}
        extra_time_pct = ((trip_seconds - optimal_seconds) / optimal_seconds) * 100

    triggered = deviation_km > min_deviation_km or (
        extra_time_pct is not None and extra_time_pct > min_extra_time_pct
    )
    if not triggered:
        currency = fare.get("currency", "SGD")
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "currency": currency},
            "reason": f"Deviation {deviation_km}km / {extra_time_pct}% extra time did not meet review thresholds.",
            "confidence": 0.85,
        }

    # POL-2 requires an evidenced valid reason to avoid the refund. Prefer
    # structured reason codes when supplied; otherwise use the verified fact
    # text already produced by the prosecutor.
    text = _fact_text(context)
    reason_codes = []
    for source in (gps, ds.get("trip_data") or {}):
        codes = source.get("reason_codes", []) or []
        if isinstance(codes, str):
            codes = [codes]
        reason_codes.extend(str(c).upper() for c in codes)
    valid_codes = {
        "VERIFIED_ROAD_CLOSURE",
        "VERIFIED_ACCIDENT_OR_INCIDENT",
        "RIDER_REQUESTED_ROUTE_CHANGE",
        "RIDER_REQUESTED_STOP",
    }
    invalid_codes = {
        "NAVIGATION_APP_REROUTE_WITHOUT_CAUSE",
        "DRIVER_PREFERENCE",
        "UNEXPLAINED",
    }
    valid_hits = [w for w in ("road closure", "accident", "incident", "rider requested") if w in text]
    invalid_hits = [w for w in ("navigation app", "reroute", "driver preference", "unexplained") if w in text]
    stop_explained = any(
        s.get("explanation_provided") and not s.get("deviation_flagged")
        for s in gps.get("unexpected_stops", []) or []
    )
    has_valid_reason = bool(valid_codes.intersection(reason_codes) or valid_hits or stop_explained)
    has_invalid_reason = bool(invalid_codes.intersection(reason_codes) or invalid_hits)

    if has_valid_reason and not has_invalid_reason:
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "currency": fare.get("currency", "SGD")},
            "reason": "A valid, evidenced reason for the deviation was found.",
            "confidence": 0.75 if reason_codes else 0.7,
        }

    # The refund formula includes extra minutes. Once a review is triggered,
    # missing duration data means the full policy formula cannot be computed
    # faithfully; do not silently treat missing time as zero.
    if trip_seconds is None or optimal_seconds is None:
        return {
            "computable": False,
            "reason": "POL-2 refund formula requires trip_duration_seconds and optimal_duration_seconds once a review is triggered",
        }

    total_fare = fare.get("total_fare")
    if total_fare is None or not isinstance(total_fare, (int, float)) or total_fare < 0:
        return {
            "computable": False,
            "reason": "POL-2 refund_cap=total_fare requires a valid payment_fare_data.original_fare.total_fare",
        }

    rate_per_km = params.get("rate_per_km", 0.5)
    rate_per_minute = params.get("rate_per_minute", 0.3)
    extra_minutes = max((trip_seconds - optimal_seconds) / 60, 0)
    refund_raw = deviation_km * rate_per_km + extra_minutes * rate_per_minute
    refund = round(min(refund_raw, total_fare), 2)
    currency = fare.get("currency", "SGD")

    if refund <= 0:
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "currency": currency},
            "reason": "Computed refund rounded to 0.",
            "confidence": 0.8,
        }
    action_type = "FULL_REFUND" if refund >= total_fare else "PARTIAL_REFUND"
    return {
        "computable": True,
        "ruling_type": "APPROVED",
        "action": {"action_type": action_type, "refund_amount": refund, "currency": currency},
        "reason": f"No valid reason found; refund = {deviation_km}km * {rate_per_km} + {extra_minutes:.1f}min * {rate_per_minute}, capped at total fare.",
        "confidence": 0.85,
    }


def _event_time(event: Dict[str, Any]):
    return _parse_dt(event.get("timestamp") or event.get("created_at") or event.get("time"))


def _compute_no_show(clause: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """POL-3: No-Show Cancellation Charge; unknown evidence never becomes a failed condition."""
    params = clause.get("params", {})
    ds = context.get("data_sources", {}) or {}
    trip = ds.get("trip_data") or {}
    gps = ds.get("gps_telemetry") or {}
    arrival_t = _parse_dt(trip.get("driver_arrival_time"))
    cancel_t = _parse_dt(trip.get("cancellation_time"))
    pickup = trip.get("pickup_location")
    if not arrival_t or not cancel_t or not pickup:
        return {"computable": False, "reason": "arrival/cancellation timestamps or pickup_location not available"}
    if cancel_t < arrival_t:
        return {"computable": True, "ruling_type": "APPROVED", "action": {"action_type": "FULL_REFUND", "refund_amount": params.get("cancellation_fee", 5.0), "currency": "SGD"}, "reason": "Cancellation occurred before driver arrival, so the no-show threshold was not met.", "confidence": 0.9}

    radius_m = params.get("arrival_radius_m", 50)
    route = gps.get("actual_route", []) or []
    conditions: Dict[str, Optional[bool]] = {}

    # (a) driver within arrival radius at arrival time, and
    # (b) stayed within radius until cancellation (checked over the same window)
    window_points = [
        (t, p) for p in route
        if (t := _parse_dt(p.get("timestamp"))) 
        and arrival_t <= t <= cancel_t 
        and all(k in p for k in ("latitude", "longitude"))
    ]
    if window_points:
        window_points.sort(key=lambda x: x[0])
        distances = [_haversine_m(p["latitude"], p["longitude"], pickup["lat"], pickup["lng"]) for _, p in window_points]
        conditions["DRIVER_WITHIN_ARRIVAL_RADIUS"] = distances[0] <= radius_m
        conditions["DRIVER_STATIONARY_UNTIL_CANCELLATION"] = all(d <= radius_m for d in distances)
    else:
        conditions["DRIVER_WITHIN_ARRIVAL_RADIUS"] = None
        conditions["DRIVER_STATIONARY_UNTIL_CANCELLATION"] = None

    # (c) rider notified of arrival — heuristic: matching app_event
    app_events = ds.get("app_events", []) or []
    arrival_events = []
    for e in app_events:
        t = _event_time(e)
        text = f"{e.get('event_type', '')} {e.get('details', '')}".lower()
        if t and arrival_t <= t <= cancel_t and "arriv" in text:
            arrival_events.append(e)
    conditions["RIDER_NOTIFIED_OF_ARRIVAL"] = bool(arrival_events) or None


    # (d) driver made contact attempt — heuristic: driver chat message or a "call"/"contact" app_event before cancellation
    chat = ((ds.get("chat_communication") or {}).get("transcript", []) or [])
    driver_messages = []
    for m in chat:
        t = _event_time(m)
        if t and arrival_t <= t <= cancel_t and str(m.get("sender", "")).upper() == "DRIVER":
            driver_messages.append(m)
    contact_events = []
    for e in app_events:
        t = _event_time(e)
        event_type = str(e.get("event_type", "")).lower()
        if t and arrival_t <= t <= cancel_t and ("call" in event_type or "contact" in event_type):
            contact_events.append(e)
    conditions["DRIVER_CONTACT_ATTEMPTED"] = bool(driver_messages or contact_events) or None

    # (e) cancelled at/after the no-show threshold
    threshold_min = params.get("no_show_threshold_min", 8)
    elapsed_min = (cancel_t - arrival_t).total_seconds() / 60
    conditions["CANCELLED_AT_OR_AFTER_THRESHOLD"] = elapsed_min >= threshold_min

    unknown = [k for k, v in conditions.items() if v is None]
    failed = [k for k, v in conditions.items() if v is False]
    currency = "SGD"
    fee = params.get("cancellation_fee", trip.get("cancellation_fee", 5.0))

    # POL-3 says all required conditions must be satisfied. Unknown evidence
    # therefore prevents an automated fee/refund ruling rather than being
    # treated as a failed condition.
    if unknown:
        return {
            "computable": False,
            "reason": f"Unable to verify required POL-3 condition(s): {', '.join(unknown)}",
            "conditions": conditions,
        }
    if failed:
        return {
            "computable": True,
            "ruling_type": "APPROVED",
            "action": {"action_type": "FULL_REFUND", "refund_amount": fee, "currency": currency},
            "reason": f"No-show fee conditions failed: {', '.join(failed)}. Fee reversed.",
            "confidence": 0.9,
            "conditions": conditions,
        }
    return {
        "computable": True,
        "ruling_type": "REJECTED",
        "action": {"action_type": "NO_REFUND", "refund_amount": 0, "currency": currency},
        "reason": f"All required POL-3 conditions verified and cancellation occurred after the {threshold_min}-minute threshold. Fee upheld.",
        "confidence": 0.9,
        "conditions": conditions,
    }


def _compute_cleaning_fee(clause: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """POL-4: enforce evidence prerequisites; human confirmation remains mandatory."""
    params = clause.get("params", {})
    ds = context.get("data_sources", {}) or {}
    bonus = context.get("bonus_modules", {}) or {}
    analyses = bonus.get("image_exif_analyses", []) or []
    claim = ds.get("cleaning_claim") or bonus.get("cleaning_claim") or {}
    if not analyses:
        return {"computable": False, "reason": "no image_exif_analyses submitted"}

    trip = ds.get("trip_data") or {}
    trip_end = _parse_dt(trip.get("trip_end_time") or trip.get("dropoff_time"))
    dropoff = trip.get("dropoff_location") or trip.get("destination_location")
    claim_filed = _parse_dt(claim.get("claim_filed_at") or claim.get("filed_at"))

    if params.get("receipt_required", True):
        receipt_present = claim.get("receipt_present")
        if receipt_present is None:
            receipt_present = bool(claim.get("receipt") or claim.get("receipt_id") or ds.get("cleaning_receipt"))
        if not receipt_present:
            return {"computable": False, "reason": "POL-4 requires a cleaning receipt"}

    filing_window_hours = params.get("claim_filing_window_hours")
    if filing_window_hours is not None:
        if not trip_end or not claim_filed:
            return {"computable": False, "reason": "POL-4 claim_filing_window_hours requires trip end and claim filed timestamps"}
        if (claim_filed - trip_end).total_seconds() < 0 or (claim_filed - trip_end).total_seconds() > filing_window_hours * 3600:
            return {"computable": True, "ruling_type": "REJECTED", "action": {"action_type": "NO_REFUND", "refund_amount": 0, "cleaning_fee_amount": 0, "currency": "SGD"}, "reason": "Cleaning claim was filed outside the POL-4 claim window.", "confidence": 0.95}

    photo_window_min = params.get("photo_window_min_after_trip_end")
    location_radius = params.get("photo_location_radius_m")
    valid = []
    invalid_reasons = []
    for img in analyses:
        if img.get("is_ai_generated", False):
            invalid_reasons.append("AI-generated image")
            continue
        if img.get("recycled_image_detected", False):
            invalid_reasons.append("recycled image")
            continue
        if img.get("exif_consistent_with_trip") is False:
            invalid_reasons.append("EXIF inconsistency")
            continue
        if photo_window_min is not None:
            photo_t = _parse_dt(img.get("photo_timestamp") or img.get("timestamp"))
            if not trip_end or not photo_t:
                invalid_reasons.append("missing photo/trip-end timestamp")
                continue
            delta = (photo_t - trip_end).total_seconds() / 60
            if delta < 0 or delta > photo_window_min:
                invalid_reasons.append("photo outside time window")
                continue
        if location_radius is not None:
            photo_loc = img.get("photo_location") or img.get("location")
            if not dropoff or not photo_loc:
                invalid_reasons.append("missing photo/drop-off location")
                continue
            try:
                distance = _haversine_m(photo_loc["lat"], photo_loc["lng"], dropoff["lat"], dropoff["lng"])
            except (KeyError, TypeError, ValueError):
                invalid_reasons.append("invalid photo/drop-off location")
                continue
            if distance > location_radius:
                invalid_reasons.append("photo outside location radius")
                continue
        valid.append(img)

    if not valid:
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "cleaning_fee_amount": 0, "currency": "SGD"},
            "reason": "No submitted photo satisfies the POL-4 evidence requirements; claim is not supported.",
            "confidence": 0.9,
            "evidence_issues": invalid_reasons,
        }

    severity_order = {"SEVERE": 3, "MODERATE": 2, "MINOR": 1}
    top = max(valid, key=lambda img: severity_order.get(str(img.get("damage_severity", "MINOR")).upper(), 0))
    severity = str(top.get("damage_severity", "MINOR")).upper()
    cap = params.get("severity_caps", {}).get(severity, 0)
    if cap <= 0 or top.get("stain_damage_classification") == "NO_DAMAGE_DETECTED":
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "cleaning_fee_amount": 0, "currency": "SGD"},
            "reason": "No chargeable damage detected in verified photo evidence.",
            "confidence": 0.85,
        }
    return {
        "computable": True,
        "ruling_type": "APPROVED",
        "action": {"action_type": "CLEANING_FEE_CHARGE", "refund_amount": 0, "cleaning_fee_amount": cap, "currency": "SGD"},
        "reason": f"Verified {severity} damage; POL-4 severity cap applied. Cleaning fee still requires human confirmation before execution.",
        "confidence": 0.9,
    }


def _compute_safety_alert(clause: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """POL-5: Safety Incidents — always escalated, no automated ruling."""
    params = clause.get("params", {})
    return {
        "computable": True,
        "ruling_type": "ESCALATED",
        "action": {"action_type": "ESCALATED_NO_ACTION", "refund_amount": 0, "currency": "SGD"},
        "reason": f"POL-5: safety/harassment/accessibility disputes require human review with {params.get('priority_level', 'URGENT')} priority.",
        "confidence": 1.0,
    }


_COMPUTE_BY_DISPUTE_TYPE = {
    "ROUTE_DEVIATION": ("POL-2", _compute_route_deviation),
    "NO_SHOW_CHARGE": ("POL-3", _compute_no_show),
    "CLEANING_FEE": ("POL-4", _compute_cleaning_fee),
    "SAFETY_ALERT": ("POL-5", _compute_safety_alert),
}


def compute_policy_values(dispute_type: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ground-truth computation against ryde_policy_v1.json's params for the
    operative clause of this dispute_type. Returns at minimum
    {"computable": bool}; when computable, also ruling_type, action,
    reason, confidence, and clause_id (the operative clause this
    computation is grounded in, for citation).
    """
    entry = _COMPUTE_BY_DISPUTE_TYPE.get(dispute_type)
    if entry is None:
        return {"computable": False, "reason": f"no computation rule for dispute_type '{dispute_type}'"}
    clause_id, fn = entry
    clause = _load_policy()["clauses"].get(clause_id, {})
    try:
        result = fn(clause, context)
    except Exception as exc:  # never let a malformed context crash POLICY_CONSULTATION
        return {"computable": False, "reason": f"computation error: {exc}"}
    result["clause_id"] = clause_id
    return result


# ------------------------------------------------------------------
# Precedent store (growable, persisted) — the self-learning half
# ------------------------------------------------------------------


def _seed_precedents() -> List[Dict[str, Any]]:
    now = datetime.now(_SGT).isoformat()
    return [
        {
            "precedent_id": "PREC-SEED-0001",
            "dispute_type": "ROUTE_DEVIATION",
            "keywords": ["detour", "unexplained", "route"],
            "ruling_type": "APPROVED",
            "recommended_action": {"action_type": "PARTIAL_REFUND", "refund_amount": 4.50, "currency": "SGD"},
            "similarity_summary": "2km unexplained detour with no logged reason; partial refund approved per POL-2.",
            "source": "SEED",
            "approved": True,
            "created_at": now,
        },
        {
            "precedent_id": "PREC-SEED-0002",
            "dispute_type": "NO_SHOW_CHARGE",
            "keywords": ["geofence", "pickup", "noshow"],
            "ruling_type": "APPROVED",
            "recommended_action": {"action_type": "FULL_REFUND", "refund_amount": 5.00, "currency": "SGD"},
            "similarity_summary": "Rider was within the pickup geofence before cancellation; fee reversed per POL-3.",
            "source": "SEED",
            "approved": True,
            "created_at": now,
        },
        {
            "precedent_id": "PREC-SEED-0003",
            "dispute_type": "CLEANING_FEE",
            "keywords": ["stain", "damage", "photo"],
            "ruling_type": "APPROVED",
            "recommended_action": {"action_type": "CLEANING_FEE_CHARGE", "refund_amount": 0, "cleaning_fee_amount": 30.00, "currency": "SGD"},
            "similarity_summary": "Verified stain damage from timestamped photo evidence; fee upheld per POL-4.",
            "source": "SEED",
            "approved": True,
            "created_at": now,
        },
    ]


def _load_kb() -> Dict[str, Any]:
    global _kb_state
    with _lock:
        if _kb_state is not None:
            return _kb_state
        if os.path.exists(_KB_PATH):
            try:
                with open(_KB_PATH, "r", encoding="utf-8") as f:
                    _kb_state = json.load(f)
                _kb_state.setdefault("precedents", [])
            except Exception:
                _kb_state = {"precedents": _seed_precedents()}
        else:
            _kb_state = {"precedents": _seed_precedents()}
        return _kb_state


def _save_kb() -> None:
    with _lock:
        os.makedirs(os.path.dirname(_KB_PATH) or ".", exist_ok=True)
        with open(_KB_PATH, "w", encoding="utf-8") as f:
            json.dump(_kb_state, f, ensure_ascii=False, indent=2)


def reset_for_testing(kb_path: Optional[str] = None, policy_path: Optional[str] = None) -> None:
    """Test helper: clear in-memory caches (and optionally point at fresh file paths)."""
    global _kb_state, _KB_PATH, _policy, _POLICY_PATH
    with _lock:
        _kb_state = None
        _policy = None
        if kb_path is not None:
            _KB_PATH = kb_path
        if policy_path is not None:
            _POLICY_PATH = policy_path


def find_precedents(
    dispute_type: str, keywords: Optional[List[str]] = None, top_k: int = 3
) -> List[Dict[str, Any]]:
    """
    Return up to top_k *approved* precedent records for dispute_type
    (POL-8: only_approved_precedents_citable), ranked by keyword overlap
    first, then a small preference for HUMAN_OVERRIDE-sourced precedents
    on ties (learned corrections surface ahead of static seed data once
    approved), then recency.
    """
    state = _load_kb()
    keyword_set = {k.lower() for k in (keywords or [])}
    candidates = [
        p for p in state["precedents"]
        if p.get("dispute_type") == dispute_type and p.get("approved", False)
    ]

    def _score(p: Dict[str, Any]):
        overlap = len(keyword_set & {k.lower() for k in p.get("keywords", [])})
        learned_bonus = 1 if p.get("source") == "HUMAN_OVERRIDE" else 0
        return (overlap, learned_bonus, p.get("created_at", ""))

    candidates.sort(key=_score, reverse=True)
    return [dict(p) for p in candidates[:top_k]]


def to_precedent_reference(record: Dict[str, Any]) -> Dict[str, Any]:
    """Project an internal precedent record down to schema PrecedentReference fields."""
    return {
        "precedent_id": record["precedent_id"],
        "similarity_summary": record.get("similarity_summary", ""),
        "prior_ruling_type": record.get("ruling_type", "ESCALATED"),
    }


_ACTION_TYPE_TO_RULING = {
    "FULL_REFUND": "APPROVED",
    "PARTIAL_REFUND": "PARTIAL_REFUND",
    "NO_REFUND": "REJECTED",
    "CLEANING_FEE_CHARGE": "APPROVED",
    "PENALTY_ONLY": "APPROVED",
    "ESCALATED_NO_ACTION": "ESCALATED",
}


def infer_ruling_type_from_action(action: Optional[Dict[str, Any]]) -> str:
    """
    Best-effort mapping from a RecommendedAction.action_type to a ruling_type,
    used when the caller doesn't have an explicit human ruling_type on hand
    (schema's HumanConfirmationDetails only carries modified_action, not a
    standalone ruling_type field).
    """
    return _ACTION_TYPE_TO_RULING.get((action or {}).get("action_type"), "ESCALATED")


def add_precedent(
    *,
    dispute_type: str,
    ruling_type: str,
    recommended_action: Dict[str, Any],
    keywords: Optional[List[str]] = None,
    similarity_summary: str = "",
    source: str = "HUMAN_OVERRIDE",
    approved: bool = True,
) -> str:
    """Append a new precedent and persist it. Returns the new precedent_id."""
    if ruling_type not in _RULING_TYPES:
        ruling_type = "ESCALATED"
    state = _load_kb()
    precedent_id = f"PREC-{uuid.uuid4().hex[:8].upper()}"
    record = {
        "precedent_id": precedent_id,
        "dispute_type": dispute_type,
        "keywords": keywords or [],
        "ruling_type": ruling_type,
        "recommended_action": recommended_action,
        "similarity_summary": similarity_summary,
        "source": source,
        "approved": approved,
        "created_at": datetime.now(_SGT).isoformat(),
    }
    with _lock:
        state["precedents"].append(record)
    _save_kb()
    return precedent_id


def approve_precedent(precedent_id: str) -> bool:
    """Manually approve a candidate precedent (e.g. a REJECTED_AUTO one) so it becomes citable."""
    state = _load_kb()
    with _lock:
        for p in state["precedents"]:
            if p["precedent_id"] == precedent_id:
                p["approved"] = True
                _save_kb()
                return True
    return False


def record_knowledge_base_update(
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
    Self-learning entry point. Call this after EXECUTION_ROUTER resolves a
    human-escalated case where the human's final decision differs from
    JudgeVerdict (approval_decision MODIFIED / OVERRIDDEN / REJECTED_AUTO).

    Per POL-8: only MODIFIED/OVERRIDDEN decisions (with a reason) create an
    *approved*, citable precedent. A REJECTED_AUTO-triggered update still
    indexes a candidate precedent for audit purposes, but leaves it
    unapproved (approved=False) so find_precedents() won't surface it until
    someone calls approve_precedent() — matching
    only_approved_precedents_citable.

    Returns a schema-shaped PolicyKnowledgeBaseUpdate dict (schema:
    $defs.PolicyKnowledgeBaseUpdate), ready to store in
    self.ctx.policy_kb_update.
    """
    if trigger not in ("MODIFIED", "OVERRIDDEN", "REJECTED_AUTO"):
        trigger = "OVERRIDDEN"

    ruling = human_ruling_type or infer_ruling_type_from_action(human_final_action)
    approved = trigger in _PRECEDENT_CREATING_TRIGGERS
    new_precedent_id = add_precedent(
        dispute_type=dispute_type,
        ruling_type=ruling,
        recommended_action=human_final_action,
        keywords=keywords,
        similarity_summary=mismatch_summary or "Human-corrected outcome.",
        source="HUMAN_OVERRIDE",
        approved=approved,
    )

    return {
        "update_id": f"KB-{uuid.uuid4().hex[:8].upper()}",
        "trigger": trigger,
        "judge_ruling_type": judge_ruling_type,
        "judge_recommended_action": judge_recommended_action,
        "human_final_action": human_final_action,
        "clauses_flagged": clauses_flagged or [],
        "mismatch_summary": mismatch_summary,
        "new_precedent_id": new_precedent_id,
        "updated_at": datetime.now(_SGT).isoformat(),
    }


def extract_keywords(text: str, max_keywords: int = 15) -> List[str]:
    """Extract normalized retrieval keywords compatible with clause/precedent terms.

    The matcher is intentionally lightweight, but normalizes punctuation and
    common compound forms so policy keywords such as ``no-show`` and
    ``AI-generated`` do not depend on literal punctuation.
    """
    import re

    raw = re.findall(r"[A-Za-z][A-Za-z'-]*", (text or "").lower())
    aliases = {
        "no-show": "noshow",
        "no_show": "noshow",
        "ai-generated": "generated",
        "ai_generated": "generated",
        "reroute": "reroute",
    }
    stop = {"this", "that", "with", "from", "were", "have", "been", "they", "there", "into", "then", "than", "only", "also", "case", "rider", "driver"}
    seen: List[str] = []
    for token in raw:
        token = aliases.get(token, token.replace("-", "").replace("_", ""))
        if len(token) < 4 or token in stop:
            continue
        if token not in seen:
            seen.append(token)
        if len(seen) >= max_keywords:
            break
    return seen