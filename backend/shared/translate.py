"""
Display-only translation of backend free text (agent statements, Judge reasoning, image analysis)
for the Chinese frontend. Reuses the shared DeepSeek client. Never touches stored case data.
"""

from __future__ import annotations

import hashlib

from backend.shared.llm_client import call_llm_json

_SYSTEM = (
    "You translate dispute-resolution text from English into natural Simplified Chinese for a ride-hailing app. "
    "Translate meaning faithfully; do not add, remove or soften facts. Keep these exactly as written: case/trip/evidence IDs "
    "(e.g. DISP-019, IMG-001, RCP-001, TRIP-2026-08112), policy IDs (POL-2), amounts and currencies (S$3.25, $5.00, SGD), "
    "times, dates, numbers, road names (ECP, PIE), place names and UPPER_SNAKE_CASE enum tokens. "
    'Return JSON: {"translations": [...]} with exactly one string per input, in the same order.'
)

# ponytail: in-process cache, unbounded per text; swap for an LRU/Redis if traffic grows.
_cache: dict[str, str] = {}


def _key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def translate_to_zh(texts: list[str]) -> list[str]:
    todo = list(dict.fromkeys(t for t in texts if _key(t) not in _cache))
    if todo:
        out = await call_llm_json(_SYSTEM, "Translate:\n" + _json_list(todo), temperature=0.1)
        translations = out.get("translations") if isinstance(out, dict) else None
        if not isinstance(translations, list) or len(translations) != len(todo):
            raise ValueError("translation count mismatch")
        for src, zh in zip(todo, translations):
            if isinstance(zh, str) and zh.strip():
                _cache[_key(src)] = zh
    return [_cache.get(_key(t), t) for t in texts]


def _json_list(items: list[str]) -> str:
    import json

    return json.dumps(items, ensure_ascii=False)
