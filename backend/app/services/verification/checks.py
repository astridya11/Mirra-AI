import math
from datetime import datetime
from typing import Any

from app.services.verification.policy import get_policy_params


def _parse_ts(ts: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp. Never raises: returns None for missing,
    non-string, or malformed values so callers can treat them as evidence
    quality issues (MISSING/DISPUTED) instead of crashing the request."""
    if not isinstance(ts, str) or not ts.strip():
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _seconds_between(later: datetime | None, earlier: datetime | None) -> int | None:
    """later - earlier in seconds, or None if either is missing or the two
    values aren't comparable (e.g. one timezone-aware, one timezone-naive)."""
    if later is None or earlier is None:
        return None
    try:
        return int((later - earlier).total_seconds())
    except TypeError:
        return None


def _is_before(a: datetime | None, b: datetime | None) -> bool | None:
    """Whether a < b, or None if either is missing or the two aren't comparable."""
    if a is None or b is None:
        return None
    try:
        return a < b
    except TypeError:
        return None


def _evidence_ref(evidence_id: str, source_type: str, description: str) -> dict[str, Any]:
    return {"evidence_id": evidence_id, "source_type": source_type, "description": description}


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in meters between two lat/lon points."""
    R = 6_371_000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def check_arrival_time_verification(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    app_events = data.get("data_sources", {}).get("app_events", [])
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})
    chat_transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])

    arrival_time_str = trip_data.get("driver_arrival_time")
    if not arrival_time_str:
        return {
            "status": "MISSING",
            "description": "Driver arrival time is not recorded in trip data.",
            "evidence_refs": [],
            "details": {},
        }

    arrival_time = _parse_ts(arrival_time_str)
    if arrival_time is None:
        return {
            "status": "MISSING",
            "description": (
                f"Driver arrival time ('{arrival_time_str}') is not a valid timestamp "
                f"and cannot be verified."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    evidence_refs: list[dict[str, Any]] = []

    # App event check
    app_arrival = next((e for e in app_events if e.get("event_type") == "driver_arrived"), None)
    if app_arrival:
        app_ts = _parse_ts(app_arrival.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                app_arrival["evidence_id"],
                "APP_EVENT",
                f"App event driver_arrived at {app_arrival.get('timestamp')}",
            )
        )
        if app_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"App event driver_arrived has a malformed timestamp "
                    f"('{app_arrival.get('timestamp')}') and cannot be cross-verified "
                    f"against trip data driver_arrival_time ({arrival_time_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if app_ts != arrival_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip data driver_arrival_time ({arrival_time_str}) does not match "
                    f"app event timestamp ({app_arrival['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_arrival": arrival_time_str,
                    "app_arrival": app_arrival["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    # GPS check
    gps_arrival = next(
        (p for p in gps_telemetry.get("actual_route", []) if p.get("status") == "arrived"), None
    )
    if gps_arrival:
        gps_ts = _parse_ts(gps_arrival.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                gps_arrival["evidence_id"],
                "GPS_TELEMETRY",
                f"GPS arrival point at {gps_arrival.get('timestamp')}",
            )
        )
        if gps_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"GPS arrival point has a malformed timestamp "
                    f"('{gps_arrival.get('timestamp')}') and cannot be cross-verified "
                    f"against trip data driver_arrival_time ({arrival_time_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if gps_ts != arrival_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip data driver_arrival_time ({arrival_time_str}) does not match "
                    f"GPS arrival timestamp ({gps_arrival['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_arrival": arrival_time_str,
                    "gps_arrival": gps_arrival["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    # Chat check (first driver message)
    first_chat = next(
        (m for m in chat_transcript if m.get("sender") in ("driver", "DRIVER")), None
    )
    if first_chat:
        chat_ts = _parse_ts(first_chat.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                first_chat["message_id"],
                "CHAT_LOG",
                f"First driver chat message at {first_chat.get('timestamp')}",
            )
        )
        if chat_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"First driver chat message has a malformed timestamp "
                    f"('{first_chat.get('timestamp')}') and cannot be cross-verified "
                    f"against trip data driver_arrival_time ({arrival_time_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if chat_ts != arrival_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip data driver_arrival_time ({arrival_time_str}) does not match "
                    f"first driver chat timestamp ({first_chat['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_arrival": arrival_time_str,
                    "chat_arrival": first_chat["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    return {
        "status": "VERIFIED",
        "description": (
            f"Driver arrival time {arrival_time_str} is consistent across trip data, "
            f"app events, GPS telemetry, and chat records."
        ),
        "evidence_refs": evidence_refs,
        "details": {"arrival_time": arrival_time_str, "confidence_level": 1.0},
    }


def check_waiting_duration(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    arrival_str = trip_data.get("driver_arrival_time")
    cancellation_str = trip_data.get("cancellation_time")

    if not arrival_str or not cancellation_str:
        missing = []
        if not arrival_str:
            missing.append("driver_arrival_time")
        if not cancellation_str:
            missing.append("cancellation_time")
        return {
            "status": "MISSING",
            "description": f"Cannot calculate waiting duration: missing {', '.join(missing)}.",
            "evidence_refs": [],
            "details": {"missing_fields": missing},
        }

    arrival = _parse_ts(arrival_str)
    cancellation = _parse_ts(cancellation_str)
    duration_seconds = _seconds_between(cancellation, arrival)

    evidence_refs = [
        _evidence_ref("TRIP-DATA", "APP_EVENT", f"Trip data: arrival {arrival_str}, cancellation {cancellation_str}"),
    ]

    if duration_seconds is None:
        malformed = [f for f, v in (("driver_arrival_time", arrival), ("cancellation_time", cancellation)) if v is None]
        if malformed:
            reason = f"malformed value(s) for {', '.join(malformed)}"
        else:
            reason = (
                "driver_arrival_time and cancellation_time use incompatible timestamp "
                "representations (one timezone-aware, one timezone-naive)"
            )
        return {
            "status": "MISSING",
            "description": f"Cannot calculate waiting duration: {reason}.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"Actual driver waiting duration calculated as {duration_seconds} seconds "
            f"({duration_seconds // 60} minutes {duration_seconds % 60} seconds)."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "duration_seconds": duration_seconds,
            "arrival_time": arrival_str,
            "cancellation_time": cancellation_str,
            "party_relevance": "NEUTRAL",
            "confidence_level": 1.0,
        },
    }


def check_pickup_gps_consistency(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})

    pickup = trip_data.get("pickup_location")
    if not pickup:
        return {
            "status": "MISSING",
            "description": "Pickup location is missing from trip data.",
            "evidence_refs": [],
            "details": {},
        }

    actual_route = gps_telemetry.get("actual_route", [])
    if not actual_route:
        return {
            "status": "MISSING",
            "description": "GPS telemetry actual route is missing.",
            "evidence_refs": [],
            "details": {},
        }

    # Use the GPS point marked as "arrived" or the last point before "waiting"/"cancelled"
    arrival_point = next((p for p in actual_route if p.get("status") == "arrived"), None)
    if not arrival_point:
        # Fallback: last point with speed 0 before waiting/cancelled
        arrival_point = next(
            (p for p in reversed(actual_route) if p.get("speed_kmh", 0) == 0), actual_route[-1]
        )

    distance_m = haversine_distance(
        pickup["lat"], pickup["lng"], arrival_point["latitude"], arrival_point["longitude"]
    )

    evidence_refs = [
        _evidence_ref(
            "TRIP-DATA", "APP_EVENT", f"Trip pickup location: {pickup['name']} ({pickup['lat']}, {pickup['lng']})"
        ),
        _evidence_ref(
            arrival_point["evidence_id"],
            "GPS_TELEMETRY",
            f"GPS arrival point at {arrival_point['timestamp']} ({arrival_point['latitude']}, {arrival_point['longitude']})",
        ),
    ]

    # Default tolerance of 50 metres; callers may override via policy params if desired.
    tolerance_m = 50.0
    if distance_m <= tolerance_m:
        return {
            "status": "VERIFIED",
            "description": (
                f"GPS arrival point is within {distance_m:.1f} metres of the declared pickup location "
                f"(tolerance {tolerance_m:.0f} m)."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "distance_meters": round(distance_m, 2),
                "tolerance_meters": tolerance_m,
                "party_relevance": "NEUTRAL",
                "confidence_level": 1.0,
            },
        }

    return {
        "status": "DISPUTED",
        "description": (
            f"GPS arrival point is {distance_m:.1f} metres from the declared pickup location, "
            f"exceeding the {tolerance_m:.0f} m tolerance."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "distance_meters": round(distance_m, 2),
            "tolerance_meters": tolerance_m,
            "party_relevance": "NEUTRAL",
            "confidence_level": 1.0,
        },
    }


def check_communication_attempts(data: dict[str, Any]) -> dict[str, Any]:
    app_events = data.get("data_sources", {}).get("app_events", [])
    chat_transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])

    call_event = next((e for e in app_events if e.get("event_type") == "driver_called_rider"), None)
    call_chat = next(
        (m for m in chat_transcript if m.get("type") == "call" or "call" in m.get("content", "").lower()),
        None,
    )

    evidence_refs: list[dict[str, Any]] = []

    if call_event:
        evidence_refs.append(
            _evidence_ref(
                call_event["evidence_id"],
                "APP_EVENT",
                f"Driver call attempt at {call_event['timestamp']}: {call_event.get('details', '')}",
            )
        )
    if call_chat:
        evidence_refs.append(
            _evidence_ref(
                call_chat["message_id"],
                "CHAT_LOG",
                f"Chat call record at {call_chat['timestamp']}: {call_chat.get('content', '')}",
            )
        )

    if not call_event and not call_chat:
        return {
            "status": "MISSING",
            "description": "No driver communication attempt is recorded in app events or chat transcript.",
            "evidence_refs": [],
            "details": {},
        }

    if call_event and not call_chat:
        return {
            "status": "DISPUTED",
            "description": (
                "App event records a driver call attempt, but no matching call entry "
                "is found in the chat transcript."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 0.8},
        }

    if call_chat and not call_event:
        return {
            "status": "DISPUTED",
            "description": (
                "Chat transcript records a call, but no matching driver_called_rider "
                "app event is found."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 0.8},
        }

    # Both present — cross-check timestamps
    event_ts = _parse_ts(call_event.get("timestamp"))
    chat_ts = _parse_ts(call_chat.get("timestamp"))
    if event_ts is None or chat_ts is None:
        malformed_source = "the app event" if event_ts is None else "the chat record"
        return {
            "status": "DISPUTED",
            "description": (
                f"Driver call attempt has a malformed timestamp in {malformed_source} "
                f"and cannot be cross-verified."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }
    if event_ts != chat_ts:
        return {
            "status": "DISPUTED",
            "description": (
                f"Driver call attempt timestamps differ: app event at {call_event['timestamp']}, "
                f"chat record at {call_chat['timestamp']}."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "app_event_timestamp": call_event["timestamp"],
                "chat_timestamp": call_chat["timestamp"],
                "confidence_level": 1.0,
            },
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"Driver communication attempt verified: app event and chat record both timestamped "
            f"{call_event['timestamp']}."
        ),
        "evidence_refs": evidence_refs,
        "details": {"timestamp": call_event["timestamp"], "confidence_level": 1.0},
    }


def check_cancellation_timestamp(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    app_events = data.get("data_sources", {}).get("app_events", [])
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})
    chat_transcript = data.get("data_sources", {}).get("chat_communication", {}).get("transcript", [])

    cancellation_str = trip_data.get("cancellation_time")
    if not cancellation_str:
        return {
            "status": "MISSING",
            "description": "Cancellation timestamp is missing from trip data.",
            "evidence_refs": [],
            "details": {},
        }

    cancellation_time = _parse_ts(cancellation_str)
    if cancellation_time is None:
        return {
            "status": "MISSING",
            "description": (
                f"Cancellation timestamp ('{cancellation_str}') is not a valid timestamp "
                f"and cannot be verified."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    evidence_refs: list[dict[str, Any]] = []

    # App event check
    cancel_event = next(
        (e for e in app_events if e.get("event_type") == "cancellation_fee_applied"), None
    )
    if cancel_event:
        event_ts = _parse_ts(cancel_event.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                cancel_event["evidence_id"],
                "APP_EVENT",
                f"Cancellation fee applied at {cancel_event.get('timestamp')}",
            )
        )
        if event_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"App event cancellation_fee_applied has a malformed timestamp "
                    f"('{cancel_event.get('timestamp')}') and cannot be cross-verified "
                    f"against trip cancellation_time ({cancellation_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if event_ts != cancellation_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip cancellation_time ({cancellation_str}) does not match "
                    f"app event timestamp ({cancel_event['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_cancellation": cancellation_str,
                    "app_event_timestamp": cancel_event["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    # GPS check
    cancel_gps = next(
        (p for p in gps_telemetry.get("actual_route", []) if p.get("status") == "cancelled"), None
    )
    if cancel_gps:
        gps_ts = _parse_ts(cancel_gps.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                cancel_gps["evidence_id"],
                "GPS_TELEMETRY",
                f"GPS cancelled status at {cancel_gps.get('timestamp')}",
            )
        )
        if gps_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"GPS cancelled-status point has a malformed timestamp "
                    f"('{cancel_gps.get('timestamp')}') and cannot be cross-verified "
                    f"against trip cancellation_time ({cancellation_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if gps_ts != cancellation_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip cancellation_time ({cancellation_str}) does not match "
                    f"GPS cancellation timestamp ({cancel_gps['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_cancellation": cancellation_str,
                    "gps_timestamp": cancel_gps["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    # Chat system message check
    system_cancel = next(
        (
            m
            for m in chat_transcript
            if m.get("sender") in ("system", "SYSTEM") and "cancelled" in m.get("content", "").lower()
        ),
        None,
    )
    if system_cancel:
        chat_ts = _parse_ts(system_cancel.get("timestamp"))
        evidence_refs.append(
            _evidence_ref(
                system_cancel["message_id"],
                "CHAT_LOG",
                f"System cancellation message at {system_cancel.get('timestamp')}",
            )
        )
        if chat_ts is None:
            return {
                "status": "DISPUTED",
                "description": (
                    f"System cancellation chat message has a malformed timestamp "
                    f"('{system_cancel.get('timestamp')}') and cannot be cross-verified "
                    f"against trip cancellation_time ({cancellation_str})."
                ),
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        if chat_ts != cancellation_time:
            return {
                "status": "DISPUTED",
                "description": (
                    f"Trip cancellation_time ({cancellation_str}) does not match "
                    f"system chat timestamp ({system_cancel['timestamp']})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "trip_cancellation": cancellation_str,
                    "chat_timestamp": system_cancel["timestamp"],
                    "confidence_level": 1.0,
                },
            }

    return {
        "status": "VERIFIED",
        "description": (
            f"Cancellation timestamp {cancellation_str} is consistent across trip data, "
            f"app events, GPS telemetry, and chat records."
        ),
        "evidence_refs": evidence_refs,
        "details": {"cancellation_time": cancellation_str, "confidence_level": 1.0},
    }


def check_event_ordering(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    app_events = data.get("data_sources", {}).get("app_events", [])

    # Build timestamp lookup for app events (only entries that parse successfully)
    event_ts: dict[str, datetime] = {}
    event_to_evidence: dict[str, dict[str, Any]] = {}
    malformed: list[dict[str, Any]] = []
    for evt in app_events:
        raw_ts = evt.get("timestamp")
        if not raw_ts:
            continue
        parsed = _parse_ts(raw_ts)
        event_to_evidence[evt["event_type"]] = evt
        if parsed is None:
            malformed.append({"field": evt["event_type"], "evidence_id": evt.get("evidence_id"), "raw_value": raw_ts})
        else:
            event_ts[evt["event_type"]] = parsed

    # Also include trip-level timestamps
    for field in ("scheduled_time", "driver_arrival_time", "cancellation_time"):
        raw_ts = trip_data.get(field)
        if not raw_ts:
            continue
        parsed = _parse_ts(raw_ts)
        if parsed is None:
            malformed.append({"field": field, "evidence_id": "TRIP-DATA", "raw_value": raw_ts})
        else:
            event_ts[field] = parsed

    # Semantic ordering pairs (earlier_event, later_event)
    # Note: scheduled_time is NOT included as a lower bound for driver_arrival_time
    # because drivers may legitimately arrive before the scheduled pickup time.
    pairs = [
        ("driver_arrival_time", "cancellation_time"),
        ("booking_confirmed", "driver_assigned"),
        ("driver_assigned", "driver_en_route"),
        ("driver_en_route", "driver_arrived"),
        ("driver_arrived", "wait_timer_started"),
        ("wait_timer_started", "wait_timer_expired"),
        ("wait_timer_expired", "cancellation_fee_applied"),
        ("cancellation_fee_applied", "driver_released"),
        ("driver_arrived", "cancellation_fee_applied"),
    ]

    issues: list[str] = []
    evidence_refs: list[dict[str, Any]] = []

    for earlier, later in pairs:
        if earlier in event_ts and later in event_ts:
            out_of_order = _is_before(event_ts[later], event_ts[earlier])
            if out_of_order is None:
                issues.append(
                    f"{later} and {earlier} use incompatible timestamp representations "
                    f"(one timezone-aware, one timezone-naive) and cannot be ordered."
                )
                if earlier in event_to_evidence:
                    evidence_refs.append(
                        _evidence_ref(
                            event_to_evidence[earlier]["evidence_id"],
                            "APP_EVENT",
                            f"{earlier} at {event_ts[earlier].isoformat()}",
                        )
                    )
                if later in event_to_evidence:
                    evidence_refs.append(
                        _evidence_ref(
                            event_to_evidence[later]["evidence_id"],
                            "APP_EVENT",
                            f"{later} at {event_ts[later].isoformat()}",
                        )
                    )
                continue
            if out_of_order:
                issues.append(
                    f"{later} ({event_ts[later].isoformat()}) occurs before {earlier} ({event_ts[earlier].isoformat()})."
                )
                # Add evidence refs
                if earlier in event_to_evidence:
                    evidence_refs.append(
                        _evidence_ref(
                            event_to_evidence[earlier]["evidence_id"],
                            "APP_EVENT",
                            f"{earlier} at {event_ts[earlier].isoformat()}",
                        )
                    )
                else:
                    evidence_refs.append(
                        _evidence_ref("TRIP-DATA", "APP_EVENT", f"{earlier} at {event_ts[earlier].isoformat()}")
                    )
                if later in event_to_evidence:
                    evidence_refs.append(
                        _evidence_ref(
                            event_to_evidence[later]["evidence_id"],
                            "APP_EVENT",
                            f"{later} at {event_ts[later].isoformat()}",
                        )
                    )
                else:
                    evidence_refs.append(
                        _evidence_ref("TRIP-DATA", "APP_EVENT", f"{later} at {event_ts[later].isoformat()}")
                    )

    for item in malformed:
        issues.append(f"{item['field']} has a malformed timestamp ('{item['raw_value']}').")
        evidence_refs.append(
            _evidence_ref(
                item["evidence_id"] or "TRIP-DATA",
                "APP_EVENT",
                f"{item['field']} malformed timestamp ('{item['raw_value']}')",
            )
        )

    if issues:
        return {
            "status": "DISPUTED",
            "description": "Event ordering violations detected: " + "; ".join(issues),
            "evidence_refs": evidence_refs,
            "details": {"issues": issues, "confidence_level": 1.0},
        }

    # Add refs for verified chain
    for evt_type, ts in event_ts.items():
        if evt_type in event_to_evidence:
            evidence_refs.append(
                _evidence_ref(event_to_evidence[evt_type]["evidence_id"], "APP_EVENT", f"{evt_type} at {ts.isoformat()}")
            )
        else:
            evidence_refs.append(_evidence_ref("TRIP-DATA", "APP_EVENT", f"{evt_type} at {ts.isoformat()}"))

    return {
        "status": "VERIFIED",
        "description": "All recorded event timestamps follow a consistent chronological order.",
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_missing_gps_records(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    gps_telemetry = data.get("data_sources", {}).get("gps_telemetry", {})

    arrival_str = trip_data.get("driver_arrival_time")
    cancellation_str = trip_data.get("cancellation_time")
    actual_route = gps_telemetry.get("actual_route", [])

    if not arrival_str or not cancellation_str:
        return {
            "status": "MISSING",
            "description": "Cannot assess GPS completeness: arrival or cancellation time is missing.",
            "evidence_refs": [],
            "details": {},
        }

    if not actual_route:
        return {
            "status": "MISSING",
            "description": "GPS telemetry actual route is completely missing.",
            "evidence_refs": [],
            "details": {},
        }

    arrival = _parse_ts(arrival_str)
    cancellation = _parse_ts(cancellation_str)
    if arrival is None or cancellation is None:
        return {
            "status": "MISSING",
            "description": (
                "Cannot assess GPS completeness: arrival or cancellation time is not a "
                "valid timestamp."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    # Separate GPS points with a parseable timestamp from malformed ones.
    malformed_points = [p for p in actual_route if _parse_ts(p.get("timestamp")) is None]
    parseable_points = [p for p in actual_route if _parse_ts(p.get("timestamp")) is not None]

    if malformed_points:
        evidence_refs = [
            _evidence_ref(p["evidence_id"], "GPS_TELEMETRY", f"GPS point with malformed timestamp ('{p.get('timestamp')}')")
            for p in malformed_points
        ]
        return {
            "status": "DISPUTED",
            "description": (
                f"{len(malformed_points)} GPS point(s) have malformed timestamps and were "
                f"excluded from wait-period completeness analysis."
            ),
            "evidence_refs": evidence_refs,
            "details": {"malformed_point_count": len(malformed_points), "confidence_level": 1.0},
        }

    # Filter GPS points within the wait window. Points whose timestamp can't be
    # compared against arrival/cancellation (e.g. naive vs. aware) are reported
    # separately rather than silently dropped or crashing the comparison.
    wait_points: list[dict[str, Any]] = []
    incomparable_points: list[dict[str, Any]] = []
    for p in parseable_points:
        ts = _parse_ts(p["timestamp"])
        try:
            in_window = arrival <= ts <= cancellation
        except TypeError:
            incomparable_points.append(p)
            continue
        if in_window:
            wait_points.append(p)

    if incomparable_points:
        evidence_refs = [
            _evidence_ref(
                p["evidence_id"],
                "GPS_TELEMETRY",
                f"GPS point at {p['timestamp']} uses a timezone representation incompatible "
                f"with driver_arrival_time/cancellation_time",
            )
            for p in incomparable_points
        ]
        return {
            "status": "DISPUTED",
            "description": (
                f"{len(incomparable_points)} GPS point(s) use a timestamp representation "
                f"incompatible with driver_arrival_time/cancellation_time (timezone-aware vs. "
                f"timezone-naive) and could not be checked against the wait window."
            ),
            "evidence_refs": evidence_refs,
            "details": {"incomparable_point_count": len(incomparable_points), "confidence_level": 1.0},
        }

    evidence_refs = [
        _evidence_ref(p["evidence_id"], "GPS_TELEMETRY", f"GPS point at {p['timestamp']}")
        for p in wait_points
    ]

    if len(wait_points) < 2:
        return {
            "status": "MISSING",
            "description": (
                f"Only {len(wait_points)} GPS sample(s) recorded during the "
                f"entire wait period ({arrival_str} to {cancellation_str})."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "wait_period_points": len(wait_points),
                "party_relevance": "NEUTRAL",
                "confidence_level": 1.0,
            },
        }

    # Check for gaps > 120 seconds during wait period
    gaps: list[dict[str, Any]] = []
    for i in range(1, len(wait_points)):
        prev_ts = _parse_ts(wait_points[i - 1]["timestamp"])
        curr_ts = _parse_ts(wait_points[i]["timestamp"])
        gap_seconds = _seconds_between(curr_ts, prev_ts) or 0
        if gap_seconds > 120:
            gaps.append({
                "from": wait_points[i - 1]["timestamp"],
                "to": wait_points[i]["timestamp"],
                "gap_seconds": gap_seconds,
            })

    if gaps:
        return {
            "status": "MISSING",
            "description": (
                f"GPS coverage gaps detected during wait period: "
                f"{len(gaps)} gap(s) exceeding 120 seconds."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "gaps": gaps,
                "wait_period_points": len(wait_points),
                "party_relevance": "NEUTRAL",
                "confidence_level": 1.0,
            },
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"GPS records cover the wait period with {len(wait_points)} sample(s) "
            f"and no gaps exceeding 120 seconds."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "wait_period_points": len(wait_points),
            "party_relevance": "NEUTRAL",
            "confidence_level": 1.0,
        },
    }


def check_contradictory_timestamps(data: dict[str, Any]) -> dict[str, Any]:
    trip_data = data.get("data_sources", {}).get("trip_data", {})

    arrival_str = trip_data.get("driver_arrival_time")
    cancellation_str = trip_data.get("cancellation_time")
    scheduled_str = trip_data.get("scheduled_time")

    evidence_refs: list[dict[str, Any]] = []
    contradictions: list[str] = []

    arrival = _parse_ts(arrival_str) if arrival_str else None
    cancellation = _parse_ts(cancellation_str) if cancellation_str else None
    scheduled = _parse_ts(scheduled_str) if scheduled_str else None

    for field, raw, parsed in (
        ("driver_arrival_time", arrival_str, arrival),
        ("cancellation_time", cancellation_str, cancellation),
        ("scheduled_time", scheduled_str, scheduled),
    ):
        if raw and parsed is None:
            contradictions.append(f"{field} ('{raw}') is not a valid timestamp.")

    if arrival_str and cancellation_str:
        evidence_refs.append(
            _evidence_ref("TRIP-DATA", "APP_EVENT", f"Arrival {arrival_str}, cancellation {cancellation_str}")
        )
        arrival_after_cancellation = _is_before(cancellation, arrival)
        if arrival_after_cancellation is True:
            contradictions.append(
                f"Driver arrival time ({arrival_str}) is after cancellation time ({cancellation_str})."
            )

    if scheduled_str and cancellation_str:
        cancellation_before_scheduled = _is_before(cancellation, scheduled)
        if cancellation_before_scheduled is True:
            contradictions.append(
                f"Cancellation time ({cancellation_str}) is before scheduled pickup ({scheduled_str})."
            )

    if contradictions:
        return {
            "status": "DISPUTED",
            "description": "Contradictory timestamps detected: " + "; ".join(contradictions),
            "evidence_refs": evidence_refs,
            "details": {"contradictions": contradictions, "confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": "No contradictory timestamps detected across trip data fields.",
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_policy_eligibility(data: dict[str, Any]) -> dict[str, Any]:
    """Assess no-show fee eligibility against the backend-owned policy registry.

    Policy thresholds are never accepted as a parameter here — they come only
    from app.services.verification.policy.get_policy_params, keyed by the
    case's own dispute_type. There is no way for an API caller to influence
    this finding by supplying alternative numbers.
    """
    trip_data = data.get("data_sources", {}).get("trip_data", {})
    dispute_type = data.get("case_metadata", {}).get("dispute_type")

    arrival_str = trip_data.get("driver_arrival_time")
    cancellation_str = trip_data.get("cancellation_time")

    if not arrival_str or not cancellation_str:
        missing = []
        if not arrival_str:
            missing.append("driver_arrival_time")
        if not cancellation_str:
            missing.append("cancellation_time")
        return {
            "status": "MISSING",
            "description": f"Cannot assess policy eligibility: missing {', '.join(missing)}.",
            "evidence_refs": [],
            "details": {},
        }

    arrival = _parse_ts(arrival_str)
    cancellation = _parse_ts(cancellation_str)
    duration_seconds = _seconds_between(cancellation, arrival)

    evidence_refs = [
        _evidence_ref("TRIP-DATA", "APP_EVENT", f"Waiting duration ({arrival_str} to {cancellation_str})"),
    ]

    if duration_seconds is None:
        return {
            "status": "MISSING",
            "description": (
                "Cannot assess policy eligibility: driver_arrival_time and cancellation_time "
                "could not both be parsed as comparable timestamps."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    details: dict[str, Any] = {
        "duration_seconds": duration_seconds,
        "party_relevance": "NEUTRAL",
        "confidence_level": 1.0,
    }

    policy = get_policy_params(dispute_type)
    if policy is None:
        return {
            "status": "MISSING",
            "description": (
                f"No authoritative policy parameters are available for dispute type "
                f"'{dispute_type}'; policy eligibility cannot be assessed. Actual waiting "
                f"duration was {duration_seconds} seconds ({duration_seconds // 60} minutes)."
            ),
            "evidence_refs": evidence_refs,
            "details": details,
        }

    details["free_wait_period_seconds"] = policy.free_wait_period_seconds
    details["no_show_threshold_seconds"] = policy.no_show_threshold_seconds
    details["policy_clause_reference"] = f"{policy.source} v{policy.version}"

    if duration_seconds >= policy.no_show_threshold_seconds:
        return {
            "status": "VERIFIED",
            "description": (
                f"Actual waiting duration ({duration_seconds}s) meets or exceeds the "
                f"no-show threshold ({policy.no_show_threshold_seconds}s) per policy "
                f"{policy.source} v{policy.version}."
            ),
            "evidence_refs": evidence_refs,
            "details": details,
        }
    return {
        "status": "DISPUTED",
        "description": (
            f"Actual waiting duration ({duration_seconds}s) is less than the "
            f"no-show threshold ({policy.no_show_threshold_seconds}s) per policy "
            f"{policy.source} v{policy.version}. Cancellation fee may not be justified."
        ),
        "evidence_refs": evidence_refs,
        "details": details,
    }
