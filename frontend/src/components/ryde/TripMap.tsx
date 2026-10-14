"use client";

import { useI18n } from "@/src/context/I18nContext";

/** Stylised trip map (after the prototype). `deviation` draws expected (blue dashed) vs actual (pink) route. */
export default function TripMap({ from, to, deviation = false }: { from: string; to: string; deviation?: boolean }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  return (
    <div className="relative h-40 shrink-0 overflow-hidden bg-[#EEF2EA]" aria-hidden>
      <svg viewBox="0 0 300 160" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <rect width="300" height="160" fill="#EEF2EA" />
        <path d="M0 120 C80 100 120 140 300 90" stroke="#fff" strokeWidth="9" fill="none" />
        <path d="M60 0 C70 60 40 110 90 160" stroke="#fff" strokeWidth="7" fill="none" />
        <path d="M180 0 C190 50 220 80 210 160" stroke="#fff" strokeWidth="6" fill="none" />
        <path d="M0 40 C100 50 200 20 300 35" stroke="#fff" strokeWidth="6" fill="none" />
        <path d="M230 120 C260 140 280 150 300 160 L300 110 Z" fill="#C9E3F2" />
        {deviation && <path d="M40 120 C110 95 170 70 255 45" stroke="#2563EB" strokeWidth="3" strokeDasharray="6 5" fill="none" />}
        <path
          d={deviation ? "M40 120 C70 60 140 30 190 70 S240 60 255 45" : "M40 120 C110 95 170 70 255 45"}
          stroke="#E84360"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="40" cy="120" r="6" fill="#111827" />
        <circle cx="255" cy="45" r="7" fill="#E84360" stroke="#fff" strokeWidth="3" />
      </svg>
      <span className="absolute left-2 bottom-2 text-[10px] font-semibold bg-white/90 rounded px-1.5 py-0.5">{from}</span>
      <span className="absolute right-2 top-2 text-[10px] font-semibold bg-white/90 rounded px-1.5 py-0.5">{to}</span>
      {deviation && (
        <div className="absolute left-2 top-2 bg-white/90 rounded px-1.5 py-1 text-[9px] space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-mirra" />
            {zh ? "实际路线" : "Actual route"}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-info" />
            {zh ? "最优路线" : "Optimal route"}
          </div>
        </div>
      )}
    </div>
  );
}
