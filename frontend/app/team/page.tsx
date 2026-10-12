"use client";

import { AppShell, Card, PresenterPanel } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";

const ROLES: { k: string; title: MessageKey; sub: MessageKey; color: string }[] = [
  { k: "P1", title: "team.p1.title", sub: "team.p1.sub", color: "#F23D63" },
  { k: "P2", title: "team.p2.title", sub: "team.p2.sub", color: "#7C3AED" },
  { k: "P3", title: "team.p3.title", sub: "team.p3.sub", color: "#2563EB" },
];

const IMPACT: [string, MessageKey, MessageKey][] = [
  ["⚡", "team.impact.fast", "team.impact.fastSub"],
  ["⚖️", "team.impact.fair", "team.impact.fairSub"],
  ["💡", "team.impact.explain", "team.impact.explainSub"],
  ["👤", "team.impact.safe", "team.impact.safeSub"],
];

export default function TeamPage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-extrabold text-ink">{t("team.title")}</h1>
            <p className="text-muted mt-2">{t("team.subtitle")}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {ROLES.map((r) => (
              <Card key={r.k} className="p-6 text-center">
                <div
                  className="w-14 h-14 mx-auto rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ background: `${r.color}14`, color: r.color }}
                >
                  {r.k}
                </div>
                <p className="font-bold text-ink mt-3">{t(r.title)}</p>
                <p className="text-xs text-muted mt-1">{t(r.sub)}</p>
              </Card>
            ))}
          </div>
          <Card className="max-w-4xl mx-auto mt-8 p-6 md:p-8 flex items-center gap-6 bg-gradient-to-r from-white to-mirra-soft">
            <div className="w-16 h-16 rounded-2xl bg-mirra text-white flex items-center justify-center text-2xl shrink-0">🎯</div>
            <div>
              <p className="text-xl font-bold text-ink">{t("team.vision")}</p>
              <p className="text-lg text-body">{t("team.visionText")}</p>
            </div>
          </Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mt-8">
            {IMPACT.map(([i, title, sub]) => (
              <Card key={title} className="p-5 text-center">
                <div className="text-2xl">{i}</div>
                <p className="font-semibold text-ink mt-2 text-sm">{t(title)}</p>
                <p className="text-xs text-muted">{t(sub)}</p>
              </Card>
            ))}
          </div>
        </div>
        <PresenterPanel
          note={{
            stage: t("team.presenter.stage"),
            say: t("team.presenter.say"),
            watch: t("team.presenter.watch"),
            next: t("team.presenter.next"),
          }}
        />
      </div>
    </AppShell>
  );
}
