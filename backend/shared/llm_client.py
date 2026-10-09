"""
Shared async DeepSeek LLM client used by all agents.

Each agent calls `call_llm_json(...)` to get a parsed dict back from the
DeepSeek chat-completions API in JSON-object response format.
"""

import asyncio
import json
import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# --- Environment / configuration -------------------------------------------------

logger = logging.getLogger(__name__)

# Resolve backend/.env relative to this file so the client works regardless of
# the current working directory (important under uvicorn / pytest).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"
load_dotenv(_ENV_FILE)

_API_KEY = os.getenv("DEEPSEEK_API_KEY")
_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
_BASE_URL = "https://api.deepseek.com/v1/chat/completions"

# Env-driven defaults (read once at import; invalid/missing -> fallback).
_DEFAULT_TIMEOUT_S: float = 60.0
_DEFAULT_MAX_RETRIES: int = 1

_env_timeout = os.getenv("LLM_TIMEOUT_S")
if _env_timeout:
    try:
        _DEFAULT_TIMEOUT_S = float(_env_timeout)
    except (TypeError, ValueError):
        pass

_env_retries = os.getenv("LLM_MAX_RETRIES")
if _env_retries:
    try:
        _DEFAULT_MAX_RETRIES = int(_env_retries)
    except (TypeError, ValueError):
        pass


# --- Errors ---------------------------------------------------------------------


class LLMError(Exception):
    """Raised when the LLM call ultimately fails after all retries."""


# --- Main entry point -----------------------------------------------------------


async def call_llm_json(
    system_prompt: str,
    user_prompt: str,
    thinking: bool = False,
    temperature: float = 0.1,
    reasoning_effort: str = "high",
    max_retries: int | None = None,
    timeout_s: float | None = None,
) -> dict:
    """
    Call DeepSeek chat-completions and return parsed JSON from message.content.

    Args:
        system_prompt: System message guiding the model's behavior.
        user_prompt: User message containing the task / input data.
        thinking: If True, enable DeepSeek thinking mode (reasoning_content).
        temperature: Sampling temperature (used only when thinking is False).
        reasoning_effort: Effort level for thinking mode ("high" / "medium" ...).
        max_retries: Number of retry attempts on transient failures.
            If None, falls back to LLM_MAX_RETRIES env var or 1.
        timeout_s: Per-request timeout in seconds.
            If None, falls back to LLM_TIMEOUT_S env var or 60.

    Returns:
        Parsed dict from the model's JSON response.

    Raises:
        LLMError: If the API key is missing or all retries are exhausted.
    """
    # Fail fast with a clear message if the key was never configured.
    if not _API_KEY:
        raise LLMError(
            "DEEPSEEK_API_KEY is not set. Please add it to backend/.env "
            "(e.g. DEEPSEEK_API_KEY=sk-...)."
        )

    # Resolve None to env / module-level defaults.
    if timeout_s is None:
        timeout_s = _DEFAULT_TIMEOUT_S
    if max_retries is None:
        max_retries = _DEFAULT_MAX_RETRIES

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # Build the request payload once. Thinking mode changes several fields.
    def _build_payload() -> dict:
        payload: dict = {
            "model": _MODEL,
            "messages": messages,
            "response_format": {"type": "json_object"},
        }

        if thinking:
            # Thinking mode: enable thinking + reasoning_effort, no temperature
            # (thinking mode does not support temperature).
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = reasoning_effort
        else:
            # Non-thinking mode: explicitly disable thinking and set temperature.
            payload["thinking"] = {"type": "disabled"}
            payload["temperature"] = temperature

        return payload

    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }

    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(
                    _BASE_URL,
                    headers=headers,
                    json=_build_payload(),
                )
                resp.raise_for_status()  # raises httpx.HTTPStatusError on 4xx/5xx

            data = resp.json()

            # Parse JSON from message.content only; ignore reasoning_content.
            content = data["choices"][0]["message"]["content"]
            if not content:
                # Empty content (e.g. pure reasoning) is treated as a parse error.
                raise ValueError("Empty content in model response")

            return json.loads(content)

        except (
            httpx.HTTPError,
            json.JSONDecodeError,
            KeyError,
            IndexError,
            ValueError,
        ) as exc:
            # Retry on network errors, non-JSON responses, or missing keys.
            last_error = exc
            if attempt < max_retries:
                # Short increasing backoff: 1s, 2s, 3s ...
                await asyncio.sleep(1.0 * (attempt + 1))
                continue

    # All retries exhausted.
    raise LLMError(
        f"DeepSeek LLM call failed after {max_retries + 1} attempts. "
        f"Last error: {last_error}"
    )


# --- Connectivity test ----------------------------------------------------------


async def _run_test(thinking: bool) -> None:
    """Run a single call_llm_json test and print result + elapsed time."""
    mode = "thinking" if thinking else "non-thinking"
    system_prompt = "You are a test assistant. Reply in JSON."
    user_prompt = (
        'Return exactly this JSON: '
        '{"ok": true, "mode": "<thinking or non-thinking>"}'
    )

    import time

    start = time.perf_counter()
    try:
        result = await call_llm_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            thinking=thinking,
        )
        elapsed = time.perf_counter() - start
        print(f"[{mode}] result: {result}  ({elapsed:.2f}s)")
    except LLMError as exc:
        elapsed = time.perf_counter() - start
        print(f"[{mode}] LLMError after {elapsed:.2f}s: {exc}")


if __name__ == "__main__":
    # Quick manual connectivity check: run both modes, don't crash on errors.
    asyncio.run(_run_test(thinking=False))
    asyncio.run(_run_test(thinking=True))
