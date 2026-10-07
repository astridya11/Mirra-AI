"""Upload → file + schema evidence adapter.

This module turns uploaded evidence (base64 data URLs from the frontend)
into saved files on disk plus ``ImageEvidenceInput`` / ``ReceiptEvidenceInput``
dicts (schema-defined in ``shared/schemas.json``).

For each data-URL item the bytes are validated (mime, base64, size, magic
bytes), written **unchanged** to ``uploads_dir/case_id/<ID>.<ext>`` (no
re-encode — preserves EXIF), and then passed to ``build_image_evidence`` /
``build_receipt_evidence`` with the appropriate annotation.

Plain-URL and dict items are passed through without writing any file.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from backend.shared.photo_evidence import build_image_evidence, register_image_hash
from backend.shared.receipt_evidence import build_receipt_evidence

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_THIS_DIR = Path(__file__).resolve().parent  # backend/shared/
_BACKEND_DIR = _THIS_DIR.parent  # backend/

UPLOADS_DIR = _BACKEND_DIR / "disputes" / "uploads"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

_MOCK_EVIDENCE_DIR = _BACKEND_DIR / "mock_evidence"
_DEFAULT_PHOTO_ANNOTATIONS_PATH = _MOCK_EVIDENCE_DIR / "photo_annotations.json"
_DEFAULT_RECEIPT_ANNOTATIONS_PATH = _MOCK_EVIDENCE_DIR / "receipt_annotations.json"

_CASE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# Magic bytes (prefix) for each allowed mime type.
_MAGIC_BYTES: dict[str, bytes] = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}

_MIME_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
}


class EvidenceUploadError(ValueError):
    """Raised when an uploaded evidence item fails validation."""


# ---------------------------------------------------------------------------
# JSON loading helpers
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
# Data-URL parsing
# ---------------------------------------------------------------------------

def _parse_data_url(item: str) -> tuple[str, bytes]:
    """Parse ``data:<mime>;base64,<payload>`` → (mime, decoded_bytes).

    Raises ``EvidenceUploadError`` on any validation failure.
    """
    try:
        header, payload = item.split(",", 1)
    except ValueError:
        raise EvidenceUploadError("invalid data URL: missing comma separator")

    # header is like "data:image/jpeg;base64"
    if not header.startswith("data:"):
        raise EvidenceUploadError("invalid data URL: must start with 'data:'")

    meta = header[5:]  # strip "data:"
    parts = meta.split(";")
    mime = parts[0].lower() if parts else ""

    if "base64" not in [p.lower() for p in parts[1:]]:
        raise EvidenceUploadError("invalid data URL: must be base64 encoded")

    if mime not in _MIME_EXT:
        raise EvidenceUploadError(f"unsupported mime type: {mime or 'empty'}")

    try:
        decoded = base64.b64decode(payload, validate=True)
    except Exception:
        raise EvidenceUploadError("invalid base64 payload")

    if len(decoded) > MAX_UPLOAD_BYTES:
        raise EvidenceUploadError("file exceeds maximum upload size")

    expected_magic = _MAGIC_BYTES[mime]
    if not decoded.startswith(expected_magic):
        raise EvidenceUploadError("file content does not match declared type")

    return mime, decoded


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_uploaded_evidence(
    case_id: str,
    image_items: list,
    receipt_items: list,
    filed_at: str,
    *,
    uploads_dir: Path | None = None,
    url_prefix: str = "/evidence",
    photo_annotations: dict | None = None,
    receipt_annotations: dict | None = None,
    use_vision: bool | None = None,
    register_hashes: bool = True,
) -> tuple[list[dict], list[dict]]:
    """Process uploaded evidence items and return (image_evidence, receipt_evidence).

    For each item:
      a) ``str`` starting with ``"data:"`` — parsed as a base64 data URL,
         validated, written to disk, and passed to the evidence builder.
      b) Other non-empty ``str`` — treated as a plain URL/path; passed
         through with the positional ID, no file written.
      c) ``dict`` — copied; ``id`` is set via setdefault; ``url`` must be
         present and non-empty; no file written.
      d) Anything else (or empty str) → ``EvidenceUploadError``.

    IDs are assigned by position: ``IMG-001``, ``IMG-002`` ... for images
    and ``RCP-001``, ``RCP-002`` ... for receipts.

    If any item fails, the per-case upload directory is deleted (only if
    this call created it) and the error is re-raised.  No half-saved files
    are left behind.

    Error messages never contain filesystem paths.
    """
    # --- Validate case_id (no path traversal) -------------------------------
    if not isinstance(case_id, str) or not _CASE_ID_RE.match(case_id):
        raise EvidenceUploadError("invalid case_id: must match ^[A-Za-z0-9_-]+$")

    # --- Resolve use_vision from env if not given ---------------------------
    if use_vision is None:
        use_vision = os.getenv("MIRRA_VISION", "off").strip().lower() == "deepseek"

    # --- Resolve dirs and annotations ---------------------------------------
    root_uploads = UPLOADS_DIR if uploads_dir is None else Path(uploads_dir)
    case_uploads = root_uploads / case_id

    if photo_annotations is None:
        photo_annotations = _load_json(_DEFAULT_PHOTO_ANNOTATIONS_PATH)
    if receipt_annotations is None:
        receipt_annotations = _load_json(_DEFAULT_RECEIPT_ANNOTATIONS_PATH)

    # Track whether *this call* created the case dir so we can clean up.
    we_created_case_dir = False

    def _ensure_case_dir() -> None:
        nonlocal we_created_case_dir
        if not case_uploads.exists():
            case_uploads.mkdir(parents=True, exist_ok=True)
            we_created_case_dir = True

    def _cleanup() -> None:
        if we_created_case_dir and case_uploads.exists():
            shutil.rmtree(case_uploads, ignore_errors=True)

    # ------------------------------------------------------------------
    # Process images
    # ------------------------------------------------------------------
    image_evidence: list[dict] = []

    try:
        for idx, item in enumerate(image_items, start=1):
            image_id = f"IMG-{idx:03d}"

            if isinstance(item, str) and item.startswith("data:"):
                mime, decoded = _parse_data_url(item)
                ext = _MIME_EXT[mime]
                _ensure_case_dir()
                file_path = case_uploads / f"{image_id}.{ext}"
                file_path.write_bytes(decoded)
                url = f"{url_prefix}/{case_id}/{image_id}.{ext}"
                annotation = photo_annotations.get(f"{case_id}/{image_id}") or {}
                ev = build_image_evidence(
                    file_path, image_id, url, annotation=annotation,
                    use_vision=use_vision,
                    current_case_id=case_id,
                )

            elif isinstance(item, str) and item.strip():
                ev = {"image_id": image_id, "image_url": item}

            elif isinstance(item, dict):
                ev = dict(item)
                ev.setdefault("image_id", image_id)
                url_val = ev.get("image_url")
                if not isinstance(url_val, str) or not url_val.strip():
                    raise EvidenceUploadError(
                        f"image item {image_id}: missing or empty image_url"
                    )

            else:
                raise EvidenceUploadError(
                    f"image item {image_id}: must be a data URL, plain URL, or dict"
                )

            image_evidence.append(ev)

    except Exception:
        _cleanup()
        raise

    # ------------------------------------------------------------------
    # Process receipts
    # ------------------------------------------------------------------
    receipt_evidence: list[dict] = []

    try:
        for idx, item in enumerate(receipt_items, start=1):
            receipt_id = f"RCP-{idx:03d}"

            if isinstance(item, str) and item.startswith("data:"):
                mime, decoded = _parse_data_url(item)
                ext = _MIME_EXT[mime]
                _ensure_case_dir()
                file_path = case_uploads / f"{receipt_id}.{ext}"
                file_path.write_bytes(decoded)
                url = f"{url_prefix}/{case_id}/{receipt_id}.{ext}"
                annotation = receipt_annotations.get(f"{case_id}/{receipt_id}") or {}
                ev = build_receipt_evidence(
                    file_path,
                    receipt_id,
                    url,
                    uploaded_at=filed_at,
                    annotation=annotation,
                    use_vision=use_vision,
                )

            elif isinstance(item, str) and item.strip():
                ev = {
                    "receipt_id": receipt_id,
                    "receipt_url": item,
                    "uploaded_at": filed_at,
                }

            elif isinstance(item, dict):
                ev = dict(item)
                ev.setdefault("receipt_id", receipt_id)
                url_val = ev.get("receipt_url")
                if not isinstance(url_val, str) or not url_val.strip():
                    raise EvidenceUploadError(
                        f"receipt item {receipt_id}: missing or empty receipt_url"
                    )
                ev.setdefault("uploaded_at", filed_at)

            else:
                raise EvidenceUploadError(
                    f"receipt item {receipt_id}: must be a data URL, plain URL, or dict"
                )

            receipt_evidence.append(ev)

    except Exception:
        _cleanup()
        raise

    # ------------------------------------------------------------------
    # Register image hashes AFTER all evidence is built successfully.
    # A case never matches its own photo because build_image_evidence
    # was called with current_case_id (self-entries are filtered out).
    # ------------------------------------------------------------------
    if register_hashes:
        for ev in image_evidence:
            img_hash = ev.get("image_hash")
            if img_hash:
                register_image_hash(img_hash, case_id)

    return image_evidence, receipt_evidence
