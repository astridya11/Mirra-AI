"use client";

import Link from "next/link";
import { AGENTS, AGENT_ORDER } from "@/src/demo/scenarios";
import { AgentAvatar, AppShell, Card, PresenterPanel } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";

const CAPABILITIES: MessageKey[] = ["how.cap.frozen", "how.cap.gps", "how.cap.image", "how.cap.ocr", "how.cap.fraud", "how.cap.cross", "how.cap.policy", "how.cap.human"];

const GUARDRAILS: [string, MessageKey][] = [
  ["🔒", "how.guard.private"],
  ["🧊", "how.guard.freeze"],
  ["💬", "how.guard.claims"],
  ["❔", "how.guard.missing"],
  ["👤", "how.guard.high"],
];

const FLOW: MessageKey[] = ["how.flow.private", "how.flow.formal", "how.flow.final", "how.flow.freeze", "how.flow.advocates", "how.flow.prosecutor", "how.flow.policy", "how.flow.judge", "how.flow.router"];

export default function MirraPage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-4xl font-extrabold text-ink">{t("how.title")}</h1>
          <p className="text-muted mt-2 mb-8">{t("how.subtitle")}</p>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-2">
              {AGENT_ORDER.map((k, i) => (
                <div key={k}>
                  <Card className="p-4 flex items-center gap-4">
                    <AgentAvatar agent={k} size={44} />
                    <div className="flex-1">
                      <p className="font-bold" style={{ color: AGENTS[k].color }}>
                        {t(`agent.${k}.name` as MessageKey)}
                      </p>
                      <p className="text-sm text-muted">{t(`agent.${k}.role` as MessageKey)}</p>
                    </div>
                    <span className="text-xs text-muted font-mono">{t(`agent.${k}.phase` as MessageKey)}</span>
                  </Card>
                  {i < AGENT_ORDER.length - 1 && <p className="text-center text-mirra leading-4">↓</p>}
                </div>
              ))}
            </div>
            <div className="space-y-5">
              <Card className="p-5">
                <p className="font-bold text-ink mb-3">{t("how.capabilities")}</p>
                <ul className="space-y-2">
                  {CAPABILITIES.map((c) => (
                    <li key={c} className="flex items-center gap-2 text-sm text-body">
                      <span className="w-5 h-5 rounded-full bg-mirra-soft text-mirra text-[10px] flex items-center justify-center">✓</span>
                      {t(c)}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-5">
                <p className="font-bold text-ink mb-2">{t("how.guardrails")}</p>
                <ul className="text-sm text-body space-y-1.5">
                  {GUARDRAILS.map(([i, g]) => (
                    <li key={g} className="flex gap-2">
                      <span aria-hidden>{i}</span>
                      {t(g)}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          <section className="mt-10">
            <p className="font-bold text-ink mb-3">{t("how.lifecycle")}</p>
            <Card className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                {FLOW.map((f, i) => (
                  <span key={f} className="flex items-center gap-2">
                    <span className={`text-sm px-3 py-2 rounded-xl ${i === 3 ? "bg-mirra-soft text-mirra font-semibold" : "bg-surface border border-line text-body"}`}>{t(f)}</span>
                    {i < FLOW.length - 1 && <span className="text-mirra">→</span>}
                  </span>
                ))}
                <span className="text-mirra">→</span>
                <span className="text-sm px-3 py-2 rounded-xl bg-green-50 text-ok font-semibold">{t("how.automated")}</span>
                <span className="text-muted text-sm">{t("how.or")}</span>
                <span className="text-sm px-3 py-2 rounded-xl bg-amber-50 text-warn font-semibold">{t("how.humanReview")}</span>
              </div>
              <p className="text-xs text-muted mt-4">
                {t("how.stateMachine")}
              </p>
              <Link href="/demo" className="inline-block mt-4 text-sm text-mirra font-semibold">
                {t("how.seeDemo")}
              </Link>
            </Card>
          </section>
        </div>
        <PresenterPanel
          note={{
            stage: t("how.presenter.stage"),
            say: t("how.presenter.say"),
            watch: t("how.presenter.watch"),
            next: t("how.presenter.next"),
          }}
        />
      </div>
    </AppShell>
  );
}
