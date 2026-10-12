"use client";

import { useEffect } from "react";
import { LOCALES, useI18n } from "./index";

/** Compact English | 中文 toggle. Presentation state only — never resets demo sessions. */
export function LanguageSwitch({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  return (
    <div role="group" aria-label="Select language" className={`inline-flex rounded-full border p-0.5 ${dark ? "border-white/15 bg-white/5" : "border-line bg-white"}`}>
      {LOCALES.map((l) => (
        <button
          key={l.id}
          onClick={() => setLocale(l.id)}
          aria-pressed={locale === l.id}
          lang={l.id}
          className={`rounded-full font-semibold ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"} ${
            locale === l.id ? "bg-mirra text-white" : dark ? "text-slate-300 hover:text-white" : "text-body hover:text-mirra"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Keeps <html lang> in sync with the selected language (accessibility / fonts). */
export function HtmlLang() {
  const { locale } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
