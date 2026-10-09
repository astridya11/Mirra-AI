"""Standalone tests for backend/shared/time_rules.py.

No network.  Temp dir only.  Plain script style.

Run:
    python -m backend.tests.test_time_rules
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

# --- Path setup -------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))

from backend.shared.time_rules import (  # noqa: E402
    SGT,
    parse_ts,
    haversine_m,
    format_gap,
    policy_params,
    trip_end_time,
    check_window,
    check_distance,
)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    # ===================================================================
    # CHECK a: format_gap
    # ===================================================================
    print("=" * 70)
    print("CHECK a: format_gap")
    print("=" * 70)
    check_a_errors: list[str] = []

    cases = [
        (2700, "45 min"),
        (41100, "11 h 25 min"),
        (836394, "9 d 16 h"),
        (-600, "10 min before"),
    ]
    for secs, expected in cases:
        got = format_gap(secs)
        if got != expected:
            check_a_errors.append(f"format_gap({secs}): got {got!r}, expected {expected!r}")

    if check_a_errors:
        print("\nCHECK a RESULT: FAIL")
        for e in check_a_errors:
            print(f"  - {e}")
        errors.extend(check_a_errors)
    else:
        print("\nCHECK a RESULT: PASS")
        for secs, expected in cases:
            print(f"  - format_gap({secs}) = {format_gap(secs)!r}")

    # ===================================================================
    # CHECK b: naive vs +08:00 timestamps compare correctly
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK b: naive vs +08:00 timestamps compare correctly")
    print("=" * 70)
    check_b_errors: list[str] = []

    dt_naive = parse_ts("2026-09-25T22:05:00")
    dt_tz = parse_ts("2026-09-25T22:05:00+08:00")
    if dt_naive is None:
        check_b_errors.append("parse_ts(naive) returned None")
    elif dt_naive.tzinfo is None:
        check_b_errors.append("parse_ts(naive) did not add SGT tzinfo")
    if dt_tz is None:
        check_b_errors.append("parse_ts(+08:00) returned None")

    if dt_naive is not None and dt_tz is not None:
        if dt_naive != dt_tz:
            check_b_errors.append(
                f"naive != +08:00: {dt_naive!r} vs {dt_tz!r}"
            )

    # Also test "Z" suffix
    dt_z = parse_ts("2026-09-25T14:05:00Z")
    if dt_z is None:
        check_b_errors.append("parse_ts(Z) returned None")
    elif dt_naive is not None and dt_z != dt_naive:
        check_b_errors.append(
            f"Z != naive+SGT: {dt_z!r} vs {dt_naive!r}"
        )

    if check_b_errors:
        print("\nCHECK b RESULT: FAIL")
        for e in check_b_errors:
            print(f"  - {e}")
        errors.extend(check_b_errors)
    else:
        print("\nCHECK b RESULT: PASS")
        print(f"  - naive: {dt_naive!r}")
        print(f"  - +08:00: {dt_tz!r}")
        print(f"  - Z:     {dt_z!r}")

    # ===================================================================
    # CHECK c: check_window hours
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK c: check_window hours")
    print("=" * 70)
    check_c_errors: list[str] = []

    anchor = "2026-09-25T22:05:00+08:00"

    # 11 h 25 min later -> within 24 h
    ev1 = "2026-09-26T09:30:00+08:00"
    w1 = check_window(ev1, anchor, max_after=24, unit="hours")
    if w1["within"] is not True:
        check_c_errors.append(f"11h25m, max 24h: within={w1['within']}, expected True")
    if "11 h" not in w1["text"]:
        check_c_errors.append(f"11h25m text: got {w1['text']!r}")

    # 30 h later -> outside 24 h
    ev2 = "2026-09-27T04:05:00+08:00"
    w2 = check_window(ev2, anchor, max_after=24, unit="hours")
    if w2["within"] is not False:
        check_c_errors.append(f"30h, max 24h: within={w2['within']}, expected False")

    # Event before anchor -> False
    ev3 = "2026-09-25T20:00:00+08:00"
    w3 = check_window(ev3, anchor, max_after=24, unit="hours")
    if w3["within"] is not False:
        check_c_errors.append(f"before anchor: within={w3['within']}, expected False")
    if "before" not in w3["text"]:
        check_c_errors.append(f"before anchor text: got {w3['text']!r}")

    if check_c_errors:
        print("\nCHECK c RESULT: FAIL")
        for e in check_c_errors:
            print(f"  - {e}")
        errors.extend(check_c_errors)
    else:
        print("\nCHECK c RESULT: PASS")
        print(f"  - 11h25m/24h: within={w1['within']}, text={w1['text']!r}")
        print(f"  - 30h/24h:    within={w2['within']}")
        print(f"  - before:      within={w3['within']}, text={w3['text']!r}")

    # ===================================================================
    # CHECK d: check_window minutes
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK d: check_window minutes")
    print("=" * 70)
    check_d_errors: list[str] = []

    # 10 min after -> within 30
    ev4 = "2026-09-25T22:15:00+08:00"
    w4 = check_window(ev4, anchor, max_after=30, unit="minutes")
    if w4["within"] is not True:
        check_d_errors.append(f"10min/30min: within={w4['within']}, expected True")

    # 45 min after -> outside 30
    ev5 = "2026-09-25T22:50:00+08:00"
    w5 = check_window(ev5, anchor, max_after=30, unit="minutes")
    if w5["within"] is not False:
        check_d_errors.append(f"45min/30min: within={w5['within']}, expected False")

    # min_after respected: 5 min, min_after=10 -> False
    ev6 = "2026-09-25T22:10:00+08:00"
    w6 = check_window(ev6, anchor, max_after=30, min_after=10, unit="minutes")
    if w6["within"] is not False:
        check_d_errors.append(f"5min, min_after=10: within={w6['within']}, expected False")

    if check_d_errors:
        print("\nCHECK d RESULT: FAIL")
        for e in check_d_errors:
            print(f"  - {e}")
        errors.extend(check_d_errors)
    else:
        print("\nCHECK d RESULT: PASS")
        print(f"  - 10min/30min: within={w4['within']}")
        print(f"  - 45min/30min: within={w5['within']}")
        print(f"  - 5min,min_after=10: within={w6['within']}")

    # ===================================================================
    # CHECK e: check_distance
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK e: check_distance")
    print("=" * 70)
    check_e_errors: list[str] = []

    # Same point -> 0 m, True
    pt = {"latitude": 1.3508, "longitude": 103.8485}
    d1 = check_distance(pt, pt, max_m=500)
    if d1["within"] is not True:
        check_e_errors.append(f"same point: within={d1['within']}, expected True")
    if d1["text"] != "0 m":
        check_e_errors.append(f"same point text: got {d1['text']!r}, expected '0 m'")

    # ~900 m, max 500 -> False
    far = {"latitude": 1.3508 + 0.008, "longitude": 103.8485}
    d2 = check_distance(pt, far, max_m=500)
    if d2["within"] is not False:
        check_e_errors.append(f"~900m/500m: within={d2['within']}, expected False")
    if "m" not in d2["text"]:
        check_e_errors.append(f"~900m text: got {d2['text']!r}")

    # {lat,lng} and {latitude,longitude} both work
    pt_latlng = {"lat": 1.3508, "lng": 103.8485}
    d3 = check_distance(pt_latlng, pt, max_m=500)
    if d3["within"] is not True:
        check_e_errors.append(f"lat/lng vs latitude/longitude: within={d3['within']}, expected True")

    # Missing point -> within None
    d4 = check_distance(None, pt, max_m=500)
    if d4["within"] is not None:
        check_e_errors.append(f"missing point: within={d4['within']}, expected None")

    if check_e_errors:
        print("\nCHECK e RESULT: FAIL")
        for e in check_e_errors:
            print(f"  - {e}")
        errors.extend(check_e_errors)
    else:
        print("\nCHECK e RESULT: PASS")
        print(f"  - same point: {d1['text']}, within={d1['within']}")
        print(f"  - ~900m:      {d2['text']}, within={d2['within']}")
        print(f"  - lat/lng:     within={d3['within']}")
        print(f"  - missing:    within={d4['within']}")

    # ===================================================================
    # CHECK f: policy_params("POL-4")
    # ===================================================================
    print("\n" + "=" * 70)
    print('CHECK f: policy_params("POL-4")')
    print("=" * 70)
    check_f_errors: list[str] = []

    p = policy_params("POL-4")
    for key in (
        "claim_filing_window_hours",
        "receipt_window_hours_after_trip_end",
        "photo_window_min_after_trip_end",
        "photo_location_radius_m",
    ):
        if key not in p:
            check_f_errors.append(f"missing key {key!r} in POL-4 params: {p}")

    # Unknown clause -> defaults
    defaults = {"foo": 42}
    p2 = policy_params("POL-UNKNOWN", defaults=defaults)
    if p2.get("foo") != 42:
        check_f_errors.append(f"unknown clause defaults: got {p2!r}")

    if check_f_errors:
        print("\nCHECK f RESULT: FAIL")
        for e in check_f_errors:
            print(f"  - {e}")
        errors.extend(check_f_errors)
    else:
        print("\nCHECK f RESULT: PASS")
        print(f"  - POL-4 params keys: {sorted(p.keys())}")
        print(f"  - unknown clause defaults: {p2}")

    # ===================================================================
    # CHECK g: trip_end_time falls back to trip_completed app event
    # ===================================================================
    print("\n" + "=" * 70)
    print("CHECK g: trip_end_time falls back to trip_completed app event")
    print("=" * 70)
    check_g_errors: list[str] = []

    # No trip_end_time, no dropoff_time, but trip_completed app_event
    ds = {
        "trip_data": {
            "trip_id": "TRIP-TEST",
            "pickup_location": {"name": "A", "lat": 1.0, "lng": 103.0},
            "dropoff_location": {"name": "B", "lat": 1.1, "lng": 103.1},
        },
        "app_events": [
            {"event_type": "trip_started", "timestamp": "2026-09-25T21:40:00+08:00"},
            {"event_type": "trip_completed", "timestamp": "2026-09-25T22:05:00+08:00"},
        ],
    }
    te = trip_end_time(ds)
    if te is None:
        check_g_errors.append("trip_end_time returned None for trip_completed fallback")
    elif te.isoformat() != "2026-09-25T22:05:00+08:00":
        check_g_errors.append(f"trip_end_time: got {te.isoformat()!r}")

    # With trip_end_time -> uses that directly
    ds2 = dict(ds)
    ds2["trip_data"] = dict(ds["trip_data"])
    ds2["trip_data"]["trip_end_time"] = "2026-09-25T22:10:00+08:00"
    te2 = trip_end_time(ds2)
    if te2 is None or te2.isoformat() != "2026-09-25T22:10:00+08:00":
        check_g_errors.append(f"trip_end_time with trip_end_time: got {te2!r}")

    if check_g_errors:
        print("\nCHECK g RESULT: FAIL")
        for e in check_g_errors:
            print(f"  - {e}")
        errors.extend(check_g_errors)
    else:
        print("\nCHECK g RESULT: PASS")
        print(f"  - fallback: {te.isoformat()}")
        print(f"  - direct:   {te2.isoformat()}")

    # ===================================================================
    # Summary
    # ===================================================================
    if errors:
        print("\n" + "=" * 70)
        print("SOME CHECKS FAILED")
        print("=" * 70)
        sys.exit(1)
    else:
        print("\n" + "=" * 70)
        print("ALL TESTS PASSED")
        print("=" * 70)


if __name__ == "__main__":
    main()
