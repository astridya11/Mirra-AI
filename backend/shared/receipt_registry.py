"""Runtime receipt-hash registry — detects recycled receipts across cases.

Mirrors the pattern of ``backend/shared/photo_evidence.py``:

  * Runtime file: ``backend/disputes/known_receipt_hashes.runtime.json``
    (gitignored, never committed).
  * Atomic write (temp file + ``os.replace``) under a threading lock.
  * Never raises: all filesystem / JSON errors are swallowed.
  * Never overwrites an existing owner.

For each registered receipt we store:

  * ``sha256`` — of the raw file bytes.
  * ``dhash`` — the 64-bit perceptual image hash (reuses the dHash function
    in ``photo_evidence.py``, never copied).
  * ``ocr_key`` — ``"merchant|amount|date"`` (merchant lower-cased and
    whitespace-collapsed, amount to 2 dp, ``receipt_date`` as ``YYYY-MM-DD``).
    The key is omitted when any part is missing.

``find_receipt_match`` checks in order: identical file → near-duplicate image
(Hamming distance ≤ threshold) → same merchant/amount/date.  A match owned by
the *same* case is not reported.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from PIL import Image

from backend.shared.photo_evidence import (
    _compute_dhash,
    _hamming_distance,
    _HASH_DISTANCE_THRESHOLD,
    _MIN_HASH_BITS,
    _MAX_HASH_BITS,
    _popcount,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_THIS_DIR = Path(__file__).resolve().parent          # backend/shared/
_BACKEND_DIR = _THIS_DIR.parent                       # backend/

RUNTIME_RECEIPT_HASHES_PATH = (
    _BACKEND_DIR / "disputes" / "known_receipt_hashes.runtime.json"
)

_REGISTRY_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# JSON loading helper (mirrors photo_evidence._load_json)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    """Load a JSON object from *path*.  Returns {} on any error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------

def _sha256(file_bytes: bytes) -> str:
    """Return the hex SHA-256 digest of *file_bytes*."""
    return hashlib.sha256(file_bytes).hexdigest()


def _dhash_from_bytes(file_bytes: bytes) -> str | None:
    """Compute a dHash string from raw image bytes.

    Opens the bytes with Pillow and delegates to ``photo_evidence._compute_dhash``.
    Returns ``None`` on any error or when the hash has degenerate bit density
    (same quality guard as the photo registry).
    """
    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.load()
    except Exception:
        return None
    h = _compute_dhash(img)
    if h is None:
        return None
    bits = _popcount(h)
    if bits is None or not (_MIN_HASH_BITS <= bits <= _MAX_HASH_BITS):
        return None
    return h


# ---------------------------------------------------------------------------
# OCR key
# ---------------------------------------------------------------------------

_WHITESPACE_RE = re.compile(r"\s+")


def _build_ocr_key(ocr_result: dict[str, Any] | None) -> str | None:
    """Build the ``"merchant|amount|date"`` key from an OCR result.

    Merchant is lower-cased and whitespace-collapsed.
    Amount is formatted to 2 decimal places.
    ``receipt_date`` is normalised to ``YYYY-MM-DD``.

    Returns ``None`` when any of the three parts is missing or invalid.
    """
    if not isinstance(ocr_result, dict):
        return None

    merchant = ocr_result.get("merchant_name")
    if not isinstance(merchant, str) or not merchant.strip():
        return None
    merchant_key = _WHITESPACE_RE.sub(" ", merchant.strip()).lower()

    amount = ocr_result.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)):
        return None
    try:
        amount_f = float(amount)
    except (TypeError, ValueError):
        return None
    if amount_f != amount_f:  # NaN check
        return None
    amount_key = f"{amount_f:.2f}"

    receipt_date = ocr_result.get("receipt_date")
    if not isinstance(receipt_date, str) or not receipt_date.strip():
        return None
    # Normalise to YYYY-MM-DD.
    date_key = _normalise_date(receipt_date)
    if date_key is None:
        return None

    return f"{merchant_key}|{amount_key}|{date_key}"


def _normalise_date(value: str) -> str | None:
    """Normalise an ISO 8601-ish string to ``YYYY-MM-DD``.

    Handles trailing timezone offsets and ``Z``.  Returns ``None`` if the
    date portion cannot be parsed.
    """
    raw = value.strip().replace("Z", "+00:00")
    # Split off time/timezone if present — we only need the date part.
    date_part = raw.split("T")[0].split(" ")[0]
    parts = date_part.split("-")
    if len(parts) < 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, IndexError):
        return None
    if not (1 <= m <= 12 and 1 <= d <= 31 and y >= 1900):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


# ---------------------------------------------------------------------------
# Registry entry helpers
# ---------------------------------------------------------------------------

def _make_entry(
    file_bytes: bytes,
    ocr_result: dict[str, Any] | None,
    case_id: str,
    receipt_id: str,
) -> dict[str, Any]:
    """Build a registry entry dict (without the key)."""
    entry: dict[str, Any] = {
        "case_id": case_id,
        "receipt_id": receipt_id,
        "sha256": _sha256(file_bytes),
    }
    dhash = _dhash_from_bytes(file_bytes)
    if dhash is not None:
        entry["dhash"] = dhash
    ocr_key = _build_ocr_key(ocr_result)
    if ocr_key is not None:
        entry["ocr_key"] = ocr_key
    return entry


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def find_receipt_match(
    file_bytes: bytes,
    ocr_result: dict[str, Any] | None,
    case_id: str,
    *,
    path: Path | None = None,
) -> dict[str, str] | None:
    """Search the runtime registry for a prior receipt that matches.

    Checks in order: identical file → near-duplicate image → same
    merchant/amount/date.  A match owned by the *same* ``case_id`` is
    not reported.

    Returns ``{"case_id", "receipt_id", "reason"}`` on the first match,
    or ``None``.

    ``reason`` is one of:
      ``IDENTICAL_FILE``, ``NEAR_DUPLICATE_IMAGE``, ``SAME_MERCHANT_AMOUNT_DATE``

    Never raises.
    """
    if not isinstance(file_bytes, bytes) or not file_bytes:
        return None
    if not isinstance(case_id, str) or not case_id:
        return None

    runtime_path = RUNTIME_RECEIPT_HASHES_PATH if path is None else Path(path)

    try:
        registry = _load_json(runtime_path)
    except Exception:
        return None

    if not registry or not isinstance(registry, dict):
        return None

    this_sha = _sha256(file_bytes)
    this_dhash = _dhash_from_bytes(file_bytes)
    this_ocr_key = _build_ocr_key(ocr_result)

    # --- Pass 1: IDENTICAL_FILE (SHA-256) --------------------------------
    for _key, entry in registry.items():
        if not isinstance(entry, dict):
            continue
        if entry.get("sha256") == this_sha:
            owner = entry.get("case_id", "")
            if owner != case_id:
                return {
                    "case_id": owner,
                    "receipt_id": entry.get("receipt_id", ""),
                    "reason": "IDENTICAL_FILE",
                }

    # --- Pass 2: NEAR_DUPLICATE_IMAGE (Hamming distance) -----------------
    if this_dhash is not None:
        for _key, entry in registry.items():
            if not isinstance(entry, dict):
                continue
            entry_dhash = entry.get("dhash")
            if not isinstance(entry_dhash, str):
                continue
            dist = _hamming_distance(this_dhash, entry_dhash)
            if dist is None:
                continue
            if dist <= _HASH_DISTANCE_THRESHOLD:
                owner = entry.get("case_id", "")
                if owner != case_id:
                    return {
                        "case_id": owner,
                        "receipt_id": entry.get("receipt_id", ""),
                        "reason": "NEAR_DUPLICATE_IMAGE",
                    }

    # --- Pass 3: SAME_MERCHANT_AMOUNT_DATE --------------------------------
    if this_ocr_key is not None:
        for _key, entry in registry.items():
            if not isinstance(entry, dict):
                continue
            entry_key = entry.get("ocr_key")
            if entry_key == this_ocr_key:
                owner = entry.get("case_id", "")
                if owner != case_id:
                    return {
                        "case_id": owner,
                        "receipt_id": entry.get("receipt_id", ""),
                        "reason": "SAME_MERCHANT_AMOUNT_DATE",
                    }

    return None


def register_receipt(
    file_bytes: bytes,
    ocr_result: dict[str, Any] | None,
    case_id: str,
    receipt_id: str,
    *,
    path: Path | None = None,
) -> bool:
    """Register a receipt in the runtime registry.

    Returns ``True`` if the receipt was newly registered, ``False`` if it
    was skipped (bad input, already owned, or filesystem error).

    Never raises: all filesystem / JSON errors are swallowed.

    A receipt with an identical SHA-256 already in the registry is **not**
    overwritten — the first owner wins.
    """
    if not isinstance(file_bytes, bytes) or not file_bytes:
        return False
    if not isinstance(case_id, str) or not case_id:
        return False
    if not isinstance(receipt_id, str) or not receipt_id:
        return False

    runtime_path = RUNTIME_RECEIPT_HASHES_PATH if path is None else Path(path)

    try:
        with _REGISTRY_LOCK:
            existing = _load_json(runtime_path)

            this_sha = _sha256(file_bytes)

            # Do not overwrite an existing entry with the same SHA-256.
            for _key, entry in existing.items():
                if isinstance(entry, dict) and entry.get("sha256") == this_sha:
                    return False

            entry = _make_entry(file_bytes, ocr_result, case_id, receipt_id)
            # Use sha256 as the registry key (unique per file content).
            existing[this_sha] = entry

            # Write atomically: temp file + os.replace.
            runtime_path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(
                dir=str(runtime_path.parent),
                prefix=".runtime_receipt_hashes_",
                suffix=".tmp",
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(existing, f, indent=2, sort_keys=True)
                os.replace(tmp_path, runtime_path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                return False

            return True
    except Exception:
        return False
