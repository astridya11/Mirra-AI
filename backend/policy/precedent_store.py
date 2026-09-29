"""
backend/policy/precedent_store.py - PolicyAgent's own knowledge base.

Two parts, matching workflow.md's Phase 4 (Policy Consultation):

  1. Clause library: loaded from ryde_policy_v1.json (POLICY_FILE_PATH env
     var, default alongside this module). This is the real Ryde policy
     document — POL-1..POL-10, each with `applies_to`, `text`, and a
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
    """POL-4 using only evidence fields represented by schemas.json.

    The schema does not define a structured cleaning receipt, trip-end timestamp,
    or a receipt/claim object. Those prerequisites therefore cannot be invented
    from unrelated fields; when they are absent the policy computation escalates
    rather than silently treating them as satisfied.
    """
    params = clause.get("params", {})
    ds = context.get("data_sources", {}) or {}
    bonus = context.get("bonus_modules", {}) or {}
    analyses = bonus.get("image_exif_analyses", []) or []
    if not analyses:
        return {"computable": False, "reason": "POL-4 requires image_exif_analyses"}

    trip = ds.get("trip_data") or {}
    dropoff = trip.get("dropoff_location")
    if not dropoff:
        return {"computable": False, "reason": "POL-4 photo location check requires trip_data.dropoff_location"}

    # The master schema has no structured trip-end timestamp or cleaning-receipt
    # field. Accept an explicitly supplied runtime adapter field only when it is
    # outside the case schema; otherwise remain non-computable rather than infer.
    trip_end = _parse_dt(
        trip.get("trip_end_time")
        or trip.get("dropoff_time")
        or context.get("trip_end_time")
    )
    receipt_present = context.get("cleaning_receipt_present")
    if receipt_present is None:
        receipt_present = context.get("cleaning_claim", {}).get("receipt_present") if isinstance(context.get("cleaning_claim"), dict) else None
    if params.get("receipt_required", True) and receipt_present is not True:
        return {
            "computable": False,
            "reason": "POL-4 requires a verified cleaning receipt; schemas.json does not define a structured receipt field",
        }
    if not trip_end:
        return {
            "computable": False,
            "reason": "POL-4 photo_window_min_after_trip_end requires a trip-end timestamp; schemas.json TripData does not define one",
        }

    valid = []
    invalid_reasons = []
    for img in analyses:
        # ExifAnalysis has explicit required EXIF fields. Missing values cannot
        # be replaced with image-analysis guesses.
        exif_timestamp = _parse_dt(img.get("exif_timestamp"))
        exif_location = img.get("exif_gps_location")
        if not exif_timestamp or not isinstance(exif_location, dict):
            invalid_reasons.append(f"{img.get('image_id', 'image')}: missing required EXIF timestamp/location")
            continue

        if img.get("is_ai_generated") is True:
            invalid_reasons.append(f"{img.get('image_id', 'image')}: AI-generated image")
            continue
        if img.get("recycled_image_detected") is True:
            invalid_reasons.append(f"{img.get('image_id', 'image')}: recycled image")
            continue
        if img.get("exif_consistent_with_trip") is False:
            invalid_reasons.append(f"{img.get('image_id', 'image')}: EXIF inconsistent with trip")
            continue

        delta = (exif_timestamp - trip_end).total_seconds() / 60
        if delta < 0 or delta > params.get("photo_window_min_after_trip_end", 30):
            invalid_reasons.append(f"{img.get('image_id', 'image')}: EXIF timestamp outside photo window")
            continue

        try:
            distance = _haversine_m(
                exif_location["latitude"], exif_location["longitude"],
                dropoff["lat"], dropoff["lng"],
            )
        except (KeyError, TypeError, ValueError):
            invalid_reasons.append(f"{img.get('image_id', 'image')}: invalid EXIF/drop-off location")
            continue
        if distance > params.get("photo_location_radius_m", 500):
            invalid_reasons.append(f"{img.get('image_id', 'image')}: EXIF location outside drop-off radius")
            continue
        valid.append(img)

    if not valid:
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "cleaning_fee_amount": 0, "currency": "SGD"},
            "reason": "No submitted image satisfies the POL-4 evidence requirements.",
            "confidence": 0.9,
            "evidence_issues": invalid_reasons,
        }

    severity_order = {"SEVERE": 3, "MODERATE": 2, "MINOR": 1}
    top = max(valid, key=lambda img: severity_order.get(str(img.get("damage_severity", "MINOR")).upper(), 0))
    severity = str(top.get("damage_severity", "MINOR")).upper()
    classification = str(top.get("stain_damage_classification", "OTHER")).upper()
    cap = float(params.get("severity_caps", {}).get(severity, 0) or 0)
    if cap <= 0 or classification == "NO_DAMAGE_DETECTED":
        return {
            "computable": True,
            "ruling_type": "REJECTED",
            "action": {"action_type": "NO_REFUND", "refund_amount": 0, "cleaning_fee_amount": 0, "currency": "SGD"},
            "reason": "No chargeable damage detected in verified image evidence.",
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


def _compute_account_action(context: Dict[str, Any]) -> Dict[str, Any]:
    """Compute the score-free POL-10 account-action recommendation.

    Account actions are based only on confirmed misconduct in the current case.
    HistoricalProfile.bad_faith_flag may support the *repeated bad-faith* rule,
    but no account penalty balance is stored, read, accumulated, or thresholded.
    FraudAssessment/EscalationProtocol flags are suspicion indicators; a matching
    verified Prosecutor fact is still required before an action is recommended.
    """
    policy = _load_policy()
    params = policy.get("clauses", {}).get("POL-10", {}).get("params", {})
    table = params.get("misconduct_action_table", {})
    precedence = params.get(
        "action_precedence",
        ["ACCOUNT_BAN", "TEMPORARY_SUSPENSION", "WARNING_ISSUED", "NONE"],
    )

    bonus = context.get("bonus_modules", {}) or {}
    fraud = bonus.get("fraud_assessment") or {}
    analyses = bonus.get("image_exif_analyses", []) or []
    escalation = bonus.get("escalation_protocol") or {}
    data_sources = context.get("data_sources", {}) or {}
    historical = data_sources.get("historical_profiles", []) or []
    findings = context.get("prosecutor_findings", {}) or {}
    verified_facts = findings.get("verified_facts", []) or []

    def _party(value: Any) -> str:
        return {"RIDER_ADVOCATE": "RIDER", "DRIVER_ADVOCATE": "DRIVER"}.get(
            str(value or "").upper(), str(value or "").upper()
        )

    def _fact_text(fact: Dict[str, Any]) -> str:
        return str(fact.get("description", "") or "").lower()

    def _contains_any(text: str, terms: tuple) -> bool:
        return any(term in text for term in terms)

    explicit_target = _party(context.get("target_party"))
    if explicit_target not in {"RIDER", "DRIVER"}:
        explicit_target = _party(context.get("account_action_target"))
    target = explicit_target if explicit_target in {"RIDER", "DRIVER"} else "NONE"

    violations: List[str] = []

    def _confirmed_violation(key: str, terms: tuple) -> None:
        nonlocal target
        matching = [f for f in verified_facts if _contains_any(_fact_text(f), terms)]
        if not matching:
            return

        parties = {
            _party(f.get("party_relevance"))
            for f in matching
            if _party(f.get("party_relevance")) in {"RIDER", "DRIVER", "BOTH"}
        }
        attributed = target
        if attributed not in {"RIDER", "DRIVER"} and len(parties) == 1:
            only = next(iter(parties))
            if only in {"RIDER", "DRIVER"}:
                attributed = only
        # BOTH is not sufficient to attribute an account action to one account.
        if attributed not in {"RIDER", "DRIVER"}:
            return
        target = attributed
        if key not in violations:
            violations.append(key)

    # A confirmed Prosecutor fact is the trigger. FraudAssessment is advisory
    # context only and must never be required for a confirmed fact to trigger POL-10.
    if verified_facts:
        # POL-10 specifically requires a prior verified bad-faith finding for
        # the repeated-pattern action. First identify the current-case target,
        # then check that same party's HistoricalProfile.bad_faith_flag.
        current_bad_faith_facts = [
            f for f in verified_facts
            if _contains_any(_fact_text(f), ("bad-faith", "bad faith", "repeated fake", "abuse pattern"))
        ]
        candidate_parties = {
            _party(f.get("party_relevance"))
            for f in current_bad_faith_facts
            if _party(f.get("party_relevance")) in {"RIDER", "DRIVER"}
        }
        if target not in {"RIDER", "DRIVER"} and len(candidate_parties) == 1:
            target = next(iter(candidate_parties))

        prior_bad_faith = any(
            isinstance(profile, dict)
            and _party(profile.get("party")) == target
            and profile.get("bad_faith_flag") is True
            for profile in historical
        )
        if prior_bad_faith:
            _confirmed_violation(
                "REPEATED_BAD_FAITH_PATTERN",
                ("bad-faith", "bad faith", "repeated fake", "abuse pattern"),
            )

    # Collusion is triggered by a verified Prosecutor fact, not merely by the
    # FraudAssessment collusion_warning_flag.
    _confirmed_violation(
            "COLLUSION_CONFIRMED",
            ("collusion", "coordinated manipulation", "coordinated fraud"),
    )

    fabricated_evidence_present = any(
        a.get("is_ai_generated") is True or a.get("recycled_image_detected") is True
        for a in analyses
    )
    if fabricated_evidence_present or any(
        _contains_any(_fact_text(f), ("fabricated evidence", "recycled image", "ai-generated", "ai generated", "synthetic image"))
        for f in verified_facts
    ):
        _confirmed_violation(
            "FABRICATED_EVIDENCE_CONFIRMED",
            ("fabricated evidence", "recycled image", "ai-generated", "ai generated", "synthetic image"),
        )

    # Safety severity is determined from the verified fact because
    # EscalationProtocol does not define a severity field.
    if any(
        _contains_any(_fact_text(f), ("severe safety", "severe threat", "serious threat", "violence", "violent", "moderate safety", "moderate threat"))
        for f in verified_facts
    ) or escalation.get("safety_threat_detected"):
        severe_terms = ("severe safety", "severe threat", "serious threat", "violence", "violent")
        moderate_terms = ("moderate safety", "moderate threat")
        if any(_contains_any(_fact_text(f), severe_terms) for f in verified_facts):
            _confirmed_violation("SAFETY_VIOLATION_CONFIRMED_SEVERE", severe_terms)
        elif any(_contains_any(_fact_text(f), moderate_terms) for f in verified_facts):
            _confirmed_violation("SAFETY_VIOLATION_CONFIRMED_MODERATE", moderate_terms)

    if not violations:
        return {
            "computable": True,
            "account_action": "NONE",
            "target": target,
            "violations": [],
            "reason": "No POL-10 misconduct is both verified and attributable to a specific account.",
        }

    actions = [table.get(v, {}).get("account_action", "NONE") for v in violations]
    action_rank = {action: i for i, action in enumerate(precedence)}
    account_action = max(actions, key=lambda action: action_rank.get(action, len(precedence)))

    return {
        "computable": True,
        "account_action": account_action,
        "target": target,
        "violations": violations,
        "reason": (
            f"POL-10 confirmed misconduct: {', '.join(violations)}; "
            f"case-level account action recommendation is {account_action} for {target}."
        ),
    }


def compute_account_action(context: Dict[str, Any]) -> Dict[str, Any]:
    """Backward-compatible public wrapper for the POL-10 deterministic check."""
    policy = _load_policy()
    clause = policy.get("clauses", {}).get("POL-10", {})
    return _compute_account_action(clause, context)


def compute_policy_values(dispute_type: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run all deterministic policy checks needed for a policy consultation.

    Account actions are POL-10 checks and are independent of dispute type.
    Therefore _compute_account_action() is evaluated on every call, using the
    current Prosecutor verified_facts. The dispute-specific computation is then
    evaluated through _COMPUTE_BY_DISPUTE_TYPE as before.

    Return shape:
      {
        "computable": bool,
        "clause_id": <dispute computation clause or None>,
        "ruling_type": ... (when a dispute computation exists),
        "action": ... (when a dispute computation exists),
        "account_action": {
            "computable": bool,
            "account_action": "NONE" | "WARNING_ISSUED" |
                              "TEMPORARY_SUSPENSION" | "ACCOUNT_BAN",
            "target": "RIDER" | "DRIVER" | "NONE",
            "violations": [...]
        }
      }

    The nested account_action object is always present so downstream callers
    do not need to infer whether POL-10 was evaluated. A confirmed misconduct
    finding can therefore produce an account-action recommendation even when
    dispute_type has no entry in _COMPUTE_BY_DISPUTE_TYPE.
    """
    # POL-10 is case-level and must be checked regardless of dispute type.
    policy = _load_policy()
    account_clause = policy.get("clauses", {}).get("POL-10", {})
    try:
        account_result = _compute_account_action(context)
    except Exception as exc:
        # Keep the policy consultation alive, but never silently manufacture
        # an account action when the misconduct computation fails.
        account_result = {
            "computable": False,
            "account_action": "NONE",
            "target": "NONE",
            "violations": [],
            "reason": f"POL-10 computation error: {exc}",
        }

    entry = _COMPUTE_BY_DISPUTE_TYPE.get(dispute_type)
    if entry is None:
        return {
            "computable": False,
            "clause_id": None,
            "reason": f"no computation rule for dispute_type '{dispute_type}'",
            "account_action": account_result,
        }

    clause_id, fn = entry
    clause = policy.get("clauses", {}).get(clause_id, {})
    try:
        result = fn(clause, context)
    except Exception as exc:  # never let a malformed context crash POLICY_CONSULTATION
        return {
            "computable": False,
            "clause_id": clause_id,
            "reason": f"computation error: {exc}",
            "account_action": account_result,
        }

    result["clause_id"] = clause_id
    result["account_action"] = account_result

    # Keep the canonical RecommendedAction-compatible shape used by the
    # policy consultant. POL-10 is an additional case-level recommendation,
    # not a penalty-point calculation. Do not add/remove penalty scores here.
    action = result.get("action")
    if isinstance(action, dict):
        action["account_action"] = account_result.get("account_action", "NONE")
        action["penalty_target"] = account_result.get("target", "NONE")
        result["action"] = action

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