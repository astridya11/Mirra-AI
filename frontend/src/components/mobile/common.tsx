"use client";

import type { ReactNode } from "react";
import { RydeWordmark, Sparkle } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";

export function AppBar({ right }: { right?: ReactNode }) {
  return (
    <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-line bg-white">
      <RydeWordmark className="text-xl" />
      {right}
    </div>
  );
}

/** Compact MIRRA entry button used inside the Ryde apps. */
export function MirraButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-[#2a0f1a] to-[#4a1328] ring-1 ring-mirra/60 rounded-full pl-2 pr-3 py-1.5 shadow-md shadow-mirra/30 hover:brightness-125"
    >
      <Sparkle className="w-3.5 h-3.5 text-mirra" /> MIRRA AI
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" aria-label="AI available" />
    </button>
  );
}

export function Initials({ name, tone = "pink" }: { name: string; tone?: "pink" | "blue" }) {
  const init = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        tone === "pink" ? "bg-mirra-soft text-mirra" : "bg-blue-50 text-info"
      }`}
    >
      {init}
    </span>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="absolute left-3 right-3 top-12 z-20 rounded-xl bg-ink text-white text-xs px-3 py-2 shadow-lg animate-pop-in" role="status">
      {text}
    </div>
  );
}

/** Stylised map. `deviation` draws expected (blue dashed) vs actual (pink) route; otherwise a pickup pin. */
export function TripMap({ deviation = false, from, to, className = "h-40" }: { deviation?: boolean; from: string; to?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`relative overflow-hidden bg-[#EEF2EA] ${className}`}>
      <svg viewBox="0 0 300 160" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden>
        <rect width="300" height="160" fill="#EEF2EA" />
        <path d="M0 120 C80 100 120 140 300 90" stroke="#fff" strokeWidth="9" fill="none" />
        <path d="M60 0 C70 60 40 110 90 160" stroke="#fff" strokeWidth="7" fill="none" />
        <path d="M180 0 C190 50 220 80 210 160" stroke="#fff" strokeWidth="6" fill="none" />
        <path d="M0 40 C100 50 200 20 300 35" stroke="#fff" strokeWidth="6" fill="none" />
        <path d="M230 120 C260 140 280 150 300 160 L300 110 Z" fill="#C9E3F2" />
        {to ? (
          <>
            {deviation && <path d="M40 120 C110 95 170 70 255 45" stroke="#2563EB" strokeWidth="3" strokeDasharray="6 5" fill="none" />}
            <path
              d={deviation ? "M40 120 C70 60 140 30 190 70 S240 60 255 45" : "M40 120 C110 95 170 70 255 45"}
              stroke="#F23D63"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="40" cy="120" r="6" fill="#111827" />
            <circle cx="255" cy="45" r="7" fill="#F23D63" stroke="#fff" strokeWidth="3" />
          </>
        ) : (
          <>
            <circle cx="150" cy="80" r="26" fill="#F23D63" opacity="0.12" />
            <circle cx="150" cy="80" r="8" fill="#F23D63" stroke="#fff" strokeWidth="3" />
            <rect x="166" y="86" width="18" height="10" rx="3" fill="#111827" />
          </>
        )}
      </svg>
      <span className="absolute left-2 bottom-2 text-[10px] font-semibold bg-white/90 rounded px-1.5 py-0.5">{from}</span>
      {to && <span className="absolute right-2 top-2 text-[10px] font-semibold bg-white/90 rounded px-1.5 py-0.5">{to}</span>}
      {deviation && (
        <div className="absolute left-2 top-2 bg-white/90 rounded px-1.5 py-1 text-[9px] space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-mirra" />
            {t("map.actual")}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-info" />
            {t("map.expected")}
          </div>
        </div>
      )}
    </div>
  );
}
