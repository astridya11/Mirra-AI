"use client";

/**
 * MIRRA showcase presentation kit: TopNav, AppShell, Card, Pill, Phone, PresenterPanel.
 * Recreated from the prototype/frontend-showcase-v2 presentation layer; all state comes
 * from the current hooks (useI18n, usePresenterMode), never from prototype session logic.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/src/context/I18nContext";
import { useTranslation } from "@/src/hooks/useTranslation";
import { usePresenterMode } from "@/src/hooks/usePresenterMode";

export function Sparkle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2c.6 4.6 2.4 7.4 8 8.4v1.2c-5.6 1-7.4 3.8-8 8.4h-.1c-.6-4.6-2.4-7.4-8-8.4v-1.2c5.6-1 7.4-3.8 8-8.4H12z" />
      <path d="M19 15c.2 1.6.8 2.5 2.6 2.8v.4c-1.8.3-2.4 1.2-2.6 2.8-.2-1.6-.8-2.5-2.6-2.8v-.4c1.8-.3 2.4-1.2 2.6-2.8z" opacity=".7" />
    </svg>
  );
}

export function RydeWordmark({ className = "text-2xl" }: { className?: string }) {
  return <span className={`font-extrabold italic tracking-tight text-mirra ${className}`}>Ryde</span>;
}

/** English | 中文. Only the language preference changes; sessions are untouched. */
export function LanguageSwitch({ dark = false }: { dark?: boolean }) {
  const { locale, setLocale } = useI18n();
  return (
    <div role="group" aria-label="Select language" className="flex items-center text-xs font-semibold">
      {(["en", "zh"] as const).map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className={dark ? "text-slate-600 px-1" : "text-line px-1"}>|</span>}
          <button
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={locale === l}
            className={`px-1 py-0.5 rounded ${
              locale === l ? "text-mirra" : dark ? "text-slate-400 hover:text-white" : "text-muted hover:text-ink"
            }`}
          >
            {l === "en" ? "English" : "中文"}
          </button>
        </span>
      ))}
    </div>
  );
}

export function PresenterToggle() {
  const { presenterMode, togglePresenterMode } = usePresenterMode();
  const { locale } = useI18n();
  const zh = locale === "zh";
  return (
    <button
      onClick={togglePresenterMode}
      aria-pressed={presenterMode}
      className={`flex items-center gap-2 text-xs font-semibold rounded-full pl-3 pr-1 py-1 border transition ${
        presenterMode ? "bg-ink text-white border-ink" : "bg-white text-body border-line hover:border-mirra/40"
      }`}
    >
      {zh ? "演示者模式" : "Presenter Mode"}
      <span className={`px-2 py-0.5 rounded-full text-[10px] ${presenterMode ? "bg-mirra text-white" : "bg-slate-100 text-muted"}`}>
        {presenterMode ? (zh ? "开" : "ON") : zh ? "关" : "OFF"}
      </span>
    </button>
  );
}

const NAV = [
  { href: "/", key: "nav.home" },
  { href: "/team", key: "nav.team" },
  { href: "/how-it-works", key: "nav.howItWorks" },
  { href: "/demo", key: "nav.demo" },
  { href: "/experience", key: "nav.rydeExperience" },
] as const;

export function TopNav({ presenter = false }: { presenter?: boolean }) {
  const path = usePathname() ?? "/";
  const t = useTranslation();
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-line">
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 min-h-16 py-2 flex flex-wrap items-center gap-x-6 gap-y-2 md:gap-x-10">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="w-8 h-8 rounded-full bg-mirra text-white flex items-center justify-center">
            <Sparkle className="w-4 h-4" />
          </span>
          <span className="font-extrabold tracking-tight text-ink">
            MIRRA <span className="text-mirra">AI</span>
          </span>
        </Link>
        <nav className="order-3 w-full md:order-none md:w-auto flex gap-5 md:gap-7 text-sm overflow-x-auto no-scrollbar">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap ${active ? "text-mirra font-semibold" : "text-body hover:text-mirra"}`}
              >
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto shrink-0 flex items-center gap-3">
          <LanguageSwitch />
          {(presenter || path.startsWith("/demo")) && <PresenterToggle />}
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children, presenter = false }: { children: ReactNode; presenter?: boolean }) {
  return (
    <div className="min-h-screen bg-surface text-body">
      <TopNav presenter={presenter} />
      <main className="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-10">{children}</main>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-line shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>{children}</div>
  );
}

const TONES = {
  pink: "bg-mirra-soft text-mirra",
  green: "bg-green-50 text-ok",
  amber: "bg-amber-50 text-warn",
  blue: "bg-blue-50 text-info",
  slate: "bg-slate-100 text-slate-600",
  red: "bg-red-50 text-red-600",
};
export type Tone = keyof typeof TONES;

export function Pill({ children, tone = "pink" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold tracking-widest text-muted uppercase mb-2">{children}</p>;
}

const PHONE_SIZE = {
  md: "w-[310px] max-w-full h-[650px]",
  lg: "w-[380px] max-w-full h-[780px] max-h-[calc(100vh-7rem)] min-h-[560px]",
};

/** Realistic phone: rounded bezel, compact status bar with notch, scrolling content area. */
export function Phone({ children, time = "9:41", size = "md" }: { children: ReactNode; time?: string; size?: keyof typeof PHONE_SIZE }) {
  return (
    <div className={`${PHONE_SIZE[size]} shrink-0 rounded-[42px] bg-ink p-[9px] shadow-[0_20px_50px_-20px_rgba(17,24,39,0.45)]`}>
      <div className="relative w-full h-full rounded-[34px] bg-white overflow-hidden flex flex-col">
        <div className="h-8 shrink-0 flex items-center justify-between px-6 text-[11px] font-semibold text-ink">
          <span>{time}</span>
          <span className="absolute left-1/2 -translate-x-1/2 top-2 w-20 h-5 rounded-full bg-ink" />
          <span>5G ▮</span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}

/** Dark presenter guide; rendered only while Presenter Mode is on. */
export function PresenterPanel({
  stage,
  say,
  watch,
  proves,
  expected,
  next,
  className = "",
}: {
  stage: string;
  say: string;
  watch?: string;
  proves?: string[];
  expected?: string[];
  next?: string;
  className?: string;
}) {
  const { presenterMode } = usePresenterMode();
  const { locale } = useI18n();
  const zh = locale === "zh";
  if (!presenterMode) return null;
  return (
    <aside className={`rounded-2xl bg-ink text-slate-200 p-5 space-y-4 animate-pop-in ${className}`} aria-label="Presenter guide" data-presenter-panel>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-widest text-mirra">{zh ? "演示者指引" : "PRESENTER GUIDE"}</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 border border-white/15 rounded px-1.5 py-0.5">{stage}</span>
      </div>
      <GuideText label={zh ? "讲解" : "Say"} text={`“${say}”`} />
      {watch && <GuideText label={zh ? "关注" : "Watch"} text={watch} />}
      {proves && proves.length > 0 && <GuideList label={zh ? "证明了什么" : "What this proves"} items={proves} />}
      {expected && expected.length > 0 && <GuideList label={zh ? "预期结果" : "Expected outcome"} items={expected} />}
      {next && (
        <div className="rounded-xl bg-mirra/15 border border-mirra/30 px-3 py-2">
          <p className="text-[10px] font-bold tracking-wider text-mirra">{zh ? "下一步" : "NEXT"}</p>
          <p className="text-sm text-white">{next}</p>
        </div>
      )}
    </aside>
  );
}

function GuideText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function GuideList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <ul className="text-sm space-y-0.5 mt-0.5">
        {items.map((i) => (
          <li key={i}>• {i}</li>
        ))}
      </ul>
    </div>
  );
}
