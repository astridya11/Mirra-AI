"use client";

import { useCallback } from "react";
import { useStoredValue } from "./useStoredValue";

const STORAGE_KEY = "mirra.presenterMode";

export function usePresenterMode(): {
  presenterMode: boolean;
  togglePresenterMode: () => void;
} {
  const [raw, setRaw] = useStoredValue(STORAGE_KEY, "false");
  const presenterMode = raw === "true";
  const togglePresenterMode = useCallback(() => setRaw(String(!presenterMode)), [presenterMode, setRaw]);
  return { presenterMode, togglePresenterMode };
}
