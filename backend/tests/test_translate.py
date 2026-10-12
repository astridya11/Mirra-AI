"""Tests for the display-translation endpoint — no network, LLM mocked.

Run from repo root:
    python -m pytest backend/tests/test_translate.py -v --noconftest
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import backend.shared.translate as tr  # noqa: E402
from backend.main import app  # noqa: E402

client = TestClient(app)


def test_translates_dedupes_and_caches():
    tr._cache.clear()
    llm = AsyncMock(return_value={"translations": ["甲", "乙"]})
    with patch.object(tr, "call_llm_json", llm):
        r = client.post("/api/translate", json={"texts": ["A text", "B text", "A text"]})
        assert r.status_code == 200
        assert r.json() == {"translations": ["甲", "乙", "甲"]}
        r2 = client.post("/api/translate", json={"texts": ["B text"]})
        assert r2.json() == {"translations": ["乙"]}
    assert llm.await_count == 1  # second call served from cache


def test_llm_failure_is_502_and_mismatch_rejected():
    tr._cache.clear()
    with patch.object(tr, "call_llm_json", AsyncMock(side_effect=RuntimeError("down"))):
        assert client.post("/api/translate", json={"texts": ["x"]}).status_code == 502
    with patch.object(tr, "call_llm_json", AsyncMock(return_value={"translations": []})):
        assert client.post("/api/translate", json={"texts": ["x"]}).status_code == 502


def test_validation():
    assert client.post("/api/translate", json={"texts": []}).status_code == 422
    assert client.post("/api/translate", json={"texts": ["x"], "target": "fr"}).status_code == 422
    assert client.post("/api/translate", json={"texts": ["x" * 4001]}).status_code == 413
