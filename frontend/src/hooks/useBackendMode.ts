"use client";

import { useCallback } from "react";
import { useStoredValue } from "./useStoredValue";

const STORAGE_KEY = "mirra.backendMode";

export type BackendMode = "live" | "demo";

export function useBackendMode(): {
  backendMode: BackendMode;
  toggleBackendMode: () => void;
  setBackendMode: (mode: BackendMode) => void;
} {
  const [raw, setRaw] = useStoredValue(STORAGE_KEY, "demo");
  const backendMode: BackendMode = raw === "live" ? "live" : "demo";
  const setBackendMode = useCallback((mode: BackendMode) => setRaw(mode), [setRaw]);
  const toggleBackendMode = useCallback(
    () => setBackendMode(backendMode === "live" ? "demo" : "live"),
    [backendMode, setBackendMode]
  );
  return { backendMode, toggleBackendMode, setBackendMode };
}
