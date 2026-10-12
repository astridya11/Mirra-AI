"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type Outcome } from "@/src/demo/scenarios";
import { useI18n } from "@/src/i18n";
import { demoFor } from "@/src/i18n/content";
import { defaultSession } from "@/src/demo/session";
import { AppShell, Card, Pill, PresenterPanel, type Tone } from "@/src/components/showcase/ui";

const BTN = "rounded-xl px-5 py-3 font-semibold text-sm border hover:border-mirra/40";

const OUTCOME_STYLE: Record<Outcome["tone"], { box: string; tone: Tone }> = {
  green: { box: "border-green-200 bg-green-50/60", tone: "green" },
  amber: { box: "border-amber-200 bg-amber-50/60", tone: "amber" },
  red: { box: "border-red-200 bg-red-50/60", tone: "red" },
  slate: { box: "border-line bg-slate-50", tone: "slate" },
};

export default function DemoBriefing() {
  const { n } = useParams<{ n: string }>();
  const { t, locale } = useI18n();
  const demo = demoFor(n, locale);
  const sid = defaultSession(n);

  if (!demo) {
    return (
      <AppShell>
        <p>
          {t("briefing.unknown")}{" "}
          <Link href="/demo" className="text-mirra">
            {t("briefing.backToDemos")}
          </Link>
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0 max-w-4xl mx-auto">
          <Link href="/demo" className="text-sm text-muted hover:text-mirra">
            {t("briefing.allDemos")}
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <h1 className="text-3xl md:text-4xl font-extrabold text-ink">
              {t("briefing.title", { n: demo.n, title: demo.title })}
            </h1>
            <Pill tone="blue">{t("briefing.theme", { theme: demo.theme.toUpperCase() })}</Pill>
          </div>
          <p className="text-lg font-semibold text-mirra mt-3">“{demo.question}”</p>

          <Card className="p-6 mt-6">
            <SectionLabel>{t("briefing.scenario")}</SectionLabel>
            <p className="text-body leading-relaxed">{demo.scenario}</p>
            <p className="text-xs text-muted mt-3">
              {t("briefing.caseLine", { cases: demo.caseIds.join(" → "), side: demo.startsFrom })}
            </p>
          </Card>

          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <Card className="p-6">
              <SectionLabel>{t("briefing.proves")}</SectionLabel>
              <ul className="space-y-2">
                {demo.proves.map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-body">
                    <span className="text-ok font-bold">✓</span>
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
            <div className="space-y-4">
              {demo.outcomes.map((o) => (
                <div key={o.caseId} className={`rounded-2xl border p-5 ${OUTCOME_STYLE[o.tone].box}`}>
                  <div className="flex items-center justify-between gap-2">
                    <SectionLabel>{o.label}</SectionLabel>
                    <span className="text-[11px] font-mono text-muted">{o.caseId}</span>
                  </div>
                  <Pill tone={OUTCOME_STYLE[o.tone].tone}>{o.headline}</Pill>
                  <ul className="mt-3 space-y-1 text-sm text-body">
                    {o.lines.map((l) => (
                      <li key={l}>• {l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
            <Link href={`/demo/${n}/guided?session=${sid}`} className={`${BTN} bg-mirra text-white border-mirra hover:brightness-110`}>
              {t("briefing.begin")}
            </Link>
            <a href={`/demo/${n}/passenger?session=${sid}`} target="_blank" rel="noreferrer" className={`${BTN} bg-white text-ink border-line`}>
              {t("briefing.passengerApp")}
            </a>
            <a href={`/demo/${n}/driver?session=${sid}`} target="_blank" rel="noreferrer" className={`${BTN} bg-white text-ink border-line`}>
              {t("briefing.driverApp")}
            </a>
            {demo.caseIds.map((c) => (
              <a key={c} href={`/internal/${c}?session=${sid}`} target="_blank" rel="noreferrer" className={`${BTN} bg-console text-white border-console`}>
                {t("briefing.internal")}{demo.caseIds.length > 1 ? ` · ${c}` : ""} ↗
              </a>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">
            {t("briefing.tabsNote", { sid })}
          </p>
        </div>
        <PresenterPanel
          note={demo.presenter}
          proves={demo.proves}
          expected={demo.outcomes.map((o) => `${o.caseId}: ${o.headline}`)}
        />
      </div>
    </AppShell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold tracking-widest text-muted uppercase mb-2">{children}</p>;
}
