"""
Standalone test for POL-4 cleaning-fee receipt evidence integration.

Verifies that _compute_cleaning_fee reads receipt amounts from
data_sources.receipt_evidence (ReceiptEvidenceInput / ReceiptOcrResult)
and computes fee = min(receipt_amount, category_cap), with fallback to
the old context-based receipt_present flag when receipt_evidence is absent.

Also verifies POL-4 category-based caps, not_cleaning_categories rejection,
receipt-window enforcement, and claim-filing-window enforcement.

Run from backend/:
    python -m tests.test_cleaning_fee_receipt

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import json
import sys
import tempfile
from pathlib import Path

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

from backend.policy import precedent_store  # noqa: E402

# --- Helpers -------------------------------------------------------------------

_MOCK_DATA_DIR = _BACKEND_DIR / "mock_data"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _policy() -> dict:
    """Return the raw policy dict so we can extract the POL-4 clause."""
    return precedent_store._load_policy()


def _pol4_clause() -> dict:
    clause = _policy().get("clauses", {}).get("POL-4", {})
    return {**clause, "clause_id": "POL-4"}


# A valid image analysis: EXIF within 30 min after trip_end, within 500 m of
# dropoff, not AI, not recycled, consistent.
_DROPOFF = {"name": "Bishan", "lat": 1.3508, "lng": 103.8485}
_TRIP_END = "2026-09-25T22:05:00+08:00"


def _valid_image_analysis(
    image_id: str = "IMG-001",
    severity: str = "MODERATE",
    classification: str = "LIQUID_SPILL",
    recycled: bool = False,
    ai: bool = False,
    exif_ts: str = "2026-09-25T22:15:00+08:00",
    lat: float = 1.3508,
    lng: float = 103.8485,
) -> dict:
    """A single ExifAnalysis dict that passes all POL-4 photo checks."""
    img = {
        "image_id": image_id,
        "image_url": f"mock://evidence/test/{image_id}.jpg",
        "exif_timestamp": exif_ts,
        "exif_gps_location": {"latitude": lat, "longitude": lng, "timestamp": exif_ts},
        "is_ai_generated": ai,
        "ai_generated_confidence": 0.05,
        "stain_damage_classification": classification,
        "damage_severity": severity,
        "exif_consistent_with_trip": True,
    }
    if recycled:
        img["recycled_image_detected"] = True
        img["recycled_image_match_case_id"] = "DISP-0871"
    return img


def _base_context(
    analyses: list | None = None,
    receipt_evidence: list | None = None,
    trip_end_time: str = _TRIP_END,
    extra: dict | None = None,
) -> dict:
    """Build a context dict suitable for _compute_cleaning_fee."""
    ctx = {
        "data_sources": {
            "trip_data": {
                "trip_id": "TRIP-TEST",
                "pickup_location": {"name": "Orchard", "lat": 1.3048, "lng": 103.8318},
                "dropoff_location": dict(_DROPOFF),
                "scheduled_time": "2026-09-25T21:40:00+08:00",
                "trip_end_time": trip_end_time,
            },
        },
        "bonus_modules": {
            "image_exif_analyses": analyses if analyses is not None else [],
        },
    }
    if receipt_evidence is not None:
        ctx["data_sources"]["receipt_evidence"] = receipt_evidence
    if extra:
        ctx.update(extra)
    return ctx


def _receipt(
    receipt_id: str = "RCP-001",
    amount: float | None = 45.0,
    currency: str = "SGD",
    merchant: str = "Sparkle Car Care Pte Ltd",
    receipt_date: str | None = "2026-09-26T09:30:00+08:00",
) -> dict:
    r = {
        "receipt_id": receipt_id,
        "receipt_url": f"mock://evidence/test/{receipt_id}.jpg",
        "uploaded_at": "2026-09-26T10:15:00+08:00",
    }
    if amount is not None:
        ocr = {
            "amount": amount,
            "currency": currency,
            "merchant_name": merchant,
            "ocr_confidence": 0.93,
        }
        if receipt_date is not None:
            ocr["receipt_date"] = receipt_date
        r["ocr_result"] = ocr
    return r


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    errors: list[str] = []

    # Use a temp KB so the real one is never touched.
    tmp_dir = tempfile.mkdtemp(prefix="mirra_receipt_test_")
    tmp_kb_path = str(Path(tmp_dir) / "kb.json")
    precedent_store.reset_for_testing(kb_path=tmp_kb_path)

    try:
        clause = _pol4_clause()
        caps = clause.get("params", {}).get("category_caps", {})
        liquid_cap = float(caps.get("LIQUID_SPILL", 0))
        vomit_cap = float(caps.get("VOMIT", 0))

        # =================================================================
        # CHECK a: LIQUID_SPILL, receipt 35 -> APPROVED, fee 35 (below cap 40)
        # =================================================================
        print("=" * 70)
        print("CHECK a: LIQUID_SPILL, receipt 35 -> APPROVED, fee 35 (below cap 40)")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=35.0)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors: list[str] = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 35.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 35.0")

        if check_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK b: LIQUID_SPILL, receipt 55 -> APPROVED, fee 40 (capped)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK b: LIQUID_SPILL, receipt 55 -> APPROVED, fee 40 (capped)")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=55.0)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 40.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 40.0")

        if check_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK c: two receipts 20 + 15, VOMIT -> fee 35
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK c: two receipts 20 + 15, VOMIT -> APPROVED, fee 35")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="VOMIT")],
            receipt_evidence=[
                _receipt(receipt_id="RCP-001", amount=20.0),
                _receipt(receipt_id="RCP-002", amount=15.0),
            ],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 35.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 35.0")

        if check_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK d: receipt without ocr_result -> computable False (unreadable)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK d: receipt without ocr_result -> computable False")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=None)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not False:
            check_errors.append(f"computable is {result.get('computable')!r}, expected False")
        reason = result.get("reason", "")
        if "could not be read" not in reason.lower():
            check_errors.append(f"reason does not mention unreadable receipt: {reason!r}")

        if check_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print(f"  - computable: False")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK e: no receipt_evidence, no fallback key -> computable False
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK e: no receipt_evidence, no fallback key -> computable False")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=None,  # absent
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not False:
            check_errors.append(f"computable is {result.get('computable')!r}, expected False")
        reason = result.get("reason", "")
        if "receipt" not in reason.lower():
            check_errors.append(f"reason does not mention receipt requirement: {reason!r}")

        if check_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - computable: False")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK f: no receipt_evidence, context cleaning_receipt_present True
        #          -> fee = category cap (old path still works)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK f: no receipt_evidence, context fallback True -> fee = LIQUID_SPILL cap")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=None,  # absent
            extra={"cleaning_receipt_present": True},
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != liquid_cap:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected {liquid_cap} (LIQUID_SPILL cap)")

        if check_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK g: recycled image + readable receipt -> REJECTED, fee 0
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK g: recycled image + readable receipt -> REJECTED, fee 0")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL", recycled=True)],
            receipt_evidence=[_receipt(amount=45.0)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "REJECTED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")

        if check_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK h: DISP-004 mock file with Connie's image analysis
        #          -> REJECTED, fee 0 (recycled photo)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK h: DISP-004 mock + Connie image analysis -> REJECTED, fee 0")
        print("=" * 70)

        check_errors = []

        # Load the raw DISP-004 mock file and run Connie's prosecutor audit
        # to get the real bonus_modules.image_exif_analyses.
        try:
            from backend.app.services.verification.ingestion import (  # noqa: E402
                normalize_evidence,
            )
            from backend.agents.prosecutor_agent import run_prosecutor_audit  # noqa: E402
            import asyncio  # noqa: E402

            raw_004 = _load_json(_MOCK_DATA_DIR / "DISP-004.json")
            from backend.shared.claim_evidence import merge_claim_evidence
            raw_004 = dict(raw_004)
            raw_004["data_sources"] = merge_claim_evidence(
                raw_004["data_sources"], raw_004.get("dispute_claim", {})
            )
            normalized_004 = normalize_evidence(raw_004)
            audit_result = asyncio.run(run_prosecutor_audit(normalized_004))
            analyses_004 = audit_result.get("bonus_modules", {}).get("image_exif_analyses", [])

            if not analyses_004:
                check_errors.append("Connie image analysis returned no image_exif_analyses for DISP-004")

            # Verify the recycled detection is present (expected for DISP-004)
            recycled_found = any(a.get("recycled_image_detected") is True for a in analyses_004)
            if not recycled_found:
                check_errors.append("Connie image analysis did not detect recycled image for DISP-004")

            # Build the context exactly as the policy consultant would: the
            # normalized case dict plus the bonus_modules from the audit.
            ctx_004 = dict(normalized_004)
            ctx_004["bonus_modules"] = audit_result.get("bonus_modules", {})

            result = precedent_store._compute_cleaning_fee(clause, ctx_004)

            if result.get("computable") is not True:
                check_errors.append(f"computable is {result.get('computable')!r}, expected True")
            if result.get("ruling_type") != "REJECTED":
                check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
            fee = result.get("action", {}).get("cleaning_fee_amount")
            if fee != 0:
                check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")

        except Exception as exc:
            check_errors.append(f"unexpected exception: {exc!r}")

        if check_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK i: PHYSICAL_DAMAGE only -> computable False
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK i: PHYSICAL_DAMAGE only -> computable False")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="PHYSICAL_DAMAGE")],
            receipt_evidence=[_receipt(amount=45.0)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not False:
            check_errors.append(f"computable is {result.get('computable')!r}, expected False")
        reason = result.get("reason", "")
        if "physical damage is not a cleaning claim" not in reason.lower():
            check_errors.append(f"reason does not mention physical damage: {reason!r}")

        if check_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print(f"  - computable: False")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK j: receipt dated 30 h after trip end -> REJECTED (outside 24 h)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK j: receipt dated 30 h after trip end -> REJECTED (outside 24 h)")
        print("=" * 70)

        # trip_end is 2026-09-25T22:05:00+08:00
        # 30 h later = 2026-09-27T04:05:00+08:00
        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[
                _receipt(
                    amount=35.0,
                    receipt_date="2026-09-27T04:05:00+08:00",
                )
            ],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "REJECTED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")
        reason = result.get("reason", "")
        if "within 24 h" not in reason.lower():
            check_errors.append(f"reason does not mention 24 h window: {reason!r}")

        if check_errors:
            print("\nCHECK j RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK j RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK k: receipt dated before trip end -> REJECTED
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK k: receipt dated before trip end -> REJECTED")
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[
                _receipt(
                    amount=35.0,
                    receipt_date="2026-09-25T20:00:00+08:00",  # before trip_end 22:05
                )
            ],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "REJECTED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")
        reason = result.get("reason", "")
        if "within 24 h" not in reason.lower():
            check_errors.append(f"reason does not mention 24 h window: {reason!r}")

        if check_errors:
            print("\nCHECK k RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK k RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK l: dispute_claim filed_at 50 h after trip end -> REJECTED
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK l: dispute_claim filed_at 50 h after trip end -> REJECTED")
        print("=" * 70)

        # trip_end is 2026-09-25T22:05:00+08:00
        # 50 h later = 2026-09-28T00:05:00+08:00
        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=35.0)],
            extra={
                "dispute_claim": {
                    "filed_at": "2026-09-28T00:05:00+08:00",
                }
            },
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "REJECTED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")
        reason = result.get("reason", "")
        if "48 h" not in reason.lower():
            check_errors.append(f"reason does not mention 48 h window: {reason!r}")

        if check_errors:
            print("\nCHECK l RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK l RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK m: receipt without receipt_date -> counted, reason contains
        #          "receipt date not available"
        # =================================================================
        print("\n" + "=" * 70)
        print('CHECK m: receipt without receipt_date -> counted, "receipt date not available"')
        print("=" * 70)

        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[
                _receipt(amount=35.0, receipt_date=None),
            ],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 35.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 35.0")
        reason = result.get("reason", "")
        if "receipt date not available" not in reason.lower():
            check_errors.append(f"reason does not mention 'receipt date not available': {reason!r}")

        if check_errors:
            print("\nCHECK m RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK m RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK n: two valid images (LIQUID_SPILL + VOMIT), receipt 150
        #          -> fee 150 (highest cap 200)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK n: LIQUID_SPILL + VOMIT, receipt 150 -> fee 150 (highest cap 200)")
        print("=" * 70)

        ctx = _base_context(
            analyses=[
                _valid_image_analysis(image_id="IMG-001", classification="LIQUID_SPILL"),
                _valid_image_analysis(image_id="IMG-002", classification="VOMIT"),
            ],
            receipt_evidence=[_receipt(amount=150.0)],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 150.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 150.0")
        reason = result.get("reason", "")
        if "VOMIT" not in reason:
            check_errors.append(f"reason does not mention VOMIT category: {reason!r}")

        if check_errors:
            print("\nCHECK n RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK n RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK o: no dispute_claim, case_metadata.created_at 2 h after trip
        #          end, LIQUID_SPILL receipt 35 -> APPROVED 35 (claim check
        #          runs via created_at and passes)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK o: no dispute_claim, created_at 2 h after trip -> APPROVED 35")
        print("=" * 70)

        # trip_end is 2026-09-25T22:05:00+08:00
        # 2 h later = 2026-09-26T00:05:00+08:00
        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=35.0)],
            extra={
                "case_metadata": {
                    "case_id": "DISP-TEST-O",
                    "dispute_type": "CLEANING_FEE",
                    "current_state": "POLICY_CONSULTATION",
                    "current_round": "ROUND_2_CROSS_EXAM",
                    "resolution_channel": "FULLY_AUTOMATED",
                    "created_at": "2026-09-26T00:05:00+08:00",
                    "updated_at": "2026-09-26T00:05:00+08:00",
                }
            },
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 35.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 35.0")

        if check_errors:
            print("\nCHECK o RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK o RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK p: case_metadata.created_at 50 h after trip end, no
        #          dispute_claim -> REJECTED "Claim filed more than 48 h"
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK p: created_at 50 h after trip, no dispute_claim -> REJECTED")
        print("=" * 70)

        # trip_end is 2026-09-25T22:05:00+08:00
        # 50 h later = 2026-09-28T00:05:00+08:00
        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=35.0)],
            extra={
                "case_metadata": {
                    "case_id": "DISP-TEST-P",
                    "dispute_type": "CLEANING_FEE",
                    "current_state": "POLICY_CONSULTATION",
                    "current_round": "ROUND_2_CROSS_EXAM",
                    "resolution_channel": "FULLY_AUTOMATED",
                    "created_at": "2026-09-28T00:05:00+08:00",
                    "updated_at": "2026-09-28T00:05:00+08:00",
                }
            },
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "REJECTED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected REJECTED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 0")
        reason = result.get("reason", "")
        if "48 h" not in reason.lower():
            check_errors.append(f"reason does not mention 48 h window: {reason!r}")

        if check_errors:
            print("\nCHECK p RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK p RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {reason}")

        # =================================================================
        # CHECK q: two receipts: 20 dated 3 h after trip end + 30 dated 30 h
        #          after -> only 20 counts -> VOMIT fee 20
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK q: receipts 20 (3 h) + 30 (30 h) -> only 20 counts -> VOMIT fee 20")
        print("=" * 70)

        # trip_end is 2026-09-25T22:05:00+08:00
        #  3 h later = 2026-09-26T01:05:00+08:00  (within 24 h)
        # 30 h later = 2026-09-27T04:05:00+08:00  (outside 24 h)
        ctx = _base_context(
            analyses=[_valid_image_analysis(classification="VOMIT")],
            receipt_evidence=[
                _receipt(receipt_id="RCP-001", amount=20.0, receipt_date="2026-09-26T01:05:00+08:00"),
                _receipt(receipt_id="RCP-002", amount=30.0, receipt_date="2026-09-27T04:05:00+08:00"),
            ],
        )
        result = precedent_store._compute_cleaning_fee(clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 20.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 20.0 (only in-window receipt)")

        if check_errors:
            print("\nCHECK q RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK q RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # CHECK r: params without category_caps but with severity_caps
        #          {"MODERATE": 60} (modified clause copy), MODERATE image,
        #          receipt 80 -> fee 60 (backward-compatible path)
        # =================================================================
        print("\n" + "=" * 70)
        print("CHECK r: legacy severity_caps {MODERATE:60}, MODERATE, receipt 80 -> fee 60")
        print("=" * 70)

        legacy_params = {k: v for k, v in clause["params"].items() if k != "category_caps"}
        legacy_params["severity_caps"] = {"MODERATE": 60.0}
        legacy_clause = {**clause, "params": legacy_params}

        ctx = _base_context(
            analyses=[_valid_image_analysis(severity="MODERATE", classification="LIQUID_SPILL")],
            receipt_evidence=[_receipt(amount=80.0)],
        )
        result = precedent_store._compute_cleaning_fee(legacy_clause, ctx)
        check_errors = []

        if result.get("computable") is not True:
            check_errors.append(f"computable is {result.get('computable')!r}, expected True")
        if result.get("ruling_type") != "APPROVED":
            check_errors.append(f"ruling_type is {result.get('ruling_type')!r}, expected APPROVED")
        fee = result.get("action", {}).get("cleaning_fee_amount")
        if fee != 60.0:
            check_errors.append(f"cleaning_fee_amount is {fee!r}, expected 60.0 (capped via severity_caps)")

        if check_errors:
            print("\nCHECK r RESULT: FAIL")
            for e in check_errors:
                print(f"  - {e}")
            errors.extend(check_errors)
        else:
            print("\nCHECK r RESULT: PASS")
            print(f"  - ruling_type: {result['ruling_type']}")
            print(f"  - cleaning_fee_amount: {fee}")
            print(f"  - reason: {result['reason']}")

        # =================================================================
        # Summary
        # =================================================================
        if errors:
            print("\n" + "=" * 70)
            print("SOME CHECKS FAILED")
            print("=" * 70)
            sys.exit(1)
        else:
            print("\n" + "=" * 70)
            print("ALL TESTS PASSED")
            print("=" * 70)

    finally:
        precedent_store.reset_for_testing(kb_path=precedent_store._DEFAULT_KB_PATH)
        # Clean up temp dir
        for f in Path(tmp_dir).glob("*"):
            f.unlink()
        Path(tmp_dir).rmdir()


if __name__ == "__main__":
    main()
