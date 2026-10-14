"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import type { Locale } from "@/src/i18n/config";
import { defaultLocale, locales } from "@/src/i18n/config";
import { getMessages, type Messages } from "@/src/i18n";
import { useStoredValue } from "@/src/hooks/useStoredValue";

const STORAGE_KEY = "mirra.language";

interface I18nContextType {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Stored language, synced across tabs; hydration-safe (server renders the default).
  const [stored, setStored] = useStoredValue(STORAGE_KEY, defaultLocale);
  const locale: Locale = locales.includes(stored as Locale) ? (stored as Locale) : defaultLocale;
  const messages = useMemo(() => getMessages(locale), [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (locales.includes(next)) setStored(next);
    },
    [setStored]
  );
  const toggleLocale = useCallback(() => setLocale(locale === "en" ? "zh" : "en"), [locale, setLocale]);

  return (
    <I18nContext.Provider value={{ locale, messages, setLocale, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
