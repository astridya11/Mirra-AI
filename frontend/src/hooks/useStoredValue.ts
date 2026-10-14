"use client";

import { useCallback, useSyncExternalStore } from "react";

const LOCAL_EVENT = "mirra:stored-value";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(LOCAL_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A localStorage-backed string preference, synced across tabs. The server render and
 * hydration use `fallback`, then React switches to the stored value without a
 * hydration mismatch (useSyncExternalStore server snapshot).
 */
export function useStoredValue(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback
  );
  const set = useCallback(
    (v: string) => {
      try {
        window.localStorage.setItem(key, v);
      } catch {
        // storage disabled: the value still applies for this render
      }
      window.dispatchEvent(new Event(LOCAL_EVENT));
    },
    [key]
  );
  return [value, set];
}

const noop = () => () => {};
/** false during SSR and hydration, true afterwards. Gate localStorage-driven screens on it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
