"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mirra.backendMode";

export type BackendMode = "live" | "demo";

export function useBackendMode(): {
  backendMode: BackendMode;
  toggleBackendMode: () => void;
  setBackendMode: (mode: BackendMode) => void;
} {
  const [backendMode, setMode] = useState<BackendMode>(() => {
    if (typeof window === "undefined") return "demo";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "live" ? "live" : "demo";
    } catch {
      return "demo";
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setMode(e.newValue === "live" ? "live" : "demo");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setBackendMode = useCallback((mode: BackendMode) => {
    setMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  }, []);

  const toggleBackendMode = useCallback(() => {
    setBackendMode(backendMode === "live" ? "demo" : "live");
  }, [backendMode, setBackendMode]);

  return { backendMode, toggleBackendMode, setBackendMode };
}
