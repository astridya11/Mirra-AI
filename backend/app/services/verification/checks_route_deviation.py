"""Deterministic ROUTE_DEVIATION evidence checks.

Mirrors the style of checks.py: every function reads data_sources safely,
never raises, and degrades to MISSING/DISPUTED on malformed input rather
than crashing. These checks establish evidence facts only — they never
conclude intent, fault, policy violation, or fare causation (see each
function's docstring for its explicit prohibited conclusions).
"""

import math
from typing import Any

from .checks import _evidence_ref, _is_before, _parse_ts, haversine_distance

_ENDPOINT_TOLERANCE_M = 50.0  # same technical GPS tolerance used elsewhere in this layer

# ponytail: small deterministic keyword set, not NLP. Goal is only to stop a
# generic unrelated chat message from being labeled "regarding the route
# deviation" — not to understand language.
_ROUTE_RELEVANT_TERMS = frozenset(
    {
        "route", "reroute", "rerouted", "rerouting", "gps", "pie", "ecp",
        "road", "way", "path", "direction", "detour",
    }
)


def _is_number(value: Any) -> bool:
    """A value counts as numeric only if it is a real, finite int/float.

    bool is rejected (bool is a subclass of int in Python). NaN and
    +/-Infinity are rejected — math.isfinite() is False for both, so a
    malformed fixture value can never silently become a false VERIFIED
    fact like "a route deviation of nan km is recorded."
    """
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _is_route_relevant(text: str) -> bool:
    """Whether text contains at least one route-related term, as whole
    tokens (not substrings), so e.g. "anyway" does not match "way"."""
    normalized = "".join(c.lower() if c.isalnum() else " " for c in text)
    tokens = set(normalized.split())
    return bool(tokens & _ROUTE_RELEVANT_TERMS)


def _is_valid_coord(location: Any) -> bool:
    return (
        isinstance(location, dict)
        and _is_number(location.get("lat"))
        and _is_number(location.get("lng"))
    )


def _is_valid_point(point: Any) -> bool:
    return (
        isinstance(point, dict)
        and _is_number(point.get("latitude"))
        and _is_number(point.get("longitude"))
    )


def check_route_deviation_recorded(data: dict[str, Any]) -> dict[str, Any]:
    """Whether GPS telemetry records a positive route deviation distance.

    Must NOT conclude: intention, fault, justification, or policy violation.
    """
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})
    deviation = gps_telemetry.get("deviation_distance_km")

    if not _is_number(deviation):
        return {
            "status": "MISSING",
            "description": "Route deviation distance is not recorded in GPS telemetry.",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = [
        _evidence_ref("ROUTE-SUMMARY", "ROUTE_TRAJECTORY", f"Deviation distance {deviation} km")
    ]

    if deviation < 0:
        return {
            "status": "DISPUTED",
            "description": (
                f"Recorded route deviation distance ({deviation} km) is negative, which is "
                f"not a physically valid telemetry value."
            ),
            "evidence_refs": evidence_refs,
            "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
        }

    if deviation == 0:
        return {
            "status": "DISPUTED",
            "description": (
                "Recorded route deviation distance is 0 km — the frozen GPS telemetry does "
                "not show a route deviation for this trip."
            ),
            "evidence_refs": evidence_refs,
            "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": f"A route deviation of {deviation} km is recorded in GPS telemetry.",
        "evidence_refs": evidence_refs,
        "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
    }


def check_route_deviation_event_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a route_deviation_detected app event corroborates a recorded
    deviation, and falls within the trip_started/trip_completed window.

    Must NOT conclude: the cause of the deviation.
    """
    ds = data.get("data_sources", {})
    gps_telemetry = ds.get("gps_telemetry", {})
    app_events = ds.get("app_events", [])
    if not isinstance(app_events, list):
        app_events = []

    deviation = gps_telemetry.get("deviation_distance_km")
    if not (_is_number(deviation) and deviation > 0):
        return {
            "status": "MISSING",
            "description": "No positive recorded route deviation to check event consistency against.",
            "evidence_refs": [],
            "details": {},
        }

    def _event(event_type: str) -> dict[str, Any] | None:
        return next(
            (e for e in app_events if isinstance(e, dict) and e.get("event_type") == event_type),
            None,
        )

    deviation_event = _event("route_deviation_detected")
    if deviation_event is None:
        return {
            "status": "MISSING",
            "description": (
                "A positive route deviation is recorded, but no route_deviation_detected app "
                "event exists to corroborate when it occurred."
            ),
            "evidence_refs": [
                _evidence_ref("ROUTE-SUMMARY", "ROUTE_TRAJECTORY", f"Deviation distance {deviation} km")
            ],
            "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
        }

    evidence_refs = [
        _evidence_ref(
            deviation_event.get("evidence_id"),
            "APP_EVENT",
            f"route_deviation_detected at {deviation_event.get('timestamp')}: {deviation_event.get('details', '')}",
        )
    ]

    deviation_ts = _parse_ts(deviation_event.get("timestamp"))
    if deviation_ts is None:
        return {
            "status": "MISSING",
            "description": (
                f"route_deviation_detected event has a malformed timestamp "
                f"('{deviation_event.get('timestamp')}') and cannot be checked against the trip window."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    start_event = _event("trip_started")
    complete_event = _event("trip_completed")
    if start_event is None or complete_event is None:
        return {
            "status": "MISSING",
            "description": (
                "Trip start/completion events are unavailable; the route deviation event's "
                "timing cannot be verified against the trip window."
            ),
            "evidence_refs": evidence_refs,
            "details": {},
        }

    start_ts = _parse_ts(start_event.get("timestamp"))
    complete_ts = _parse_ts(complete_event.get("timestamp"))
    evidence_refs.append(
        _evidence_ref(start_event.get("evidence_id"), "APP_EVENT", f"trip_started at {start_event.get('timestamp')}")
    )
    evidence_refs.append(
        _evidence_ref(
            complete_event.get("evidence_id"), "APP_EVENT", f"trip_completed at {complete_event.get('timestamp')}"
        )
    )

    if start_ts is None or complete_ts is None:
        return {
            "status": "MISSING",
            "description": (
                "Trip start/completion timestamps are malformed; the route deviation event's "
                "timing cannot be verified against the trip window."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    after_start = _is_before(start_ts, deviation_ts)
    before_complete = _is_before(deviation_ts, complete_ts)

    if after_start is None or before_complete is None:
        return {
            "status": "MISSING",
            "description": (
                "Trip window and route-deviation-event timestamps use incompatible timezone "
                "representations and cannot be compared."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if not after_start or not before_complete:
        return {
            "status": "DISPUTED",
            "description": (
                f"route_deviation_detected event at {deviation_event.get('timestamp')} falls outside "
                f"the trip window ({start_event.get('timestamp')} to {complete_event.get('timestamp')})."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"route_deviation_detected event at {deviation_event.get('timestamp')} is recorded within "
            f"the trip window ({start_event.get('timestamp')} to {complete_event.get('timestamp')})."
        ),
        "evidence_refs": evidence_refs,
        "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
    }


def check_route_duration_delta(data: dict[str, Any]) -> dict[str, Any]:
    """Arithmetic difference between actual and optimal trip duration.

    Must NOT conclude: that the delta is excessive/unreasonable, that it
    caused extra fare, or any policy violation.
    """
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})
    actual = gps_telemetry.get("trip_duration_seconds")
    optimal = gps_telemetry.get("optimal_duration_seconds")

    missing = []
    if not _is_number(actual):
        missing.append("trip_duration_seconds")
    if not _is_number(optimal):
        missing.append("optimal_duration_seconds")
    if missing:
        return {
            "status": "MISSING",
            "description": f"Cannot compute route duration delta: missing {', '.join(missing)}.",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = [
        _evidence_ref(
            "ROUTE-SUMMARY", "ROUTE_TRAJECTORY", f"actual trip duration {actual}s, optimal duration {optimal}s"
        )
    ]

    if actual < 0 or optimal < 0:
        return {
            "status": "DISPUTED",
            "description": (
                f"Recorded trip duration values are negative (actual {actual}s, optimal {optimal}s), "
                f"which is not physically valid telemetry."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    delta = actual - optimal
    return {
        "status": "VERIFIED",
        "description": (
            f"Actual trip duration was {actual} seconds and optimal duration was {optimal} seconds "
            f"(difference of {delta} seconds)."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "duration_delta_seconds": delta,
            "party_relevance": "NEUTRAL",
            "confidence_level": 1.0,
        },
    }


def check_route_endpoint_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the GPS route's first/last points match the declared
    pickup/dropoff locations within a technical GPS tolerance.

    Must NOT conclude: mid-trip route correctness.
    """
    ds = data.get("data_sources", {})
    trip_data = ds.get("trip_data", {})
    gps_telemetry = ds.get("gps_telemetry", {})

    pickup = trip_data.get("pickup_location")
    dropoff = trip_data.get("dropoff_location")
    actual_route = gps_telemetry.get("actual_route", [])
    if not isinstance(actual_route, list):
        actual_route = []

    if not _is_valid_coord(pickup) or not _is_valid_coord(dropoff):
        return {
            "status": "MISSING",
            "description": "Pickup or dropoff coordinates are missing or malformed in trip data.",
            "evidence_refs": [],
            "details": {},
        }

    if not actual_route:
        return {
            "status": "MISSING",
            "description": "GPS telemetry actual route is empty; endpoint consistency cannot be verified.",
            "evidence_refs": [],
            "details": {},
        }

    first_point = actual_route[0]
    last_point = actual_route[-1]
    if not _is_valid_point(first_point) or not _is_valid_point(last_point):
        return {
            "status": "MISSING",
            "description": "GPS route endpoint coordinates are malformed; endpoint consistency cannot be verified.",
            "evidence_refs": [],
            "details": {},
        }

    start_distance_m = haversine_distance(
        pickup["lat"], pickup["lng"], first_point["latitude"], first_point["longitude"]
    )
    end_distance_m = haversine_distance(
        dropoff["lat"], dropoff["lng"], last_point["latitude"], last_point["longitude"]
    )

    evidence_refs = [
        _evidence_ref(
            first_point.get("evidence_id"),
            "GPS_TELEMETRY",
            f"GPS start point at {first_point.get('timestamp')} ({first_point['latitude']}, {first_point['longitude']})",
        ),
        _evidence_ref(
            last_point.get("evidence_id"),
            "GPS_TELEMETRY",
            f"GPS end point at {last_point.get('timestamp')} ({last_point['latitude']}, {last_point['longitude']})",
        ),
        _evidence_ref(
            "TRIP-DATA",
            "APP_EVENT",
            f"Trip pickup {pickup.get('name', '')} / dropoff {dropoff.get('name', '')}",
        ),
    ]

    if start_distance_m <= _ENDPOINT_TOLERANCE_M and end_distance_m <= _ENDPOINT_TOLERANCE_M:
        return {
            "status": "VERIFIED",
            "description": (
                f"GPS route start point is within {start_distance_m:.1f} m of the declared pickup "
                f"location and end point is within {end_distance_m:.1f} m of the declared dropoff "
                f"location (tolerance {_ENDPOINT_TOLERANCE_M:.0f} m)."
            ),
            "evidence_refs": evidence_refs,
            "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
        }

    return {
        "status": "DISPUTED",
        "description": (
            f"GPS route endpoint(s) deviate from declared trip locations beyond the "
            f"{_ENDPOINT_TOLERANCE_M:.0f} m tolerance (start {start_distance_m:.1f} m, end {end_distance_m:.1f} m)."
        ),
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_route_unexpected_stops(data: dict[str, Any]) -> dict[str, Any]:
    """Presence/absence of recorded unexpected stops.

    Must NOT conclude that an empty list proves stops never physically
    happened — only that none were recorded.
    """
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})

    if "unexpected_stops" not in gps_telemetry:
        return {
            "status": "MISSING",
            "description": "Unexpected-stops data is not recorded in GPS telemetry.",
            "evidence_refs": [],
            "details": {},
        }

    stops = gps_telemetry.get("unexpected_stops")
    if not isinstance(stops, list):
        return {
            "status": "MISSING",
            "description": "Unexpected-stops data is present but malformed (not a list).",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = [
        _evidence_ref("ROUTE-SUMMARY", "ROUTE_TRAJECTORY", f"unexpected stops recorded: {len(stops)}")
    ]

    if not stops:
        return {
            "status": "VERIFIED",
            "description": "No unexpected stops were recorded.",
            "evidence_refs": evidence_refs,
            "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
        }

    return {
        "status": "DISPUTED",
        "description": f"{len(stops)} unexpected stop(s) were recorded during the trip.",
        "evidence_refs": evidence_refs,
        "details": {"stop_count": len(stops), "confidence_level": 1.0},
    }


def check_driver_route_explanation_recorded(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the driver recorded any explanation regarding the route.

    Must NOT conclude that the explanation is true, confirmed, or that the
    driver was justified.
    """
    transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])
    if not isinstance(transcript, list):
        transcript = []

    driver_msg = next(
        (
            m
            for m in transcript
            if isinstance(m, dict)
            and m.get("sender") in ("driver", "DRIVER")
            and isinstance(m.get("content"), str)
            and m.get("content").strip()
            and _is_route_relevant(m["content"])
        ),
        None,
    )
    if driver_msg is None:
        return {
            "status": "MISSING",
            "description": "No driver explanation regarding the route is recorded in the chat transcript.",
            "evidence_refs": [],
            "details": {"party_relevance": "DRIVER"},
        }

    return {
        "status": "VERIFIED",
        "description": "A driver explanation regarding the route deviation is recorded in the chat transcript.",
        "evidence_refs": [
            _evidence_ref(driver_msg.get("message_id"), "CHAT_LOG", f"driver message at {driver_msg.get('timestamp')}")
        ],
        "details": {"party_relevance": "DRIVER"},
    }


def check_rider_route_objection_recorded(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the rider recorded any objection regarding the route.

    Must NOT conclude that the objection is correct.
    """
    transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])
    if not isinstance(transcript, list):
        transcript = []

    rider_msg = next(
        (
            m
            for m in transcript
            if isinstance(m, dict)
            and m.get("sender") in ("rider", "RIDER")
            and isinstance(m.get("content"), str)
            and m.get("content").strip()
            and _is_route_relevant(m["content"])
        ),
        None,
    )
    if rider_msg is None:
        return {
            "status": "MISSING",
            "description": "No rider objection regarding the route is recorded in the chat transcript.",
            "evidence_refs": [],
            "details": {"party_relevance": "RIDER"},
        }

    return {
        "status": "VERIFIED",
        "description": "A rider objection regarding the route is recorded in the chat transcript.",
        "evidence_refs": [
            _evidence_ref(rider_msg.get("message_id"), "CHAT_LOG", f"rider message at {rider_msg.get('timestamp')}")
        ],
        "details": {"party_relevance": "RIDER"},
    }


def check_route_disputed_fare_context(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a disputed fare amount is recorded for this case.

    Must NOT conclude that the route deviation caused the disputed amount —
    there is no causal evidence for that in the frozen record.
    """
    payment = data.get("data_sources", {}).get("payment_fare_data", {})
    amount = payment.get("disputed_amount") if isinstance(payment, dict) else None
    currency = payment.get("disputed_amount_currency", "") if isinstance(payment, dict) else ""

    if not _is_number(amount):
        return {
            "status": "MISSING",
            "description": "Disputed fare amount is not recorded in payment/fare data.",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = [_evidence_ref("PAYMENT-DATA", "PAYMENT_RECORD", f"disputed amount {amount} {currency}".strip())]

    if amount < 0:
        return {
            "status": "DISPUTED",
            "description": (
                f"Recorded disputed amount ({amount} {currency}) is negative, which is not a valid fare value."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": f"A disputed amount of {currency} {amount} is recorded for this case.".replace("  ", " "),
        "evidence_refs": evidence_refs,
        "details": {"party_relevance": "NEUTRAL", "confidence_level": 1.0},
    }
