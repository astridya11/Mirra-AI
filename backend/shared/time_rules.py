"""Generic time / distance rule helpers shared by policy computation
(POL-4) and the verdict image caption.

Pure functions.  No policy names or numbers inside — every limit comes in
as a parameter.  Never raises on bad input; returns ``None`` / safe
defaults instead.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

SGT = timezone(timedelta(hours=8))

_EARTH_R_M = 6_371_000.0

# ---------------------------------------------------------------------------
# Timestamp parsing
# ---------------------------------------------------------------------------


def parse_ts(value: Any) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp from *value*.

    Accepts a ``str`` or an existing ``datetime``.  ``"Z"`` suffix is
    handled.  Naive datetimes are treated as SGT.  Returns ``None`` for
    invalid/``None`` input.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SGT)
    return dt


# ---------------------------------------------------------------------------
# Distance
# ---------------------------------------------------------------------------


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres between two lat/lng points."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * _EARTH_R_M * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Human-readable gap formatting
# ---------------------------------------------------------------------------


def format_gap(seconds: float) -> str:
    """Format a duration in seconds into a short human string.

    >>> format_gap(2700)      # "45 min"
    >>> format_gap(41100)     # "11 h 25 min"
    >>> format_gap(836394)    # "9 d 16 h"
    >>> format_gap(-600)      # "10 min before"

    Negative values produce ``"<text> before"``.
    """
    if seconds is None:
        return "not available"
    try:
        secs = float(seconds)
    except (TypeError, ValueError):
        return "not available"
    if not math.isfinite(secs):
        return "not available"

    before = secs < 0
    secs = abs(secs)
    total_min = int(secs // 60)
    total_hours = total_min // 60
    total_days = total_hours // 24

    if total_hours >= 48:
        d = total_days
        h = total_hours - d * 24
        text = f"{d} d {h} h"
    elif total_min >= 60:
        h = total_hours
        m = total_min - h * 60
        text = f"{h} h {m} min"
    else:
        text = f"{total_min} min"

    if before:
        return f"{text} before"
    return text


# ---------------------------------------------------------------------------
# Policy params
# ---------------------------------------------------------------------------

_DEFAULT_POLICY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "policy",
    "ryde_policy_v1.json",
)
_POLICY_PATH = os.environ.get("POLICY_FILE_PATH", _DEFAULT_POLICY_PATH)

_policy_cache: Optional[Dict[str, Any]] = None


def _load_policy_json() -> Dict[str, Any]:
    global _policy_cache
    if _policy_cache is None:
        try:
            with open(_POLICY_PATH, "r", encoding="utf-8") as f:
                _policy_cache = json.load(f)
        except Exception:
            _policy_cache = {}
    return _policy_cache


def policy_params(clause_id: str, defaults: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return the *clause_id* params from ryde_policy_v1.json.

    Missing keys are filled from *defaults*.  Never raises — returns
    *defaults* (or ``{}``) on any error.
    """
    result: Dict[str, Any] = {}
    if defaults:
        result.update(defaults)
    try:
        policy = _load_policy_json()
        clause = (policy.get("clauses") or {}).get(clause_id) or {}
        params = clause.get("params") or {}
        if isinstance(params, dict):
            for k, v in params.items():
                result[k] = v
    except Exception:
        pass
    return result


# ---------------------------------------------------------------------------
# Trip end time
# ---------------------------------------------------------------------------


def trip_end_time(data_sources: Dict[str, Any]) -> Optional[datetime]:
    """Best-effort trip-end timestamp from *data_sources*.

    Order: ``trip_data.trip_end_time`` → ``trip_data.dropoff_time`` →
    the ``trip_completed`` app_event timestamp.
    """
    if not isinstance(data_sources, dict):
        return None
    trip = data_sources.get("trip_data") or {}
    if not isinstance(trip, dict):
        trip = {}
    dt = parse_ts(trip.get("trip_end_time"))
    if dt is not None:
        return dt
    dt = parse_ts(trip.get("dropoff_time"))
    if dt is not None:
        return dt
    # Fallback: trip_completed app_event
    events = data_sources.get("app_events") or []
    if isinstance(events, list):
        for ev in events:
            if not isinstance(ev, dict):
                continue
            etype = str(ev.get("event_type", "")).lower()
            if "trip_completed" in etype or "trip_ended" in etype:
                dt = parse_ts(ev.get("timestamp") or ev.get("time") or ev.get("created_at"))
                if dt is not None:
                    return dt
    return None


# ---------------------------------------------------------------------------
# Window check
# ---------------------------------------------------------------------------

_UNIT_TO_SECONDS = {
    "seconds": 1,
    "minutes": 60,
    "hours": 3600,
}


def check_window(
    event_ts: Any,
    anchor_ts: Any,
    *,
    max_after: Optional[float] = None,
    min_after: float = 0,
    unit: str = "hours",
) -> Dict[str, Any]:
    """Check whether *event_ts* is within a time window after *anchor_ts*.

    Args:
        event_ts: Event timestamp (str/datetime/None).
        anchor_ts: Anchor timestamp (str/datetime/None).
        max_after: Maximum allowed gap in *unit*.  ``None`` = no upper limit.
        min_after: Minimum required gap in *unit* (default 0).
        unit: One of ``"seconds"``, ``"minutes"``, ``"hours"``.

    Returns:
        ``{"seconds": int|None, "text": str, "within": bool|None, "limit_text": str|None}``

        *within* is ``None`` when either timestamp is missing.
    """
    factor = _UNIT_TO_SECONDS.get(unit)
    if factor is None:
        factor = 3600  # default to hours

    ev = parse_ts(event_ts)
    anc = parse_ts(anchor_ts)

    if ev is None or anc is None:
        return {
            "seconds": None,
            "text": "not available",
            "within": None,
            "limit_text": _format_limit(max_after, unit),
        }

    gap_secs = int((ev - anc).total_seconds())
    within: Optional[bool]
    if max_after is not None:
        within = (gap_secs >= min_after * factor) and (gap_secs <= max_after * factor)
    else:
        within = gap_secs >= min_after * factor

    return {
        "seconds": gap_secs,
        "text": format_gap(gap_secs),
        "within": within,
        "limit_text": _format_limit(max_after, unit),
    }


def _format_limit(value: Optional[float], unit: str) -> Optional[str]:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if unit == "seconds":
        return f"{int(v)} s"
    elif unit == "minutes":
        return f"{int(v)} min"
    else:
        return f"{int(v)} h"


# ---------------------------------------------------------------------------
# Distance check
# ---------------------------------------------------------------------------


def _extract_lat_lng(point: Any) -> tuple[Optional[float], Optional[float]]:
    """Extract (lat, lng) from a dict accepting either key convention."""
    if not isinstance(point, dict):
        return None, None
    lat = point.get("latitude")
    lng = point.get("longitude")
    if lat is None:
        lat = point.get("lat")
    if lng is None:
        lng = point.get("lng")
    try:
        lat_f = float(lat) if lat is not None else None
        lng_f = float(lng) if lng is not None else None
    except (TypeError, ValueError):
        return None, None
    if lat_f is not None and not math.isfinite(lat_f):
        lat_f = None
    if lng_f is not None and not math.isfinite(lng_f):
        lng_f = None
    return lat_f, lng_f


def _format_distance(metres: float) -> str:
    """Format metres as "0 m" / "850 m" / "1.2 km" (rounded to 10 m)."""
    rounded = int(round(metres / 10) * 10)
    if rounded < 1000:
        return f"{rounded} m"
    km = rounded / 1000
    return f"{km:.1f} km"


def check_distance(
    point: Any,
    target: Any,
    *,
    max_m: Optional[float] = None,
) -> Dict[str, Any]:
    """Check whether *point* is within *max_m* metres of *target*.

    Each accepts ``{"latitude","longitude"}`` or ``{"lat","lng"}``.

    Returns:
        ``{"meters": float|None, "text": str, "within": bool|None, "limit_text": str|None}``
    """
    plat, plng = _extract_lat_lng(point)
    tlat, tlng = _extract_lat_lng(target)

    if plat is None or plng is None or tlat is None or tlng is None:
        return {
            "meters": None,
            "text": "not available",
            "within": None,
            "limit_text": f"{int(max_m)} m" if max_m is not None else None,
        }

    dist = haversine_m(plat, plng, tlat, tlng)
    within: Optional[bool]
    if max_m is not None:
        within = dist <= max_m
    else:
        within = None

    limit_text = f"{int(max_m)} m" if max_m is not None else None

    return {
        "meters": dist,
        "text": _format_distance(dist),
        "within": within,
        "limit_text": limit_text,
    }
