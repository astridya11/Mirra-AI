"use client";

import Link from "next/link";
import { AppShell, AvailabilityBadge, MirraLogo, Phone, PresenterPanel, RydeWordmark, Sparkle } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";

const FEATURES: [string, MessageKey][] = [
  ["🤖", "home.feature.multiAgent"],
  ["🧾", "home.feature.evidence"],
  ["⚖️", "home.feature.policy"],
  ["🤝", "home.feature.fair"],
  ["👤", "home.feature.human"],
  ["🔒", "home.feature.private"],
];
const PHONE_OPTIONS: MessageKey[] = ["home.phone.route", "home.phone.charge", "home.phone.problem", "home.phone.complaint"];

export default function Home() {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <section className="flex-1 min-w-0 relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-mirra-soft/60 to-[#ffe4ec] border border-line px-6 py-10 md:px-14 md:py-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <SkylineBackdrop />
          <div className="relative">
            <p className="text-sm font-semibold text-mirra mb-3">{t("home.eyebrow")}</p>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-ink">
              MIRRA <span className="text-mirra">AI</span>
            </h1>
            <p className="text-2xl md:text-3xl text-body mt-4 leading-snug max-w-xl">{t("home.tagline")}</p>
            <p className="text-muted mt-4 max-w-xl">{t("home.intro")}</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-8 max-w-2xl">
              {FEATURES.map(([icon, label]) => (
                <div key={label} className="text-center">
                  <div className="w-11 h-11 mx-auto rounded-full bg-white border border-mirra/20 flex items-center justify-center text-lg shadow-sm">{icon}</div>
                  <p className="text-[11px] text-body mt-1.5 leading-tight">{t(label)}</p>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mt-10 max-w-3xl">
              <Cta href="/team" title={t("home.cta.team")} sub={t("home.cta.teamSub")} />
              <Cta href="/mirra" title={t("home.cta.how")} sub={t("home.cta.howSub")} />
              <Cta href="/demo" title={t("home.cta.demo")} sub={t("home.cta.demoSub")} primary />
            </div>
          </div>
          <div className="relative hidden lg:flex justify-center">
            <Phone>
              <div className="h-11 shrink-0 flex items-center px-4 border-b border-line">
                <RydeWordmark className="text-lg" />
              </div>
              <div className="p-4 space-y-3">
                <div className="rounded-2xl bg-console p-3">
                  <MirraLogo dark subtitle={false} />
                  <div className="mt-2">
                    <AvailabilityBadge />
                  </div>
                </div>
                <p className="text-sm font-semibold text-ink">{t("home.phone.help")}</p>
                {PHONE_OPTIONS.map((k) => (
                  <div key={k} className="rounded-xl border border-line px-3 py-2.5 text-xs text-body flex items-center gap-2">
                    <span className="text-mirra">›</span> {t(k)}
                  </div>
                ))}
                <div className="rounded-full border border-line px-3 py-2 text-[11px] text-muted flex items-center">
                  {t("chat.placeholder")} <Sparkle className="w-4 h-4 text-mirra ml-auto" />
                </div>
              </div>
            </Phone>
          </div>
        </section>
        <PresenterPanel
          note={{
            stage: t("home.presenter.stage"),
            say: t("home.presenter.say"),
            watch: t("home.presenter.watch"),
            next: t("home.presenter.next"),
          }}
        />
      </div>
    </AppShell>
  );
}

function Cta({ href, title, sub, primary = false }: { href: string; title: string; sub: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-2xl px-5 py-4 border transition hover:-translate-y-0.5 ${
        primary ? "bg-mirra text-white border-mirra shadow-lg shadow-mirra/30" : "bg-white border-line text-ink hover:border-mirra/40"
      }`}
    >
      <p className="font-bold">{title}</p>
      <p className={`text-xs ${primary ? "text-white/80" : "text-muted"}`}>{sub} →</p>
    </Link>
  );
}

function SkylineBackdrop() {
  // Stylised Singapore skyline (Marina Bay Sands + Flyer) — decorative only.
  return (
    <svg viewBox="0 0 1200 220" className="absolute left-0 right-0 bottom-0 w-full h-48 opacity-[0.12] pointer-events-none" aria-hidden>
      <g fill="#F23D63">
        <rect x="700" y="80" width="38" height="140" />
        <rect x="760" y="70" width="38" height="150" />
        <rect x="820" y="80" width="38" height="140" />
        <rect x="690" y="62" width="180" height="14" rx="7" />
        <rect x="560" y="120" width="40" height="100" />
        <rect x="610" y="100" width="30" height="120" />
        <rect x="900" y="110" width="44" height="110" />
        <rect x="955" y="140" width="30" height="80" />
        <rect x="0" y="210" width="1200" height="10" />
      </g>
      <circle cx="420" cy="130" r="80" fill="none" stroke="#F23D63" strokeWidth="6" />
      <line x1="420" y1="130" x2="380" y2="220" stroke="#F23D63" strokeWidth="6" />
      <line x1="420" y1="130" x2="460" y2="220" stroke="#F23D63" strokeWidth="6" />
    </svg>
  );
}
