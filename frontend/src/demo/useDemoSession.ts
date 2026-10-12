"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { APPS } from "./scenarios";
import { initialSession, reduce, sessionKey, SESSION_VERSION, type Action, type DemoSession, type TripStatus } from "./session";

/**
 * Shared demo session: localStorage persists it (survives refresh), BroadcastChannel
 * pushes changes to other tabs on the same key. Frontend-only prototype mechanism.
 */

const memory = new Map<string, string>(); // fallback when localStorage is blocked
const listeners = new Map<string, Set<() => void>>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  announce(key);
}

function announce(key: string) {
  notify(key);
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel(key);
    ch.postMessage("changed");
    ch.close();
  }
}

function subscribe(key: string, cb: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(key) : null;
  if (ch) ch.onmessage = cb;
  // Fallbacks for tabs the browser froze/throttled in the background: re-read when shown again.
  window.addEventListener("storage", cb);
  window.addEventListener("focus", cb);
  document.addEventListener("visibilitychange", cb);
  return () => {
    listeners.get(key)?.delete(cb);
    ch?.close();
    window.removeEventListener("storage", cb);
    window.removeEventListener("focus", cb);
    document.removeEventListener("visibilitychange", cb);
  };
}

function parse(raw: string | null, caseId: string, fallback: DemoSession): DemoSession {
  if (!raw) return fallback;
  try {
    const p = JSON.parse(raw) as DemoSession;
    return p.version === SESSION_VERSION && p.caseId === caseId ? p : fallback;
  } catch {
    return fallback;
  }
}

export function useDemoSession(init: {
  demoId: string;
  caseId: string;
  sessionId: string;
  tripStatus: TripStatus;
  variant?: "A" | "B" | null;
}) {
  const { demoId, caseId, sessionId, tripStatus, variant = null } = init;
  const key = sessionKey(demoId, sessionId);
  const initial = useMemo(
    () => initialSession({ demoId, caseId, sessionId, tripStatus, variant }),
    [demoId, caseId, sessionId, tripStatus, variant],
  );

  const raw = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    () => readRaw(key),
    () => null,
  );

  const session = useMemo(() => parse(raw, caseId, initial), [raw, caseId, initial]);

  const dispatch = useCallback(
    (a: Action) => {
      // Re-read so concurrent writes from another tab are not overwritten with a stale copy.
      const current = parse(readRaw(key), caseId, initial);
      writeRaw(key, JSON.stringify(reduce(current, a, initial)));
    },
    [key, caseId, initial],
  );

  return { session, dispatch };
}

/** Binds a demo route (demo number) to its shared session. */
export function useScenarioSession(demoId: string, sessionId: string) {
  const app = APPS[demoId];
  const { session, dispatch } = useDemoSession({
    demoId,
    caseId: app?.caseId ?? "",
    sessionId,
    tripStatus: app?.initialStatus ?? "ACTIVE",
  });
  return { app, session, dispatch };
}
