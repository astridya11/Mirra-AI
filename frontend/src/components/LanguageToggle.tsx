"use client";

import { useI18n } from "@/src/context/I18nContext";

/** EN / 中文 switch. Only the stored language changes; sessions and review state are untouched. */
export default function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div
      role="group"
      aria-label="Select language"
      className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold ${className}`}
    >
      {(["en", "zh"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            locale === l ? "bg-[#111827] text-white" : "text-[#6B7280] hover:text-[#111827]"
          }`}
        >
          {l === "en" ? "EN" : "中文"}
        </button>
      ))}
    </div>
  );
}
