"""Standalone tests for backend/shared/llm_client.py call_llm_json.

Never calls the network: monkeypatches httpx.AsyncClient.post to raise
httpx.ConnectError and monkeypatches asyncio.sleep to return immediately.

Run:
    python backend/tests/test_llm_client.py

No function defined at module level starts with "test_" so pytest will
not collect this file.
"""

import asyncio
import importlib
import os
import sys
from pathlib import Path
from typing import Any

import httpx

# --- Path setup (relative to this file, not CWD) ------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR.parent))  # so `backend...` imports work

import backend.shared.llm_client as llm_mod  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tracking_post(call_log: list, timeout_log: list):
    """Return a fake AsyncClient that records calls and always raises.

    The fake captures the timeout passed to httpx.AsyncClient.__init__ and
    records each post() invocation in *call_log*.
    """

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            timeout_log.append(kwargs.get("timeout"))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def post(self, *args, **kwargs):
            call_log.append(1)
            raise httpx.ConnectError("simulated network failure")

    return _FakeAsyncClient


async def _noop_sleep(*args, **kwargs):
    """Replacement for asyncio.sleep that returns immediately."""
    pass


async def _call_and_collect(call_llm_json_args: dict) -> tuple:
    """Call call_llm_json and return (result, exception)."""
    try:
        result = await llm_mod.call_llm_json(**call_llm_json_args)
        return result, None
    except Exception as exc:
        return None, exc


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    # Save original state for restoration
    orig_api_key = llm_mod._API_KEY
    orig_httpx_asyncclient = httpx.AsyncClient
    orig_asyncio_sleep = asyncio.sleep
    orig_env_timeout = os.environ.get("LLM_TIMEOUT_S")
    orig_env_retries = os.environ.get("LLM_MAX_RETRIES")

    # Remove env vars so defaults apply for CHECK a
    os.environ.pop("LLM_TIMEOUT_S", None)
    os.environ.pop("LLM_MAX_RETRIES", None)

    # Set a fake API key so the "no key" check passes
    llm_mod._API_KEY = "fake-key-for-testing"

    # Monkeypatch httpx.AsyncClient and asyncio.sleep
    call_log: list[int] = []
    timeout_log: list[Any] = []
    httpx.AsyncClient = _make_tracking_post(call_log, timeout_log)
    asyncio.sleep = _noop_sleep

    try:
        # ===================================================================
        # CHECK a: defaults (no env) -> 2 attempts, timeout 60
        # ===================================================================
        print("=" * 70)
        print("CHECK a: defaults -> 2 attempts, timeout 60")
        print("=" * 70)
        check_a_errors: list[str] = []

        # Reload the module so env defaults are re-read
        importlib.reload(llm_mod)
        llm_mod._API_KEY = "fake-key-for-testing"
        httpx.AsyncClient = _make_tracking_post(call_log, timeout_log)

        call_log.clear()
        timeout_log.clear()

        result, exc = asyncio.run(_call_and_collect({
            "system_prompt": "sys",
            "user_prompt": "user",
        }))

        if exc is None or not isinstance(exc, llm_mod.LLMError):
            check_a_errors.append(
                f"expected LLMError, got result={result!r}, exc={exc!r}"
            )

        attempts = len(call_log)
        if attempts != 2:
            check_a_errors.append(f"expected 2 POST attempts, got {attempts}")

        if not timeout_log:
            check_a_errors.append("no AsyncClient created (timeout_log empty)")
        else:
            actual_timeout = timeout_log[0]
            if actual_timeout != 60:
                check_a_errors.append(
                    f"timeout: got {actual_timeout!r}, expected 60"
                )

        if check_a_errors:
            print("\nCHECK a RESULT: FAIL")
            for e in check_a_errors:
                print(f"  - {e}")
            errors.extend(check_a_errors)
        else:
            print("\nCHECK a RESULT: PASS")
            print(f"  - attempts: {len(call_log)}")
            print(f"  - timeout: {timeout_log[0]}")

        # ===================================================================
        # CHECK b: explicit max_retries=0, timeout_s=30 -> 1 attempt, timeout 30
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK b: explicit max_retries=0, timeout_s=30 -> 1 attempt, timeout 30")
        print("=" * 70)
        check_b_errors: list[str] = []

        call_log.clear()
        timeout_log.clear()

        result, exc = asyncio.run(_call_and_collect({
            "system_prompt": "sys",
            "user_prompt": "user",
            "max_retries": 0,
            "timeout_s": 30,
        }))

        if exc is None or not isinstance(exc, llm_mod.LLMError):
            check_b_errors.append(
                f"expected LLMError, got result={result!r}, exc={exc!r}"
            )

        attempts = len(call_log)
        if attempts != 1:
            check_b_errors.append(f"expected 1 POST attempt, got {attempts}")

        if not timeout_log:
            check_b_errors.append("no AsyncClient created (timeout_log empty)")
        else:
            actual_timeout = timeout_log[0]
            if actual_timeout != 30:
                check_b_errors.append(
                    f"timeout: got {actual_timeout!r}, expected 30"
                )

        if check_b_errors:
            print("\nCHECK b RESULT: FAIL")
            for e in check_b_errors:
                print(f"  - {e}")
            errors.extend(check_b_errors)
        else:
            print("\nCHECK b RESULT: PASS")
            print(f"  - attempts: {len(call_log)}")
            print(f"  - timeout: {timeout_log[0]}")

        # ===================================================================
        # CHECK c: env LLM_TIMEOUT_S=45, LLM_MAX_RETRIES=2 -> 3 attempts, timeout 45
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK c: env timeout=45, retries=2 -> 3 attempts, timeout 45")
        print("=" * 70)
        check_c_errors: list[str] = []

        os.environ["LLM_TIMEOUT_S"] = "45"
        os.environ["LLM_MAX_RETRIES"] = "2"
        importlib.reload(llm_mod)
        llm_mod._API_KEY = "fake-key-for-testing"
        httpx.AsyncClient = _make_tracking_post(call_log, timeout_log)

        call_log.clear()
        timeout_log.clear()

        result, exc = asyncio.run(_call_and_collect({
            "system_prompt": "sys",
            "user_prompt": "user",
        }))

        if exc is None or not isinstance(exc, llm_mod.LLMError):
            check_c_errors.append(
                f"expected LLMError, got result={result!r}, exc={exc!r}"
            )

        attempts = len(call_log)
        if attempts != 3:
            check_c_errors.append(f"expected 3 POST attempts, got {attempts}")

        if not timeout_log:
            check_c_errors.append("no AsyncClient created (timeout_log empty)")
        else:
            actual_timeout = timeout_log[0]
            if actual_timeout != 45:
                check_c_errors.append(
                    f"timeout: got {actual_timeout!r}, expected 45"
                )

        if check_c_errors:
            print("\nCHECK c RESULT: FAIL")
            for e in check_c_errors:
                print(f"  - {e}")
            errors.extend(check_c_errors)
        else:
            print("\nCHECK c RESULT: PASS")
            print(f"  - attempts: {len(call_log)}")
            print(f"  - timeout: {timeout_log[0]}")

        # ===================================================================
        # CHECK d: env LLM_TIMEOUT_S=abc -> falls back to 60
        # ===================================================================
        print("\n" + "=" * 70)
        print("CHECK d: env LLM_TIMEOUT_S=abc -> falls back to 60")
        print("=" * 70)
        check_d_errors: list[str] = []

        os.environ["LLM_TIMEOUT_S"] = "abc"
        os.environ.pop("LLM_MAX_RETRIES", None)
        importlib.reload(llm_mod)
        llm_mod._API_KEY = "fake-key-for-testing"
        httpx.AsyncClient = _make_tracking_post(call_log, timeout_log)

        call_log.clear()
        timeout_log.clear()

        result, exc = asyncio.run(_call_and_collect({
            "system_prompt": "sys",
            "user_prompt": "user",
        }))

        if exc is None or not isinstance(exc, llm_mod.LLMError):
            check_d_errors.append(
                f"expected LLMError, got result={result!r}, exc={exc!r}"
            )

        if not timeout_log:
            check_d_errors.append("no AsyncClient created (timeout_log empty)")
        else:
            actual_timeout = timeout_log[0]
            if actual_timeout != 60:
                check_d_errors.append(
                    f"timeout: got {actual_timeout!r}, expected 60 (fallback)"
                )

        if check_d_errors:
            print("\nCHECK d RESULT: FAIL")
            for e in check_d_errors:
                print(f"  - {e}")
            errors.extend(check_d_errors)
        else:
            print("\nCHECK d RESULT: PASS")
            print(f"  - timeout: {timeout_log[0]} (fell back to 60)")

    finally:
        # Restore everything
        httpx.AsyncClient = orig_httpx_asyncclient
        asyncio.sleep = orig_asyncio_sleep
        llm_mod._API_KEY = orig_api_key

        # Restore env vars
        if orig_env_timeout is not None:
            os.environ["LLM_TIMEOUT_S"] = orig_env_timeout
        else:
            os.environ.pop("LLM_TIMEOUT_S", None)
        if orig_env_retries is not None:
            os.environ["LLM_MAX_RETRIES"] = orig_env_retries
        else:
            os.environ.pop("LLM_MAX_RETRIES", None)

        # Reload module one final time so other tests are not affected
        importlib.reload(llm_mod)

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
