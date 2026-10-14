"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { PipelineEvent, CaseResult } from "@/src/types";
import type { TribunalEvent } from "@/src/types/tribunal";
import { streamPipeline, getCompletedResult } from "@/src/lib/api";
import { mapPipelineEventToTribunalEvent } from "@/src/lib/liveTribunalAdapter";

const STREAM_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

interface LiveTribunalState {
  events: TribunalEvent[];
  isStreaming: boolean;
  isComplete: boolean;
  result: CaseResult | null;
  error: string | null;
}

export function useLiveTribunal() {
  const [state, setState] = useState<LiveTribunalState>({
    events: [],
    isStreaming: false,
    isComplete: false,
    result: null,
    error: null,
  });

  const startedRef = useRef<Set<string>>(new Set());
  const cleanupRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimeoutSafe();
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, [clearTimeoutSafe]);

  const start = useCallback(
    (caseId: string) => {
      if (!caseId) return;
      if (startedRef.current.has(caseId)) return;
      startedRef.current.add(caseId);

      // Reset state for this case
      setState({
        events: [],
        isStreaming: true,
        isComplete: false,
        result: null,
        error: null,
      });

      clearTimeoutSafe();
      timeoutRef.current = setTimeout(() => {
        stop();
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: "Stream timed out after 3 minutes without completion.",
        }));
      }, STREAM_TIMEOUT_MS);

      const cleanup = streamPipeline(caseId, {
        onEvent: (event: PipelineEvent) => {
          const mapped = mapPipelineEventToTribunalEvent(event, Date.now());
          if (mapped) {
            setState((prev) => ({
              ...prev,
              events: [...prev.events, mapped],
            }));
          }
        },
        onComplete: async (result: CaseResult | null) => {
          clearTimeoutSafe();
          cleanupRef.current = null;

          // If result is null from SSE, try fetching completed result
          let finalResult = result;
          if (!finalResult) {
            try {
              finalResult = await getCompletedResult(caseId);
            } catch {
              // leave null
            }
          }

          setState((prev) => ({
            ...prev,
            isStreaming: false,
            isComplete: true,
            result: finalResult,
          }));
        },
        onError: (err: Event | string) => {
          clearTimeoutSafe();
          cleanupRef.current = null;
          const msg = typeof err === "string" ? err : "Pipeline stream error.";
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: msg,
          }));
        },
      });

      cleanupRef.current = cleanup;
    },
    [stop, clearTimeoutSafe]
  );

  const retry = useCallback(
    (caseId: string) => {
      startedRef.current.delete(caseId);
      stop();
      setState({
        events: [],
        isStreaming: false,
        isComplete: false,
        result: null,
        error: null,
      });
      start(caseId);
    },
    [start, stop]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeoutSafe();
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [clearTimeoutSafe]);

  return {
    ...state,
    start,
    stop,
    retry,
  };
}
