"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { AGENTS, type AgentKey, type PresenterNote } from "@/src/demo/scenarios";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";

// ---------------------------------------------------------------------------
// Presenter Mode — persisted per browser, synced across tabs via the storage event.
// ---------------------------------------------------------------------------

const PRESENTER_KEY = "mirra.presenter";
const presenterListeners = new Set<() => void>();

function subscribePresenter(cb: () => void) {
  presenterListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    presenterListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readPresenter() {
  try {
    return localStorage.getItem(PRESENTER_KEY) === "1";
  } catch {
    return false;
  }
}

export function usePresenter(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribePresenter, readPresenter, () => false);
  const set = (v: boolean) => {
    try {
      localStorage.setItem(PRESENTER_KEY, v ? "1" : "0");
    } catch {}
    presenterListeners.forEach((l) => l());
  };
  return [on, set];
}

function PresenterToggle() {
  const [on, set] = usePresenter();
  const { t } = useI18n();
  return (
    <button
      onClick={() => set(!on)}
      aria-pressed={on}
      className={`flex items-center gap-2 text-xs font-semibold rounded-full pl-3 pr-1 py-1 border transition ${
        on ? "bg-ink text-white border-ink" : "bg-white text-body border-line hover:border-mirra/40"
      }`}
    >
      {t("presenter.mode")}
      <span className={`px-2 py-0.5 rounded-full text-[10px] ${on ? "bg-mirra text-white" : "bg-slate-100 text-muted"}`}>{on ? t("common.on") : t("common.off")}</span>
    </button>
  );
}

/** Rendered only when Presenter Mode is ON — no markup at all when OFF. */
export function PresenterPanel({ note, proves, expected }: { note: PresenterNote; proves?: string[]; expected?: string[] }) {
  const [on] = usePresenter();
  const { t } = useI18n();
  if (!on) return null;
  return (
    <aside className="w-full xl:w-[320px] shrink-0 xl:sticky xl:top-24 rounded-2xl bg-ink text-slate-200 p-5 space-y-4 animate-pop-in" aria-label={t("presenter.guide")}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold tracking-widest text-mirra">{t("presenter.guide")}</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 border border-white/15 rounded px-1.5 py-0.5">{note.stage}</span>
      </div>
      <Guide label={t("presenter.say")} text={`“${note.say}”`} />
      <Guide label={t("presenter.watch")} text={note.watch} />
      {proves && <GuideList label={t("presenter.proves")} items={proves} />}
      {expected && <GuideList label={t("presenter.expected")} items={expected} />}
      <div className="rounded-xl bg-mirra/15 border border-mirra/30 px-3 py-2">
        <p className="text-[10px] font-bold tracking-wider text-mirra">{t("presenter.next")}</p>
        <p className="text-sm text-white">{note.next}</p>
      </div>
    </aside>
  );
}

function Guide({ label, text }: { label: string; text: string }) {
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

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

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

export function MirraLogo({ dark = false, subtitle = true }: { dark?: boolean; subtitle?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#2a0f1a] to-[#4a1328] ring-2 ring-mirra/70 flex items-center justify-center text-mirra shadow-[0_0_18px_rgba(242,61,99,0.45)]">
        <Sparkle className="w-6 h-6" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-lg tracking-wide ${dark ? "text-white" : "text-ink"}`}>MIRRA AI</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mirra/15 text-mirra border border-mirra/30">BETA</span>
        </div>
        {subtitle && (
          <p className={`text-xs ${dark ? "text-slate-400" : "text-muted"}`}>{t("brand.subtitle")}</p>
        )}
      </div>
    </div>
  );
}

export function AvailabilityBadge({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border border-green-500/60 text-green-500 bg-green-500/10">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse-dot" />
      {label ?? t("brand.aiAvailable")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

const NAV: { href: string; label: MessageKey }[] = [
  { href: "/", label: "nav.home" },
  { href: "/team", label: "nav.team" },
  { href: "/mirra", label: "nav.howMirraWorks" },
  { href: "/demo", label: "nav.demo" },
  { href: "/experience", label: "nav.rydeExperience" },
];

export function TopNav() {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-line">
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 h-16 flex items-center gap-4 md:gap-10">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="w-8 h-8 rounded-full bg-mirra text-white flex items-center justify-center">
            <Sparkle className="w-4 h-4" />
          </span>
          <span className="font-extrabold tracking-tight text-ink">
            MIRRA <span className="text-mirra">AI</span>
          </span>
        </Link>
        <nav className="flex gap-5 md:gap-7 text-sm overflow-x-auto no-scrollbar">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`whitespace-nowrap ${active ? "text-mirra font-semibold" : "text-body hover:text-mirra"}`}>
                {t(n.label)}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto shrink-0 flex items-center gap-2">
          <LanguageSwitch />
          <PresenterToggle />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-body">
      <TopNav />
      <main className="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-10">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-line shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>{children}</div>;
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
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${TONES[tone]}`}>{children}</span>;
}

export function AgentAvatar({ agent, size = 36 }: { agent: AgentKey; size?: number }) {
  const a = AGENTS[agent];
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{ width: size, height: size, background: a.color, fontSize: size * 0.42 }}
    >
      {a.glyph}
    </span>
  );
}

const PHONE_SIZE = { sm: "w-[280px] h-[540px]", md: "w-[300px] h-[620px]", lg: "w-[360px] max-w-full h-[740px]" };

export function Phone({ children, time = "9:41", size = "sm" }: { children: ReactNode; time?: string; size?: keyof typeof PHONE_SIZE }) {
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

export function RouteBadge({ route }: { route: "FULLY_AUTOMATED" | "ESCALATED_HUMAN_REVIEW" }) {
  const { t } = useI18n();
  const auto = route === "FULLY_AUTOMATED";
  return (
    <span
      title={route}
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
        auto ? "bg-green-50 text-ok border-green-200" : "bg-amber-50 text-warn border-amber-300"
      }`}
    >
      {auto ? "⚡" : "👤"} {enumLabel(t, route)}
    </span>
  );
}
