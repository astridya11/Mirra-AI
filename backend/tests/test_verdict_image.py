"""Standalone tests for verdict image rendering and caption building.

No network.  Temp dir only.  Plain script style.

Run:
    python -m backend.tests.test_verdict_image
"""

from __future__ import annotations

import json
import math
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from PIL import Image

# --- Path setup -------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))

from backend.shared.verdict_caption import build_verdict_render_args  # noqa: E402
from backend.shared.verdict_image import render_verdict_image  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SGT = timezone(timedelta(hours=8))


def _make_jpeg(path: Path, w: int = 640, h: int = 480) -> Path:
    img = Image.new("RGB", (w, h), (200, 200, 200))
    img.save(path, format="JPEG")
    return path


def _make_case(**overrides) -> dict:
    """Build a minimal case dict for testing."""
    base: dict[str, Any] = {
        "case_metadata": {
            "case_id": "DISP-001",
            "dispute_type": "CLEANING_FEE",
            "resolution_channel": "FULLY_AUTOMATED",
        },
        "dispute_claim": {
            "case_id": "DISP-001",
            "image_evidence": [],
            "receipt_evidence": [],
        },
        "data_sources": {
            "trip_data": {
                "trip_end_time": "2026-09-25T22:05:00+08:00",
                "dropoff_location": {"lat": 1.3508, "lng": 103.8485},
            },
        },
    }
    base.update(overrides)
    return base


def _make_approved_case() -> dict:
    """Case with APPROVED verdict, receipt, stain regions, EXIF 10 min after."""
    return _make_case(
        case_metadata={
            "case_id": "DISP-001",
            "dispute_type": "CLEANING_FEE",
            "resolution_channel": "FULLY_AUTOMATED",
        },
        dispute_claim={
            "case_id": "DISP-001",
            "image_evidence": [
                {
                    "image_id": "IMG-001",
                    "image_url": "/evidence/DISP-001/IMG-001.jpg",
                    "exif_timestamp": "2026-09-25T22:15:00+08:00",
                    "exif_gps_location": {
                        "latitude": 1.3508,
                        "longitude": 103.8485,
                    },
                    "stain_regions": [
                        {"x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4},
                        {"x1": 0.5, "y1": 0.5, "x2": 0.7, "y2": 0.8},
                    ],
                    "provider_result": {
                        "stain_damage_classification": "VOMIT",
                        "damage_severity": "SEVERE",
                        "is_ai_generated": False,
                        "ai_generated_confidence": 0.1,
                    },
                }
            ],
            "receipt_evidence": [
                {
                    "receipt_id": "RCP-001",
                    "receipt_url": "/evidence/DISP-001/RCP-001.jpg",
                    "ocr_result": {
                        "amount": 55.0,
                        "currency": "SGD",
                        "merchant_name": "CleanCo",
                        "receipt_date": "2026-09-25T22:10:00+08:00",
                    },
                }
            ],
        },
        judge_verdict={
            "ruling_type": "APPROVED",
            "deliberated_at": "2026-09-25T22:30:00+08:00",
            "recommended_action": {
                "action_type": "REFUND",
                "cleaning_fee_amount": 60.0,
                "currency": "SGD",
                "account_action": "NONE",
                "penalty_target": "NONE",
            },
        },
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []
    tmp_dir = tempfile.mkdtemp(prefix="mirra_verdict_test_")

    try:
        # ===================================================================
        # CHECK a: APPROVED with receipt + stain_regions + EXIF 10 min
        # ===================================================================
        print("=" * 70)
        print("CHECK a: APPROVED -> stamp APPROVED, title has SGD 60.00, receipt + photo lines")
        print("=" * 70)
        check_a_errors: list[str] = []

        case_a = _make_approved_case()
        args_a = build_verdict_render_args(case_a, "IMG-001")

        if args_a is None:
            check_a_errors.append("render args is None")
        else:
            if args_a.get("stamp") != "APPROVED":
                check_a_errors.append(f"stamp: got {args_a.get('stamp')!r}, expected APPROVED")

            title = args_a.get("title", "")
            if "SGD 60.00" not in title:
                check_a_errors.append(f"title: got {title!r}, expected to contain 'SGD 60.00'")

            lines = args_a.get("lines", [])
            has_receipt = any("Receipt" in l for l in lines)
            has_photo = any("min after drop-off" in l for l in lines)
            if not has_receipt:
                check_a_errors.append(f"lines missing receipt line: {lines}")
            if not has_photo:
                check_a_errors.append(f"lines missing photo time line: {lines}")

            # 10 min after drop-off
            photo_line = [l for l in lines if "min after drop-off" in l]
            if photo_line and "10 min after drop-off" not in photo_line[0]:
                check_a_errors.append(f"expected '10 min after drop-off', got {photo_line[0]}")

            # region_label
            if args_a.get("region_label") != "VOMIT · SEVERE":
                check_a_errors.append(f"region_label: got {args_a.get('region_label')!r}")

            # regions
            if len(args_a.get("regions", [])) != 2:
                check_a_errors.append(f"regions: expected 2, got {len(args_a.get('regions', []))}")

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - stamp: {args_a['stamp']}")
            print(f"  - title: {args_a['title']}")
            print(f"  - lines: {args_a['lines']}")

        # ===================================================================
        # CHECK b: REJECTED with known_matches
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: REJECTED with known_matches -> stamp REJECTED, recycled line")
        print("=" * 70)
        check_b_errors: list[str] = []

        case_b = _make_case(
            case_metadata={
                "case_id": "DISP-001",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "FULLY_AUTOMATED",
            },
            dispute_claim={
                "case_id": "DISP-001",
                "image_evidence": [
                    {
                        "image_id": "IMG-001",
                        "image_url": "/evidence/DISP-001/IMG-001.jpg",
                        "known_matches": {"dhash:abc": "DISP-0871"},
                    }
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "REJECTED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "NO_REFUND",
                    "cleaning_fee_amount": 0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_b = build_verdict_render_args(case_b, "IMG-001")

        if args_b is None:
            check_b_errors.append("render args is None")
        else:
            if args_b.get("stamp") != "REJECTED":
                check_b_errors.append(f"stamp: got {args_b.get('stamp')!r}, expected REJECTED")

            lines = args_b.get("lines", [])
            has_recycled = any("Recycled photo: matches prior case DISP-0871" in l for l in lines)
            if not has_recycled:
                check_b_errors.append(f"lines missing recycled photo line: {lines}")

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - stamp: {args_b['stamp']}")
            print(f"  - lines: {args_b['lines']}")

        # ===================================================================
        # CHECK c: ESCALATED -> UNDER_REVIEW
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: ESCALATED -> UNDER_REVIEW")
        print("=" * 70)
        check_c_errors: list[str] = []

        case_c = _make_case(
            case_metadata={
                "case_id": "DISP-001",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "ESCALATED_HUMAN_REVIEW",
            },
            dispute_claim={
                "case_id": "DISP-001",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-001/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "ESCALATED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "ESCALATED_NO_ACTION",
                    "cleaning_fee_amount": 0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_c = build_verdict_render_args(case_c, "IMG-001")

        if args_c is None:
            check_c_errors.append("render args is None")
        else:
            if args_c.get("stamp") != "UNDER_REVIEW":
                check_c_errors.append(f"stamp: got {args_c.get('stamp')!r}, expected UNDER_REVIEW")
            if "PENDING HUMAN CONFIRMATION" not in (args_c.get("stamp_sub") or ""):
                check_c_errors.append(
                    f"stamp_sub: got {args_c.get('stamp_sub')!r}, expected PENDING HUMAN CONFIRMATION"
                )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - stamp: {args_c['stamp']}")
            print(f"  - stamp_sub: {args_c['stamp_sub']}")

        # ===================================================================
        # CHECK d: no judge_verdict -> stamp None, title "Analysis pending"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK d: no judge_verdict -> stamp None, title 'Analysis pending'")
        print("=" * 70)
        check_d_errors: list[str] = []

        case_d = _make_case(
            dispute_claim={
                "case_id": "DISP-001",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-001/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
        )
        args_d = build_verdict_render_args(case_d, "IMG-001")

        if args_d is None:
            check_d_errors.append("render args is None")
        else:
            if args_d.get("stamp") is not None:
                check_d_errors.append(f"stamp: got {args_d.get('stamp')!r}, expected None")
            if "Analysis pending" not in (args_d.get("title") or ""):
                check_d_errors.append(
                    f"title: got {args_d.get('title')!r}, expected 'Analysis pending'"
                )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print(f"  - stamp: {args_d['stamp']}")
            print(f"  - title: {args_d['title']}")

        # ===================================================================
        # CHECK e: no stain_regions / no provider_result -> regions [], no label
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK e: no stain_regions / no provider_result -> regions [], no label")
        print("=" * 70)
        check_e_errors: list[str] = []

        case_e = _make_case(
            dispute_claim={
                "case_id": "DISP-001",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-001/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "APPROVED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "REFUND",
                    "cleaning_fee_amount": 60.0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_e = build_verdict_render_args(case_e, "IMG-001")

        if args_e is None:
            check_e_errors.append("render args is None")
        else:
            if args_e.get("regions") != []:
                check_e_errors.append(f"regions: got {args_e.get('regions')!r}, expected []")
            if args_e.get("region_label") is not None:
                check_e_errors.append(
                    f"region_label: got {args_e.get('region_label')!r}, expected None"
                )

        if check_e_errors:
            print("\nCHECK e RESULT: FAIL")
            for e in check_e_errors:
                print(f"  - {e}")
            errors.extend(check_e_errors)
        else:
            print("\nCHECK e RESULT: PASS")
            print(f"  - regions: {args_e['regions']}")
            print(f"  - region_label: {args_e['region_label']}")

        # ===================================================================
        # CHECK f: render_verdict_image on 640x480 JPEG -> output exists,
        #          same width, taller, original unchanged
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK f: render_verdict_image -> output exists, wider=same, taller")
        print("=" * 70)
        check_f_errors: list[str] = []

        src_path = _make_jpeg(Path(tmp_dir) / "src.jpg", 640, 480)
        original_bytes = Path(src_path).read_bytes()
        out_path = Path(tmp_dir) / "out.jpg"

        try:
            render_verdict_image(
                src_path,
                out_path,
                stamp="APPROVED",
                stamp_sub="MIRRA AI · 25 SEP 2026",
                regions=[{"x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.3}],
                region_label="VOMIT · SEVERE",
                title="DISP-001 · Cleaning fee approved: SGD 60.00",
                lines=["Receipt SGD 55.00 (CleanCo, 25 Sep 22:10)"],
            )
        except Exception as exc:
            check_f_errors.append(f"render_verdict_image raised {type(exc).__name__}: {exc}")

        if not out_path.exists():
            check_f_errors.append("output file does not exist")
        else:
            out_img = Image.open(out_path)
            out_w, out_h = out_img.size
            if out_w != 640:
                check_f_errors.append(f"output width: got {out_w}, expected 640")
            if out_h <= 480:
                check_f_errors.append(f"output height: got {out_h}, expected > 480 (caption bar)")

            # Original file unchanged
            if Path(src_path).read_bytes() != original_bytes:
                check_f_errors.append("original file bytes changed")

        if check_f_errors:
            print("\nCHECK f RESULT: FAIL")
            for e in check_f_errors:
                print(f"  - {e}")
            errors.extend(check_f_errors)
        else:
            print("\nCHECK f RESULT: PASS")
            print(f"  - output size: {out_img.size}")
            print(f"  - original unchanged: True")

        # ===================================================================
        # CHECK g: unknown image_id -> None
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK g: unknown image_id -> None")
        print("=" * 70)
        check_g_errors: list[str] = []

        case_g = _make_approved_case()
        args_g = build_verdict_render_args(case_g, "IMG-999")

        if args_g is not None:
            check_g_errors.append(f"expected None, got {args_g!r}")

        if check_g_errors:
            print("\nCHECK g RESULT: FAIL")
            for e in check_g_errors:
                print(f"  - {e}")
            errors.extend(check_g_errors)
        else:
            print("\nCHECK g RESULT: PASS")
            print("  - returned None for unknown image_id")

        # ===================================================================
        # CHECK h: pending human + judge APPROVED -> UNDER_REVIEW,
        #          title "· Escalated for human review",
        #          sub "PENDING HUMAN CONFIRMATION"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK h: pending human + judge APPROVED -> UNDER_REVIEW, Escalated for human review")
        print("=" * 70)
        check_h_errors: list[str] = []

        case_h = _make_case(
            case_metadata={
                "case_id": "DISP-001",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "ESCALATED_HUMAN_REVIEW",
            },
            dispute_claim={
                "case_id": "DISP-001",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-001/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "APPROVED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "REFUND",
                    "cleaning_fee_amount": 60.0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_h = build_verdict_render_args(case_h, "IMG-001")

        if args_h is None:
            check_h_errors.append("render args is None")
        else:
            if args_h.get("stamp") != "UNDER_REVIEW":
                check_h_errors.append(
                    f"stamp: got {args_h.get('stamp')!r}, expected UNDER_REVIEW"
                )
            sub_h = args_h.get("stamp_sub") or ""
            if sub_h != "PENDING HUMAN CONFIRMATION":
                check_h_errors.append(
                    f"stamp_sub: got {sub_h!r}, expected 'PENDING HUMAN CONFIRMATION'"
                )
            title_h = args_h.get("title") or ""
            if "Escalated for human review" not in title_h:
                check_h_errors.append(
                    f"title: got {title_h!r}, expected to contain 'Escalated for human review'"
                )

        if check_h_errors:
            print("\nCHECK h RESULT: FAIL")
            for e in check_h_errors:
                print(f"  - {e}")
            errors.extend(check_h_errors)
        else:
            print("\nCHECK h RESULT: PASS")
            print(f"  - stamp: {args_h['stamp']}")
            print(f"  - stamp_sub: {args_h['stamp_sub']}")
            print(f"  - title: {args_h['title']}")

        # ===================================================================
        # CHECK i: REJECTED fully automated -> sub starts "MIRRA AI"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK i: REJECTED fully automated -> sub starts MIRRA AI")
        print("=" * 70)
        check_i_errors: list[str] = []

        case_i = _make_case(
            case_metadata={
                "case_id": "DISP-002",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "FULLY_AUTOMATED",
            },
            dispute_claim={
                "case_id": "DISP-002",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-002/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "REJECTED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "NO_REFUND",
                    "cleaning_fee_amount": 0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_i = build_verdict_render_args(case_i, "IMG-001")

        if args_i is None:
            check_i_errors.append("render args is None")
        else:
            if args_i.get("stamp") != "REJECTED":
                check_i_errors.append(
                    f"stamp: got {args_i.get('stamp')!r}, expected REJECTED"
                )
            sub_i = args_i.get("stamp_sub") or ""
            if not sub_i.startswith("MIRRA AI"):
                check_i_errors.append(
                    f"stamp_sub: got {sub_i!r}, expected to start with 'MIRRA AI'"
                )

        if check_i_errors:
            print("\nCHECK i RESULT: FAIL")
            for e in check_i_errors:
                print(f"  - {e}")
            errors.extend(check_i_errors)
        else:
            print("\nCHECK i RESULT: PASS")
            print(f"  - stamp: {args_i['stamp']}")
            print(f"  - stamp_sub: {args_i['stamp_sub']}")

        # ===================================================================
        # CHECK j: human OVERRIDDEN to REJECTED -> stamp REJECTED,
        #          sub starts "CONFIRMED BY HUMAN"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK j: human OVERRIDDEN to REJECTED -> CONFIRMED BY HUMAN")
        print("=" * 70)
        check_j_errors: list[str] = []

        case_j = _make_case(
            case_metadata={
                "case_id": "DISP-003",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "ESCALATED_HUMAN_REVIEW",
            },
            dispute_claim={
                "case_id": "DISP-003",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-003/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "APPROVED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "REFUND",
                    "cleaning_fee_amount": 60.0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
                "execution_payload": {
                    "human_confirmation_details": {
                        "reviewer_id": "REV-001",
                        "approval_decision": "OVERRIDDEN",
                        "approval_timestamp": "2026-09-26T10:00:00+08:00",
                        "modified_action": {
                            "action_type": "NO_REFUND",
                            "refund_amount": 0,
                            "currency": "SGD",
                            "ruling_type": "REJECTED",
                        },
                    },
                },
            },
        )
        args_j = build_verdict_render_args(case_j, "IMG-001")

        if args_j is None:
            check_j_errors.append("render args is None")
        else:
            if args_j.get("stamp") != "REJECTED":
                check_j_errors.append(
                    f"stamp: got {args_j.get('stamp')!r}, expected REJECTED"
                )
            sub_j = args_j.get("stamp_sub") or ""
            if not sub_j.startswith("CONFIRMED BY HUMAN"):
                check_j_errors.append(
                    f"stamp_sub: got {sub_j!r}, expected to start with 'CONFIRMED BY HUMAN'"
                )

        if check_j_errors:
            print("\nCHECK j RESULT: FAIL")
            for e in check_j_errors:
                print(f"  - {e}")
            errors.extend(check_j_errors)
        else:
            print("\nCHECK j RESULT: PASS")
            print(f"  - stamp: {args_j['stamp']}")
            print(f"  - stamp_sub: {args_j['stamp_sub']}")

        # ===================================================================
        # CHECK k: pending human + judge ESCALATED -> UNDER_REVIEW,
        #          title "· Escalated for human review",
        #          sub "PENDING HUMAN CONFIRMATION"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK k: pending human + judge ESCALATED -> UNDER_REVIEW, Escalated for human review")
        print("=" * 70)
        check_k_errors: list[str] = []

        case_k = _make_case(
            case_metadata={
                "case_id": "DISP-004",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "ESCALATED_HUMAN_REVIEW",
            },
            dispute_claim={
                "case_id": "DISP-004",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-004/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "ESCALATED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "ESCALATED_NO_ACTION",
                    "cleaning_fee_amount": 0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
            },
        )
        args_k = build_verdict_render_args(case_k, "IMG-001")

        if args_k is None:
            check_k_errors.append("render args is None")
        else:
            if args_k.get("stamp") != "UNDER_REVIEW":
                check_k_errors.append(
                    f"stamp: got {args_k.get('stamp')!r}, expected UNDER_REVIEW"
                )
            sub_k = args_k.get("stamp_sub") or ""
            if sub_k != "PENDING HUMAN CONFIRMATION":
                check_k_errors.append(
                    f"stamp_sub: got {sub_k!r}, expected 'PENDING HUMAN CONFIRMATION'"
                )
            title_k = args_k.get("title") or ""
            if "Escalated for human review" not in title_k:
                check_k_errors.append(
                    f"title: got {title_k!r}, expected to contain 'Escalated for human review'"
                )

        if check_k_errors:
            print("\nCHECK k RESULT: FAIL")
            for e in check_k_errors:
                print(f"  - {e}")
            errors.extend(check_k_errors)
        else:
            print("\nCHECK k RESULT: PASS")
            print(f"  - stamp: {args_k['stamp']}")
            print(f"  - stamp_sub: {args_k['stamp_sub']}")
            print(f"  - title: {args_k['title']}")

        # ===================================================================
        # CHECK l: human MODIFIED with cleaning_fee_amount 40
        #          -> stamp APPROVED, title ends ": SGD 40.00",
        #          sub "CONFIRMED BY HUMAN · <date>"
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK l: human MODIFIED cleaning_fee_amount 40 -> APPROVED, SGD 40.00")
        print("=" * 70)
        check_l_errors: list[str] = []

        case_l = _make_case(
            case_metadata={
                "case_id": "DISP-005",
                "dispute_type": "CLEANING_FEE",
                "resolution_channel": "ESCALATED_HUMAN_REVIEW",
            },
            dispute_claim={
                "case_id": "DISP-005",
                "image_evidence": [
                    {"image_id": "IMG-001", "image_url": "/evidence/DISP-005/IMG-001.jpg"},
                ],
                "receipt_evidence": [],
            },
            judge_verdict={
                "ruling_type": "APPROVED",
                "deliberated_at": "2026-09-25T22:30:00+08:00",
                "recommended_action": {
                    "action_type": "REFUND",
                    "cleaning_fee_amount": 60.0,
                    "currency": "SGD",
                    "account_action": "NONE",
                    "penalty_target": "NONE",
                },
                "execution_payload": {
                    "human_confirmation_details": {
                        "reviewer_id": "REV-002",
                        "approval_decision": "MODIFIED",
                        "approval_timestamp": "2026-09-26T10:00:00+08:00",
                        "modified_action": {
                            "action_type": "REFUND",
                            "refund_amount": 40,
                            "currency": "SGD",
                            "ruling_type": "APPROVED",
                            "cleaning_fee_amount": 40,
                        },
                    },
                },
            },
        )
        args_l = build_verdict_render_args(case_l, "IMG-001")

        if args_l is None:
            check_l_errors.append("render args is None")
        else:
            if args_l.get("stamp") != "APPROVED":
                check_l_errors.append(
                    f"stamp: got {args_l.get('stamp')!r}, expected APPROVED"
                )
            title_l = args_l.get("title") or ""
            if not title_l.endswith(": SGD 40.00"):
                check_l_errors.append(
                    f"title: got {title_l!r}, expected to end with ': SGD 40.00'"
                )
            sub_l = args_l.get("stamp_sub") or ""
            if not sub_l.startswith("CONFIRMED BY HUMAN"):
                check_l_errors.append(
                    f"stamp_sub: got {sub_l!r}, expected to start with 'CONFIRMED BY HUMAN'"
                )
            if "26 SEP 2026" not in sub_l:
                check_l_errors.append(
                    f"stamp_sub: got {sub_l!r}, expected to contain '26 SEP 2026'"
                )

        if check_l_errors:
            print("\nCHECK l RESULT: FAIL")
            for e in check_l_errors:
                print(f"  - {e}")
            errors.extend(check_l_errors)
        else:
            print("\nCHECK l RESULT: PASS")
            print(f"  - stamp: {args_l['stamp']}")
            print(f"  - title: {args_l['title']}")
            print(f"  - stamp_sub: {args_l['stamp_sub']}")

        # ===================================================================
        # CHECK m: fully automated APPROVED -> unchanged (MIRRA AI · date)
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK m: fully automated APPROVED -> unchanged (MIRRA AI · date)")
        print("=" * 70)
        check_m_errors: list[str] = []

        case_m = _make_approved_case()
        args_m = build_verdict_render_args(case_m, "IMG-001")

        if args_m is None:
            check_m_errors.append("render args is None")
        else:
            if args_m.get("stamp") != "APPROVED":
                check_m_errors.append(
                    f"stamp: got {args_m.get('stamp')!r}, expected APPROVED"
                )
            title_m = args_m.get("title") or ""
            if "SGD 60.00" not in title_m:
                check_m_errors.append(
                    f"title: got {title_m!r}, expected to contain 'SGD 60.00'"
                )
            sub_m = args_m.get("stamp_sub") or ""
            if not sub_m.startswith("MIRRA AI"):
                check_m_errors.append(
                    f"stamp_sub: got {sub_m!r}, expected to start with 'MIRRA AI'"
                )

        if check_m_errors:
            print("\nCHECK m RESULT: FAIL")
            for e in check_m_errors:
                print(f"  - {e}")
            errors.extend(check_m_errors)
        else:
            print("\nCHECK m RESULT: PASS")
            print(f"  - stamp: {args_m['stamp']}")
            print(f"  - title: {args_m['title']}")
            print(f"  - stamp_sub: {args_m['stamp_sub']}")

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

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
