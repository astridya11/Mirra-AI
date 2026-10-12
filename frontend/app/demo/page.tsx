"use client";

import Link from "next/link";
import { AppShell, Card, Pill, PresenterPanel } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import { demosFor } from "@/src/i18n/content";

export default function DemoSelection() {
  const { t, locale } = useI18n();
  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-extrabold text-ink">{t("demos.title")}</h1>
            <p className="text-muted mt-2">{t("demos.subtitle")}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {demosFor(locale).map((d) => (
              <Card key={d.n} className="p-6 flex flex-col">
                <div className="flex items-center gap-2">
                  <Pill>{t("demos.demoN", { n: d.n })}</Pill>
                  <Pill tone="blue">{d.theme.toUpperCase()}</Pill>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-mirra-soft flex items-center justify-center text-2xl mt-5">{d.icon}</div>
                <p className="text-xl font-bold text-ink mt-4">{d.title}</p>
                <p className="text-xs font-mono text-muted">{d.caseIds.join(" → ")}</p>
                <p className="text-sm font-semibold text-mirra mt-3">“{d.question}”</p>
                <p className="text-sm text-muted mt-2">{d.card}</p>
                <ul className="mt-4 space-y-1.5 flex-1">
                  {d.checks.map((c) => (
                    <li key={c} className="text-sm text-body flex gap-2">
                      <span className="text-mirra">✓</span>
                      {c}
                    </li>
                  ))}
                </ul>
                {d.caseIds.length > 1 && <p className="text-[11px] text-warn font-semibold mt-4">{t("demos.twoScenarios")}</p>}
                <Link href={`/demo/${d.n}`} className="mt-4 text-center rounded-xl bg-mirra text-white font-semibold py-2.5 hover:brightness-110">
                  {t("demos.brief", { n: d.n })}
                </Link>
              </Card>
            ))}
          </div>
        </div>
        <PresenterPanel
          note={{
            stage: t("demos.presenter.stage"),
            say: t("demos.presenter.say"),
            watch: t("demos.presenter.watch"),
            next: t("demos.presenter.next"),
          }}
        />
      </div>
    </AppShell>
  );
}
