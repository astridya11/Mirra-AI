"""Deterministic CLEANING_FEE evidence checks.

Mirrors the style of checks.py and checks_route_deviation.py: every function
reads data_sources safely, never raises, and degrades to MISSING/DISPUTED on
malformed input rather than crashing. These checks establish evidence facts
only — they never conclude intent, fault, policy violation, or liability.
"""

import math
import re
from typing import Any

from backend.shared.time_rules import (
    parse_ts as _parse_ts,
    trip_end_time as _trip_end_time,
    format_gap as _format_gap,
    check_window as _check_window,
    check_distance as _check_distance,
)
from .checks import _evidence_ref, _is_before, _seconds_between
from .image_analysis import analyze_image_evidence_batch, extract_images_from_context

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


def _get_readable_receipts(ds: dict[str, Any]) -> list[tuple[str, float]]:
    """Return [(receipt_id, amount), ...] for receipts with a readable ocr_result.amount.

    A receipt is readable when it is a dict whose ``ocr_result`` is a dict
    with a finite numeric ``amount`` >= 0. Non-dict entries are skipped.
    Mirrors the rule used by precedent_store._compute_cleaning_fee.
    """
    raw = ds.get("receipt_evidence")
    if not isinstance(raw, list):
        return []
    result: list[tuple[str, float]] = []
    for i, rcp in enumerate(raw):
        if not isinstance(rcp, dict):
            continue
        ocr = rcp.get("ocr_result")
        if not isinstance(ocr, dict):
            continue
        amount = ocr.get("amount")
        if _is_number(amount) and amount >= 0:
            rid = rcp.get("receipt_id") or f"RCP-{i:03d}"
            result.append((rid, float(amount)))
    return result


def _get_claim(data: dict[str, Any]) -> dict[str, Any] | None:
    """Return the cleaning-fee claim record, or None if no source provides one.

    Tries sources in priority order:
      a. ``data["dispute_claim"]`` (dict with filed_by / filed_at / description,
         comes from the UI later). Amount comes from
         ``data_sources.payment_fare_data.disputed_amount``. Source: ``DISPUTE_CLAIM``.
      b. Legacy app event ``cleaning_fee_claimed`` (existing
         _find_cleaning_claim_event / _parse_claim_amount_from_event). Source: ``APP_EVENT``.
      c. Case record: ``filed_at = case_metadata.created_at``,
         ``amount = payment_fare_data.disputed_amount``, description None.
         Source: ``CASE_RECORD``.

    Returns a dict with keys: ``filed_at``, ``amount``, ``description``, ``source``,
    ``evidence_refs`` (list of evidence ref dicts). Returns None only if no source
    yields a filed_at or amount.
    """
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}
    payment = ds.get("payment_fare_data")
    if not isinstance(payment, dict):
        payment = {}
    disputed_amount = payment.get("disputed_amount")
    disputed_currency = payment.get("disputed_amount_currency", "")

    # (a) dispute_claim from the UI
    dc = data.get("dispute_claim")
    if isinstance(dc, dict) and (dc.get("filed_at") or _is_number(disputed_amount)):
        filed_at = dc.get("filed_at")
        description = dc.get("description")
        evidence_refs: list[dict[str, Any]] = []
        if _is_number(disputed_amount):
            evidence_refs.append(
                _evidence_ref(
                    "PAYMENT-DATA",
                    "PAYMENT_RECORD",
                    f"disputed amount {disputed_amount} {disputed_currency}".strip(),
                )
            )
        return {
            "filed_at": filed_at,
            "amount": float(disputed_amount) if _is_number(disputed_amount) else None,
            "description": description,
            "source": "DISPUTE_CLAIM",
            "evidence_refs": evidence_refs,
        }

    # (b) legacy app event
    event = _find_cleaning_claim_event(data)
    if event is not None:
        event_amount = _parse_claim_amount_from_event(event)
        filed_at = event.get("timestamp")
        if filed_at or event_amount is not None:
            evidence_refs = [
                _evidence_ref(
                    event.get("evidence_id", "EVT-???"),
                    "APP_EVENT",
                    f"cleaning_fee_claimed at {filed_at or '?'}: {event.get('details', '')}",
                )
            ]
            return {
                "filed_at": filed_at,
                "amount": event_amount,
                "description": event.get("details"),
                "source": "APP_EVENT",
                "evidence_refs": evidence_refs,
            }

    # (c) case record
    case_meta = data.get("case_metadata")
    if isinstance(case_meta, dict):
        filed_at = case_meta.get("created_at")
        if filed_at or _is_number(disputed_amount):
            evidence_refs = []
            if _is_number(disputed_amount):
                evidence_refs.append(
                    _evidence_ref(
                        "PAYMENT-DATA",
                        "PAYMENT_RECORD",
                        f"disputed amount {disputed_amount} {disputed_currency}".strip(),
                    )
                )
            return {
                "filed_at": filed_at,
                "amount": float(disputed_amount) if _is_number(disputed_amount) else None,
                "description": None,
                "source": "CASE_RECORD",
                "evidence_refs": evidence_refs,
            }

    return None


def check_cleaning_claim_event_exists(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a cleaning-fee claim is recorded in the case record.

    The claim may come from a ``dispute_claim`` record (UI), a legacy
    ``cleaning_fee_claimed`` app event, or the case metadata itself.

    Must NOT conclude: claim valid, rider responsible, fee justified.
    """
    claim = _get_claim(data)
    if claim is None:
        return {
            "status": "MISSING",
            "description": "No cleaning-fee claim is recorded in the case record.",
            "evidence_refs": [],
            "details": {},
        }

    evidence_refs = list(claim.get("evidence_refs", []))
    filed_at = claim.get("filed_at")
    amount = claim.get("amount")
    source = claim.get("source", "CASE_RECORD")

    # Validate timestamp if present
    if filed_at and _parse_ts(filed_at) is None:
        return {
            "status": "DISPUTED",
            "description": (
                f"A cleaning-fee claim is recorded, but its timestamp "
                f"('{filed_at}') is malformed and cannot be used for verification."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    source_label = {
        "DISPUTE_CLAIM": "dispute claim",
        "APP_EVENT": "app event history",
        "CASE_RECORD": "case record",
    }.get(source, "case record")

    amount_str = f" of SGD {amount:.2f}" if _is_number(amount) else ""
    return {
        "status": "VERIFIED",
        "description": (
            f"Cleaning-fee claim{amount_str} recorded, filed at {filed_at or '?'} "
            f"({source_label})."
        ),
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_cleaning_claim_amount_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the cleaning-fee claim amount is consistent with supporting evidence.

    For the legacy APP_EVENT source, compares the event amount with the
    disputed_amount (existing behaviour). For all other sources, compares the
    claimed amount with the total of readable receipts in
    ``data_sources.receipt_evidence``.

    Must NOT conclude: "$100 is fair" or "$100 is allowed by policy".
    """
    claim = _get_claim(data)
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}
    payment = ds.get("payment_fare_data")
    if not isinstance(payment, dict):
        payment = {}

    disputed_amount = payment.get("disputed_amount")
    disputed_currency = payment.get("disputed_amount_currency", "")

    evidence_refs: list[dict[str, Any]] = []
    if claim:
        evidence_refs.extend(claim.get("evidence_refs", []))

    if _is_number(disputed_amount):
        # Ensure PAYMENT-DATA is referenced (may already be in claim.evidence_refs)
        if not any(r.get("evidence_id") == "PAYMENT-DATA" for r in evidence_refs):
            evidence_refs.append(
                _evidence_ref(
                    "PAYMENT-DATA",
                    "PAYMENT_RECORD",
                    f"disputed amount {disputed_amount} {disputed_currency}".strip(),
                )
            )

    if claim is None:
        return {
            "status": "MISSING",
            "description": "No cleaning-fee claim is recorded to verify the amount against.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    claim_amount = claim.get("amount")
    source = claim.get("source", "CASE_RECORD")

    if not _is_number(claim_amount):
        return {
            "status": "MISSING",
            "description": "The cleaning-fee claim amount cannot be determined.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # --- Legacy APP_EVENT path: compare event amount vs disputed_amount ---
    if source == "APP_EVENT":
        if not _is_number(disputed_amount):
            return {
                "status": "MISSING",
                "description": "The disputed amount in payment data is missing or malformed.",
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }

        if claim_amount != disputed_amount:
            return {
                "status": "DISPUTED",
                "description": (
                    f"The cleaning-fee claim amount ({claim_amount}) does not match "
                    f"the recorded disputed amount ({disputed_amount} {disputed_currency})."
                ),
                "evidence_refs": evidence_refs,
                "details": {
                    "claim_amount": claim_amount,
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
                "amount": claim_amount,
                "currency": disputed_currency,
                "confidence_level": 1.0,
            },
        }

    # --- Non-APP_EVENT path: compare claim amount vs receipt total ---
    readable = _get_readable_receipts(ds)
    for rid, _ in readable:
        evidence_refs.append(
            _evidence_ref(rid, "RECEIPT", f"receipt {rid}")
        )

    if not readable:
        return {
            "status": "MISSING",
            "description": "No readable receipt is available to check the claimed amount against.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    receipt_total = sum(amt for _, amt in readable)
    receipt_ids = ", ".join(rid for rid, _ in readable)

    if abs(claim_amount - receipt_total) > 0.01:
        return {
            "status": "DISPUTED",
            "description": (
                f"Claimed amount SGD {claim_amount:.2f} differs from the receipt total "
                f"SGD {receipt_total:.2f}."
            ),
            "evidence_refs": evidence_refs,
            "details": {
                "claim_amount": claim_amount,
                "receipt_total": receipt_total,
                "confidence_level": 1.0,
            },
        }

    return {
        "status": "VERIFIED",
        "description": (
            f"Claimed amount SGD {claim_amount:.2f} matches the receipt total "
            f"SGD {receipt_total:.2f} ({receipt_ids})."
        ),
        "evidence_refs": evidence_refs,
        "details": {
            "amount": claim_amount,
            "receipt_total": receipt_total,
            "confidence_level": 1.0,
        },
    }


def check_cleaning_claim_submission_delay(data: dict[str, Any]) -> dict[str, Any]:
    """Whether the cleaning-fee claim was submitted after trip completion.

    Uses ``time_rules.trip_end_time(data_sources)`` and
    ``_get_claim()['filed_at']``.  Reports the human-readable gap via
    ``format_gap``.  Must NOT conclude that any delay is suspicious or
    violates policy.
    """
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}
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

    claim = _get_claim(data)

    evidence_refs: list[dict[str, Any]] = []

    if trip_complete_event:
        evidence_refs.append(
            _evidence_ref(
                trip_complete_event.get("evidence_id", "EVT-???"),
                "APP_EVENT",
                f"trip_completed at {trip_complete_event.get('timestamp', '?')}",
            )
        )
    if claim:
        evidence_refs.extend(claim.get("evidence_refs", []))

    if trip_complete_event is None or claim is None:
        missing = []
        if trip_complete_event is None:
            missing.append("trip_completed")
        if claim is None:
            missing.append("cleaning-fee claim")
        return {
            "status": "MISSING",
            "description": (
                f"Cannot calculate claim submission delay: missing {', '.join(missing)}."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    trip_ts = _trip_end_time(ds)
    claim_ts = _parse_ts(claim.get("filed_at"))

    if trip_ts is None or claim_ts is None:
        malformed = []
        if trip_ts is None:
            malformed.append("trip_completed")
        if claim_ts is None:
            malformed.append("claim filed_at")
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
                "Trip completion and claim filed_at timestamps use incompatible "
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
                f"The cleaning-fee claim was filed at {claim.get('filed_at')}, "
                f"which is before the trip completion timestamp ({trip_complete_event.get('timestamp')})."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    delta_minutes = delta_seconds // 60
    gap_text = _format_gap(delta_seconds)
    trip_str = trip_ts.strftime("%d %b %H:%M")
    filed_str = claim_ts.strftime("%d %b %H:%M")
    return {
        "status": "VERIFIED",
        "description": (
            f"The cleaning-fee claim was filed {gap_text} after trip end "
            f"(trip end {trip_str}, filed {filed_str})."
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
    """Report the outcome of deterministic image checks on structured image evidence.

    When valid images exist, runs the same analysis used to build
    ``bonus_modules.image_exif_analyses`` (EXIF time/location consistency,
    known-image match, provider AI flag) and states the result as a fact so
    POL-10 can see it:

    - Any image recycled or AI-generated → VERIFIED, ``party_relevance`` "DRIVER".
      Description sentences include "Recycled image detected: …" and
      "AI-generated image detected: …", plus an EXIF-inconsistency sentence
      if applicable.
    - Otherwise any image with ``exif_consistent_with_trip`` false → DISPUTED,
      ``party_relevance`` "DRIVER" (an honest mistake is possible, so this is
      not a fabrication finding). The description must NOT contain any term
      matched by POL-10 ("recycled image", "fabricated evidence",
      "ai-generated", "ai generated", "synthetic image").
    - Otherwise → VERIFIED with the current text plus " Image checks found no
      issue." No ``party_relevance``.

    Must NOT conclude intent, who is at fault, or whether the fee is justified.
    """
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}
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

    # Run the deterministic image analysis (same as bonus_modules.image_exif_analyses)
    analyses = analyze_image_evidence_batch(valid_images, ds)

    # Build one evidence_ref per analysed image
    evidence_refs: list[dict[str, Any]] = []
    for analysis in analyses:
        img_id = analysis.get("image_id", "IMG-???")
        exif_ts = analysis.get("exif_timestamp", "?")
        provider = analysis.get("stain_damage_classification", "?")
        severity = analysis.get("damage_severity")
        severity_str = f", severity {severity}" if severity else ""
        evidence_refs.append(
            _evidence_ref(
                img_id,
                "IMAGE",
                f"EXIF time {exif_ts}, provider classification {provider}{severity_str}",
            )
        )

    # Classify each analysed image
    fabrication_sentences: list[str] = []
    exif_inconsistent_sentences: list[str] = []
    fabrication_present = False

    for analysis in analyses:
        img_id = analysis.get("image_id", "IMG-???")

        recycled = analysis.get("recycled_image_detected") is True
        ai_generated = analysis.get("is_ai_generated") is True
        exif_consistent = analysis.get("exif_consistent_with_trip")
        exif_bad = exif_consistent is False

        if recycled:
            fabrication_present = True
            match_case = analysis.get("recycled_image_match_case_id")
            if match_case:
                fabrication_sentences.append(
                    f"Recycled image detected: {img_id} matches prior case {match_case}."
                )
            else:
                fabrication_sentences.append(
                    f"Recycled image detected: {img_id} matches a prior case."
                )

        if ai_generated:
            fabrication_present = True
            confidence = analysis.get("ai_generated_confidence")
            if _is_number(confidence):
                fabrication_sentences.append(
                    f"AI-generated image detected: {img_id} (provider confidence {confidence:.2f})."
                )
            else:
                fabrication_sentences.append(
                    f"AI-generated image detected: {img_id}."
                )

        if exif_bad:
            exif_inconsistent_sentences.append(
                f"{img_id} EXIF time/location is inconsistent with the trip record."
            )

    # Case (a): recycled or AI-generated → VERIFIED, party_relevance DRIVER
    if fabrication_present:
        parts = list(fabrication_sentences)
        # Append EXIF-inconsistency sentences for images that also have fabrication findings
        parts.extend(exif_inconsistent_sentences)
        description = " ".join(parts)
        return {
            "status": "VERIFIED",
            "description": description,
            "evidence_refs": evidence_refs,
            "details": {
                "image_count": len(valid_images),
                "party_relevance": "DRIVER",
                "confidence_level": 1.0,
            },
        }

    # Case (b): EXIF inconsistent (no fabrication) → DISPUTED, party_relevance DRIVER
    if exif_inconsistent_sentences:
        description = " ".join(exif_inconsistent_sentences)
        return {
            "status": "DISPUTED",
            "description": description,
            "evidence_refs": evidence_refs,
            "details": {
                "image_count": len(valid_images),
                "party_relevance": "DRIVER",
                "confidence_level": 1.0,
            },
        }

    # Case (c): no issues → VERIFIED, no party_relevance
    return {
        "status": "VERIFIED",
        "description": (
            "Structured image evidence is available in the frozen evidence record."
            " Image checks found no issue."
        ),
        "evidence_refs": evidence_refs,
        "details": {"image_count": len(valid_images), "confidence_level": 1.0},
    }


def check_cleaning_photo_reference_consistency(data: dict[str, Any]) -> dict[str, Any]:
    """Whether a photo reference in the claim is matched by structured image evidence.

    The photo reference comes from the claim description (``dispute_claim.description``
    or the legacy app event details, using the same positive/negation patterns).
    When no claim text is available, falls back to whether structured image
    evidence is present.

    Must NOT conclude: no photo was ever taken, driver lied, image was lost,
    image was fraudulent.
    """
    claim = _get_claim(data)
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}

    claim_description = claim.get("description") if claim else None
    has_structured = len(extract_images_from_context(data)) > 0

    evidence_refs: list[dict[str, Any]] = []
    if claim:
        evidence_refs.extend(claim.get("evidence_refs", []))

    # Determine whether the claim text mentions a photo
    mentions_photo = False
    if isinstance(claim_description, str) and claim_description.strip():
        lower_text = claim_description.lower()
        for pattern in _PHOTO_NEGATION_PATTERNS:
            if pattern.search(lower_text):
                mentions_photo = False
                break
        else:
            for pattern in _PHOTO_POSITIVE_PATTERNS:
                if pattern.search(lower_text):
                    mentions_photo = True
                    break
    else:
        # No claim text available — fall back to structured image evidence
        if has_structured:
            return {
                "status": "VERIFIED",
                "description": "Structured image evidence is present in the frozen record.",
                "evidence_refs": evidence_refs,
                "details": {"confidence_level": 1.0},
            }
        return {
            "status": "MISSING",
            "description": "No structured image evidence is available in the frozen record.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

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
                "image evidence is available in the frozen record for verification."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # Claim text present but no photo mention + no structured evidence
    if not has_structured:
        return {
            "status": "MISSING",
            "description": (
                "Neither a photo reference in the claim nor structured image evidence "
                "is available in the frozen record."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # has_structured but no mention in claim text
    return {
        "status": "VERIFIED",
        "description": (
            "Structured image evidence is present in the frozen record, though the claim "
            "does not explicitly reference an attached photo."
        ),
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }


def check_cleaning_receipt_timing(data: dict[str, Any]) -> dict[str, Any]:
    """State the time gap between each readable receipt and trip end.

    For every receipt with a readable ``ocr_result.amount`` and a parseable
    ``ocr_result.receipt_date``, states the gap as a fact using
    ``time_rules.check_window``.  When there are no receipts, no dated
    receipts, or no trip-end timestamp, returns MISSING.  A receipt dated
    before trip end returns DISPUTED.

    Must NOT conclude that any receipt is within/outside a policy window.
    """
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}

    trip_ts = _trip_end_time(ds)

    evidence_refs: list[dict[str, Any]] = []
    if trip_ts is not None:
        evidence_refs.append(
            _evidence_ref("TRIP-DATA", "TRIP_DATA", f"trip end {trip_ts.isoformat()}")
        )

    if trip_ts is None:
        return {
            "status": "MISSING",
            "description": "Cannot determine receipt timing: trip end timestamp is not available.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    raw = ds.get("receipt_evidence")
    if not isinstance(raw, list):
        return {
            "status": "MISSING",
            "description": "No receipt evidence is available to check timing for.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    dated_receipts: list[tuple[str, float, Any, int]] = []
    for i, rcp in enumerate(raw):
        if not isinstance(rcp, dict):
            continue
        ocr = rcp.get("ocr_result")
        if not isinstance(ocr, dict):
            continue
        amount = ocr.get("amount")
        if not _is_number(amount):
            continue
        rd = ocr.get("receipt_date")
        rdt = _parse_ts(rd)
        if rdt is None:
            continue
        rid = rcp.get("receipt_id") or f"RCP-{i:03d}"
        gap = _check_window(rdt, trip_ts, unit="seconds")
        secs = gap["seconds"]
        if secs is None:
            continue
        dated_receipts.append((rid, float(amount), rdt, secs))

    if not dated_receipts:
        return {
            "status": "MISSING",
            "description": "No readable receipt with a parseable date is available.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    # Add receipt evidence refs
    for rid, amount, rdt, _ in dated_receipts:
        evidence_refs.append(
            _evidence_ref(rid, "RECEIPT", f"receipt {rid} SGD {amount:.2f}")
        )

    # Check for any receipt dated before trip end
    before_receipts = [(rid, amount, rdt, secs) for rid, amount, rdt, secs in dated_receipts if secs < 0]
    if before_receipts:
        parts: list[str] = []
        for rid, amount, rdt, secs in before_receipts:
            gap_text = _format_gap(abs(secs))
            parts.append(
                f"Receipt {rid} (SGD {amount:.2f}) is dated {rdt.strftime('%d %b %H:%M')}, "
                f"{gap_text} before trip end ({trip_ts.strftime('%d %b %H:%M')})."
            )
        return {
            "status": "DISPUTED",
            "description": " ".join(parts),
            "evidence_refs": evidence_refs,
            "details": {
                "receipt_ids": [rid for rid, _, _, _ in before_receipts],
                "confidence_level": 1.0,
            },
        }

    parts = []
    details_receipts: list[dict[str, Any]] = []
    for rid, amount, rdt, secs in dated_receipts:
        gap_text = _format_gap(secs)
        parts.append(
            f"Receipt {rid} (SGD {amount:.2f}) is dated {rdt.strftime('%d %b %H:%M')}, "
            f"{gap_text} after trip end ({trip_ts.strftime('%d %b %H:%M')})."
        )
        details_receipts.append({"receipt_id": rid, "gap_seconds": secs})

    return {
        "status": "VERIFIED",
        "description": " ".join(parts),
        "evidence_refs": evidence_refs,
        "details": {
            "receipts": details_receipts,
            "confidence_level": 1.0,
        },
    }


def check_cleaning_photo_timing(data: dict[str, Any]) -> dict[str, Any]:
    """State the time gap and distance between each photo and the drop-off.

    For every image with a parseable ``exif_timestamp`` (using the same image
    source as ``extract_images_from_context``), states the gap and distance as
    a fact using ``time_rules.check_window`` and ``check_distance``.

    - Photo taken **after** trip end -> VERIFIED.
    - Photo taken **before** trip end -> DISPUTED.
    - Only a missing/unparseable exif_timestamp -> MISSING.

    No GPS -> location stated as "not available".
    Must NOT conclude that any photo is within/outside a policy window.
    """
    ds = data.get("data_sources", {})
    if not isinstance(ds, dict):
        ds = {}

    trip_ts = _trip_end_time(ds)
    trip_data = ds.get("trip_data") or {}
    if not isinstance(trip_data, dict):
        trip_data = {}
    dropoff = trip_data.get("dropoff_location")
    dropoff_name = ""
    if isinstance(dropoff, dict):
        dropoff_name = dropoff.get("name", "")

    evidence_refs: list[dict[str, Any]] = []
    if trip_ts is not None:
        evidence_refs.append(
            _evidence_ref("TRIP-DATA", "TRIP_DATA", f"trip end {trip_ts.isoformat()}")
        )

    images = extract_images_from_context(data)
    if not images:
        return {
            "status": "MISSING",
            "description": "No image evidence with EXIF data is available.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    if trip_ts is None:
        return {
            "status": "MISSING",
            "description": (
                "Cannot determine photo timing: trip end timestamp is not available."
            ),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    timed_images: list[tuple[str, Any, Any, int]] = []
    for img in images:
        exif_ts = getattr(img, "exif_timestamp", None)
        if not exif_ts:
            continue
        exif_dt = _parse_ts(exif_ts)
        if exif_dt is None:
            continue
        img_id = getattr(img, "image_id", "IMG-???")
        gap = _check_window(exif_dt, trip_ts, unit="seconds")
        secs = gap["seconds"]
        if secs is None:
            continue
        timed_images.append((img_id, exif_dt, img, secs))

    if not timed_images:
        return {
            "status": "MISSING",
            "description": "No image with a parseable EXIF timestamp is available.",
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    parts: list[str] = []
    before_parts: list[str] = []
    for img_id, exif_dt, img, secs in timed_images:
        evidence_refs.append(
            _evidence_ref(img_id, "IMAGE", f"EXIF time {exif_dt.isoformat()}")
        )
        gap_text = _format_gap(abs(secs))
        word = "before" if secs < 0 else "after"
        exif_gps = getattr(img, "exif_gps_location", None)
        loc_text = "location not available"
        if exif_gps is not None and isinstance(dropoff, dict):
            # exif_gps may be an ExifGpsLocation dataclass or a dict.
            gps_dict = (
                exif_gps if isinstance(exif_gps, dict)
                else {
                    "latitude": getattr(exif_gps, "latitude", None),
                    "longitude": getattr(exif_gps, "longitude", None),
                }
            )
            dist = _check_distance(gps_dict, dropoff)
            if dist["text"] != "not available":
                loc_text = f"{dist['text']} from the drop-off point"
                if dropoff_name:
                    loc_text += f" ({dropoff_name})"

        sentence = f"Photo {img_id} was taken {gap_text} {word} trip end, {loc_text}."
        if secs < 0:
            before_parts.append(sentence)
        else:
            parts.append(sentence)

    if before_parts:
        return {
            "status": "DISPUTED",
            "description": " ".join(before_parts + parts),
            "evidence_refs": evidence_refs,
            "details": {"confidence_level": 1.0},
        }

    return {
        "status": "VERIFIED",
        "description": " ".join(parts),
        "evidence_refs": evidence_refs,
        "details": {"confidence_level": 1.0},
    }
