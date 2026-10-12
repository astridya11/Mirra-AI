"use client";

import { useState } from "react";
import { useI18n } from "./index";
import { useZhTranslation } from "./translate";

/**
 * Backend free text (advocate statements, Judge reasoning, explanations, escalation reasons).
 * English UI: shown exactly as the backend wrote it. Chinese UI: an AI translation (display only,
 * labelled, with a toggle back to the original); while loading or if translation fails, the
 * original English is shown with its "original system text" label.
 */
export function RawText({ text, raw = true, className = "", as: Tag = "p" }: { text: string; raw?: boolean; className?: string; as?: "p" | "span" | "div" }) {
  const { t, locale } = useI18n();
  const zh = useZhTranslation(text, raw && locale !== "en");
  const [original, setOriginal] = useState(false);
  if (!raw || locale === "en") return <Tag className={className}>{text}</Tag>;
  // Inline (span) texts keep the label on the same line, e.g. inside a bullet.
  const label = `${Tag === "span" ? "inline-block mr-1.5 align-middle" : "block mb-0.5"} text-[9px] font-bold tracking-wider text-muted/80`;
  if (!zh || original)
    return (
      <Tag className={className}>
        <span className={label}>
          {t("raw.original")}
          {zh === undefined && ` · ${t("raw.translating")}`}
          {zh && original && (
            <button type="button" onClick={() => setOriginal(false)} className="ml-1.5 underline text-mirra">
              {t("raw.showTranslation")}
            </button>
          )}
        </span>
        <span lang="en">{text}</span>
      </Tag>
    );
  return (
    <Tag className={className}>
      <span className={label} data-ai-translated>
        {t("raw.aiTranslated")}
        <button type="button" onClick={() => setOriginal(true)} className="ml-1.5 underline text-mirra">
          {t("raw.showOriginal")}
        </button>
      </span>
      <span lang="zh-CN">{zh}</span>
    </Tag>
  );
}
