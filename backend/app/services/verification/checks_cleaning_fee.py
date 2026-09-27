"""Deterministic CLEANING_FEE evidence checks.

Mirrors the style of checks.py and checks_route_deviation.py: every function
reads data_sources safely, never raises, and degrades to MISSING/DISPUTED on
malformed input rather than crashing. These checks establish evidence facts
only — they never conclude intent, fault, policy violation, or liability.
"""

import math
import re
from typing import Any

from .checks import _evidence_ref, _is_before, _parse_ts, _seconds_between
from .image_analysis import extract_images_from_context

_CLEANING_RELEVANT_TERMS = frozenset(
    {
        "clean",
        "cleaning",
        "mess",
        "dirty",
        "vomit",
        "vomited",
        "spill",
        "spilled",
        "stain",
        "stained",
        "seat",
        "backseat",
    }
)

# Also match "back seat" as a two-word phrase via simple scan.
_CLEANING_PHRASES = frozenset({"back seat"})

_RIDER_DENIAL_MARKERS = frozenset(
    {
        "did not",
        "didn't",
        "didnt",
        "never",
        "not me",
        "was not",
        "wasn't",
        "wasnt",
        "no mess",
        "no spill",
        "did not spill",
        "didn't spill",
        "did not vomit",
        "didn't vomit",
        "never vomited",
    }
)

# Pre-compile word-boundary regexes so "never" inside "whenever" does not match.
_RIDER_DENIAL_PATTERNS = [
    re.compile(r"\b" + re.escape(marker) + r"\b") for marker in _RIDER_DENIAL_MARKERS
]

# Currency-qualified amount patterns only.  Bare numbers such as "1 photo"
# or "85 minutes" must NOT be treated as claim amounts.
_CURRENCY_AMOUNT_RE = re.compile(
    r"(?:"
    r"\$\s*(\d+(?:\.\d{1,2})?)"          # $100  $100.00
    r"|"
    r"sgd\s+(\d+(?:\.\d{1,2})?)"         # SGD 100  SGD 100.00
    r"|"
    r"(\d+(?:\.\d{1,2})?)\s+sgd"         # 100 SGD  100.00 SGD
    r")",
    re.IGNORECASE,
)

_PHOTO_NEGATION_PATTERNS = [
    re.compile(r"\bno\s+(?:photo|image|picture)s?\b"),
    re.compile(r"\bwithout\s+(?:a\s+)?(?:photo|image|picture)s?\b"),
    re.compile(r"\b(?:photo|image|picture)s?\s+(?:was\s+)?not\s+(?:attached|uploaded|provided|submitted)\b"),
    re.compile(r"\bdid\s+not\s+(?:attach|upload|provide|submit)\b"),
    re.compile(r"\bnot\s+(?:attached|uploaded|provided|submitted)\b"),
]

_PHOTO_POSITIVE_PATTERNS = [
    re.compile(r"\b(?:photo|image|picture)s?\s+(?:attached|uploaded|provided|submitted)\b"),
    re.compile(r"\b(?:attached|uploaded|provided|submitted)\s+(?:\w+\s+)?(?:photo|image|picture)s?\b"),
    re.compile(r"\b\d+\s+(?:photo|image|picture)s?\s+(?:attached|uploaded|provided|submitted)\b"),
]


def _is_number(value: Any) -> bool:
    """A value counts as numeric only if it is a real, finite int/float.

    bool is rejected (bool is a subclass of int in Python). NaN and
    +/-Infinity are rejected.
    """
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _is_cleaning_relevant(text: str) -> bool:
    """Whether text contains at least one cleaning-related term."""
    if not isinstance(text, str):
        return False
    normalized = "".join(c.lower() if c.isalnum() else " " for c in text)
    tokens = set(normalized.split())
    if tokens & _CLEANING_RELEVANT_TERMS:
        return True
    lower_text = text.lower()
    for phrase in _CLEANING_PHRASES:
        if phrase in lower_text:
            return True
    return False


def _is_rider_denial(text: str) -> bool:
    """Whether a rider message contains a deterministic denial / contradiction marker."""
    if not isinstance(text, str):
        return False
    lower_text = text.lower()
    for pattern in _RIDER_DENIAL_PATTERNS:
        if pattern.search(lower_text):
            return True
    return False


def _find_cleaning_claim_event(data: dict[str, Any]) -> dict[str, Any] | None:
    app_events = data.get("data_sources", {}).get("app_events", [])
    if not isinstance(app_events, list):
        return None
    return next(
        (
            e
            for e in app_events
            if isinstance(e, dict) and e.get("event_type") == "cleaning_fee_claimed"
        ),
        None,
    )


def _parse_claim_amount_from_event(event: dict[str, Any]) -> float | None:
    """Extract a finite numeric amount from a cleaning_fee_claimed event.

    Tries event["amount"] first, then falls back to conservative parsing of
    event["details"]. Only currency-qualified amounts ($100, SGD 100, 100 SGD)
    are accepted. Returns None if no safe finite number is found, or if
    multiple conflicting currency amounts are present.
    """
    raw_amount = event.get("amount")
    if _is_number(raw_amount):
        return float(raw_amount)

    details = event.get("details", "")
    if not isinstance(details, str):
        return None

    amounts: set[float] = set()
    for match in _CURRENCY_AMOUNT_RE.finditer(details):
        amount_str = match.group(1) or match.group(2) or match.group(3)
        if amount_str:
            try:
                val = float(amount_str)
                if math.isfinite(val):
                    amounts.add(val)
            except ValueError:
                continue

    if len(amounts) == 1:
        return amounts.pop()
    return None


def _event_mentions_photo(event: dict[str, Any] | None) -> bool:
    """Whether the event details positively indicate a photo was attached/uploaded.

    Negation-blind: returns False for "no photo attached", "without a photo", etc.
    """
    if event is None:
        return False
    details = event.get("details", "")
    if not isinstance(details, str):
        return False
    lower_details = details.lower()

    for pattern in _PHOTO_NEGATION_PATTERNS:
        if pattern.search(lower_details):
            return False

    for pattern in _PHOTO_POSITIVE_PATTERNS:
        if pattern.search(lower_details):
            return True

    return False


def check_cleaning_claim_event_exists(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a cleaning-fee claim event is recorded in app events.

    Must NOT conclude: claim valid, rider responsible, fee justified.
    """
    event = _find_cleaning_claim_event(data)
    if event is None:
        return {
            "status": "MISSING",
            "description": "No cleaning-fee claim event is recorded in the app event history.",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = [
        _evidence_ref(
            event.get("evidence_id", "EVT-???"),
            "APP_EVENT",
            f"cleaning_fee_claimed at {event.get('timestamp', '?')}: {event.get('details', '')}",
        )
    ]

    ts = event.get("timestamp")
    if not ts or _parse_ts(ts) is None:
        return {
            "status": "DISPUTED",
            "description": (
                f"A cleaning-fee claim event is recorded, but its timestamp "
                f"('{ts}') is malformed and cannot be used for verification."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": "A cleaning-fee claim is recorded in the app event history.",
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_cleaning_claim_amount_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the cleaning-fee claim amount matches the disputed amount.

    Must NOT conclude: "$100 is fair" or "$100 is allowed by policy".
    """
    event = _find_cleaning_claim_event(data)
    payment = data.get("data_sources", {}).get("payment_fare_data", {})
    if not isinstance(payment, dict):
        payment = {}

    event_amount = _parse_claim_amount_from_event(event) if event else None
    disputed_amount = payment.get("disputed_amount")
    disputed_currency = payment.get("disputed_amount_currency", "")

    evidence_refs: list[dict[str, Any]] = []
    if event:
        evidence_refs.append(
            _evidence_ref(
                event.get("evidence_id", "EVT-???"),
                "APP_EVENT",
                f"cleaning_fee_claimed at {event.get('timestamp', '?')}: {event.get('details', '')}",
            )
        )

    if _is_number(disputed_amount):
        evidence_refs.append(
            _evidence_ref(
                "PAYMENT-DATA",
                "PAYMENT_RECORD",
                f"disputed amount {disputed_amount} {disputed_currency}".strip(),
            )
        )

    if event_amount is None:
        return {
            "status": "MISSING",
            "description": (
                "The cleaning-fee claim amount cannot be safely parsed from the claim event."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if not _is_number(disputed_amount):
        return {
            "status": "MISSING",
            "description": (
                "The disputed amount in payment data is missing or malformed."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # Use exact float comparison for the real fixture ($100 vs 100.0)
    if event_amount != disputed_amount:
        return {
            "status": "DISPUTED",
            "description": (
                f"The cleaning-fee claim amount ({event_amount}) does not match "
                f"the recorded disputed amount ({disputed_amount} {disputed_currency})."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "claim_amount": event_amount,
                "disputed_amount": disputed_amount,
                "confidence_level": 1.0,
            },
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"The cleaning-fee claim amount is consistent with the recorded disputed amount "
            f"of {disputed_currency} {disputed_amount:.2f}."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "amount": event_amount,
            "currency": disputed_currency,
            "confidence_level": 1.0,
        },
    }


def check_cleaning_claim_submission_delay(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the cleaning-fee claim was submitted after trip completion.

    Reports the exact arithmetic delta. Must NOT conclude that any delay is
    suspicious or violates policy.
    """
    ds = data.get("data_sources", {})
    app_events = ds.get("app_events", [])
    if not isinstance(app_events, list):
        app_events = []

    trip_complete_event = next(
        (
            e
            for e in app_events
            if isinstance(e, dict) and e.get("event_type") == "trip_completed"
        ),
        None,
    )
    cleaning_event = _find_cleaning_claim_event(data)

    evidence_refs: list[dict[str, Any]] = []

    if trip_complete_event:
        evidence_refs.append(
            _evidence_ref(
                trip_complete_event.get("evidence_id", "EVT-???"),
                "APP_EVENT",
                f"trip_completed at {trip_complete_event.get('timestamp', '?')}",
            )
        )
    if cleaning_event:
        evidence_refs.append(
            _evidence_ref(
                cleaning_event.get("evidence_id", "EVT-???"),
                "APP_EVENT",
                f"cleaning_fee_claimed at {cleaning_event.get('timestamp', '?')}",
            )
        )

    if trip_complete_event is None or cleaning_event is None:
        missing = []
        if trip_complete_event is None:
            missing.append("trip_completed")
        if cleaning_event is None:
            missing.append("cleaning_fee_claimed")
        return {
            "status": "MISSING",
            "description": (
                f"Cannot calculate claim submission delay: missing {', '.join(missing)} event."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    trip_ts = _parse_ts(trip_complete_event.get("timestamp"))
    claim_ts = _parse_ts(cleaning_event.get("timestamp"))

    if trip_ts is None or claim_ts is None:
        malformed = []
        if trip_ts is None:
            malformed.append("trip_completed")
        if claim_ts is None:
            malformed.append("cleaning_fee_claimed")
        return {
            "status": "MISSING",
            "description": (
                f"Cannot calculate claim submission delay: malformed timestamp(s) for {', '.join(malformed)}."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    before_completion = _is_before(claim_ts, trip_ts)
    if before_completion is None:
        return {
            "status": "MISSING",
            "description": (
                "Trip completion and cleaning-fee claim timestamps use incompatible "
                "representations and cannot be compared."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    delta_seconds = _seconds_between(claim_ts, trip_ts)
    if delta_seconds is None:
        return {
            "status": "MISSING",
            "description": (
                "Cannot calculate claim submission delay: timestamps are not comparable."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if before_completion:
        return {
            "status": "DISPUTED",
            "description": (
                f"The cleaning-fee claim timestamp ({cleaning_event.get('timestamp')}) "
                f"is before the trip completion timestamp ({trip_complete_event.get('timestamp')})."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    delta_minutes = delta_seconds // 60
    return {
        "status": "VERIFIED",
        "description": (
            f"The cleaning-fee claim was submitted {delta_seconds} seconds "
            f"({delta_minutes} minutes) after trip completion."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "delta_seconds": delta_seconds,
            "delta_minutes": delta_minutes,
            "confidence_level": 1.0,
        },
    }


def check_cleaning_conflicting_party_accounts(data: dict[str, Any]) -> dict[str, Any]:
    """Whether conflicting party accounts regarding the cleaning incident exist.

    Must NOT determine who is telling the truth.
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
            and _is_cleaning_relevant(m["content"])
        ),
        None,
    )

    rider_denial_msgs = [
        m
        for m in transcript
        if isinstance(m, dict)
        and m.get("sender") in ("rider", "RIDER")
        and isinstance(m.get("content"), str)
        and m.get("content").strip()
        and _is_cleaning_relevant(m["content"])
        and _is_rider_denial(m["content"])
    ]
    rider_msg = rider_denial_msgs[0] if rider_denial_msgs else None

    evidence_refs: list[dict[str, Any]] = []
    if driver_msg:
        evidence_refs.append(
            _evidence_ref(
                driver_msg.get("message_id", "MSG-???"),
                "CHAT_LOG",
                f"driver message at {driver_msg.get('timestamp', '?')}",
            )
        )
    if rider_msg:
        evidence_refs.append(
            _evidence_ref(
                rider_msg.get("message_id", "MSG-???"),
                "CHAT_LOG",
                f"rider message at {rider_msg.get('timestamp', '?')}",
            )
        )

    if driver_msg and rider_msg:
        return {
            "status": "VERIFIED",
            "description": "Conflicting party accounts regarding the cleaning incident are recorded in the chat transcript.",
            "evidence_refs": evidence_refs,
            "details": {"party_relevance": "BOTH", "confidence_level": 1.0},
        }

    missing_side = []
    if driver_msg is None:
        missing_side.append("driver allegation")
    if rider_msg is None:
        missing_side.append("rider denial")

    return {
        "status": "MISSING",
        "description": (
            f"Relevant conflicting party accounts are incomplete: missing {', '.join(missing_side)}."
        ),
        "evidence_refs": evidence_refs,
        "details": {"party_relevance": "BOTH", "confidence_level": 1.0},
    }


def check_cleaning_structured_image_evidence(data: dict[str, Any]) -> dict[str, Any]:
    """Whether structured image evidence is available in the frozen record.

    Must NOT claim image authenticity or perform EXIF analysis.
    """
    ds = data.get("data_sources", {})
    image_evidence = ds.get("image_evidence")

    if image_evidence is None:
        return {
            "status": "MISSING",
            "description": (
                "The frozen structured evidence record does not contain verifiable image "
                "evidence for the cleaning-fee claim."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    if not isinstance(image_evidence, list):
        return {
            "status": "MISSING",
            "description": (
                "Structured image evidence is present but malformed (not a list)."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    if not image_evidence:
        return {
            "status": "MISSING",
            "description": (
                "The frozen structured evidence record contains an empty image-evidence list "
                "for the cleaning-fee claim."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    # Enforce the same minimum validity requirements used by image_analysis.py
    valid_images = extract_images_from_context(data)
    if not valid_images:
        return {
            "status": "MISSING",
            "description": (
                "Structured image evidence entries are present but do not contain "
                "minimally valid image records for verification."
            ),
            "evidence_refs": [],
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": "Structured image evidence is available in the frozen evidence record.",
        "evidence_refs": [],
        "details": {"image_count": len(valid_images), "confidence_level": 1.0},
    }


def check_cleaning_photo_reference_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a photo mention in the claim event is matched by structured image evidence.

    Must NOT conclude: no photo was ever taken, driver lied, image was lost,
    image was fraudulent.
    """
    event = _find_cleaning_claim_event(data)
    ds = data.get("data_sources", {})
    image_evidence = ds.get("image_evidence")

    mentions_photo = _event_mentions_photo(event)
    has_structured = len(extract_images_from_context(data)) > 0

    evidence_refs: list[dict[str, Any]] = []
    if event:
        evidence_refs.append(
            _evidence_ref(
                event.get("evidence_id", "EVT-???"),
                "APP_EVENT",
                f"cleaning_fee_claimed at {event.get('timestamp', '?')}: {event.get('details', '')}",
            )
        )

    if mentions_photo and has_structured:
        return {
            "status": "VERIFIED",
            "description": (
                "The cleaning-fee claim references an attached photo and structured image "
                "evidence is present in the frozen record."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if mentions_photo and not has_structured:
        return {
            "status": "MISSING",
            "description": (
                "The cleaning-fee claim references an attached photo, but no structured "
                "image evidence is available in the frozen evidence record for verification."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if not mentions_photo and not has_structured:
        return {
            "status": "MISSING",
            "description": (
                "Neither a photo mention in the claim event nor structured image evidence "
                "is available in the frozen record."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # has_structured but no mention in event
    return {
        "status": "VERIFIED",
        "description": (
            "Structured image evidence is present in the frozen record, though the claim "
            "event does not explicitly mention an attached photo."
        ),
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }
