/**
 * MIRRA frontend i18n — one shared, display-only language layer.
 *
 * - Locale lives in localStorage ("mirra.language"); the browser `storage` event keeps every
 *   open MIRRA tab in sync. Changing language never touches demo/session state.
 * - UI copy: typed dictionaries (en.ts is the source of keys; zh-CN.ts must cover every key).
 * - Demo content (briefings, presenter scripts, private MIRRA scripts, fixture copy): curated
 *   Chinese overlays in content.zh-CN.ts, merged onto the English data by id.
 * - Raw enum values and facts (amounts, times, IDs, policy IDs) are never translated or mutated.
 */

import { useSyncExternalStore } from "react";
import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "中文" },
];

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

const DICTS: Record<Locale, Record<MessageKey, string>> = { en, "zh-CN": zhCN };

export function translator(locale: Locale): Translator {
  const dict = DICTS[locale];
  return (key, params) => {
    const s = dict[key] ?? en[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : s;
  };
}

/** English translator for non-UI callers (defaults, tests). */
export const tEn = translator("en");

// ---------------------------------------------------------------------------
// Persisted, cross-tab locale
// ---------------------------------------------------------------------------

const KEY = "mirra.language";
const subs = new Set<() => void>();

function read(): Locale {
  try {
    return localStorage.getItem(KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

function subscribe(cb: () => void) {
  subs.add(cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    subs.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function setLocale(l: Locale) {
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  subs.forEach((f) => f());
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, read, () => "en" as Locale);
}

export function useI18n() {
  const locale = useLocale();
  return { locale, t: translator(locale), setLocale };
}

// ---------------------------------------------------------------------------
// Display labels for raw backend enums (display-only; raw values are never changed)
// ---------------------------------------------------------------------------

export function enumLabel(t: Translator, value?: string | null): string {
  if (!value) return "—";
  const key = `enum.${value}` as MessageKey;
  return key in en ? t(key) : value;
}

/** Deep-merge a curated overlay onto English content (arrays merged by index). */
export function overlay<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(base)) {
    const p = patch as unknown[];
    return base.map((item, i) => overlay(item, p[i])) as T;
  }
  if (base && typeof base === "object") {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k in out ? overlay(out[k], v) : v;
    return out as T;
  }
  return patch as T;
}

/** Localize the SLA countdown label from src/lib/sla.ts ("3:12", "2 h 26 min left", "+0:45 overdue"). */
export function slaLabel(label: string, locale: Locale): string {
  if (locale === "en") return label;
  return label
    .replace(/^\+(.*) overdue$/, "已超时 $1")
    .replace(/^(.*) left$/, "剩余 $1")
    .replace(/ h /, "小时")
    .replace(/ min$/, "分")
    .replace(/^Reviewed$/, "已审核");
}
