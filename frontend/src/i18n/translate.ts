"use client";

/**
 * Display-only AI translation of live backend free text for the Chinese UI (POST /api/translate).
 * Texts are batched per tick, cached per tab, and never written back to the case or session.
 * Failure leaves the English original in place.
 */

import { useEffect, useSyncExternalStore } from "react";
import { backendUrl } from "@/src/lib/api";

type Entry = { zh?: string; failed?: boolean };
const cache = new Map<string, Entry>();
const queue = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const BATCH = 40;

function notify() {
  version++;
  subs.forEach((f) => f());
}

async function flush() {
  timer = null;
  const texts = [...queue].slice(0, BATCH);
  texts.forEach((t) => queue.delete(t));
  if (queue.size) timer = setTimeout(flush, 0);
  try {
    const res = await fetch(backendUrl("/api/translate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, target: "zh-CN" }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { translations } = (await res.json()) as { translations: string[] };
    texts.forEach((t, i) => cache.set(t, translations[i] && translations[i] !== t ? { zh: translations[i] } : { failed: true }));
  } catch {
    texts.forEach((t) => cache.set(t, { failed: true }));
  }
  notify();
}

function request(text: string) {
  if (cache.has(text) || queue.has(text)) return;
  queue.add(text);
  timer ??= setTimeout(flush, 0);
}

const subscribe = (cb: () => void) => (subs.add(cb), () => subs.delete(cb));

/** Chinese translation of a backend text: undefined while loading, null when unavailable. */
export function useZhTranslation(text: string, enabled: boolean): string | null | undefined {
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (enabled && text.trim()) request(text);
  }, [text, enabled]);
  if (!enabled || !text.trim()) return null;
  const e = cache.get(text);
  return e ? (e.zh ?? null) : undefined;
}
