"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mirra.presenterMode";

export function usePresenterMode(): {
  presenterMode: boolean;
  togglePresenterMode: () => void;
} {
  const [presenterMode, setPresenterMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPresenterMode(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const togglePresenterMode = useCallback(() => {
    setPresenterMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  return { presenterMode, togglePresenterMode };
}
