"use client";

import Link from "next/link";
import { useI18n } from "@/src/context/I18nContext";
import { Card, Pill, PresenterPanel } from "@/src/components/showcase/ui";
import { DEMO_IDS, briefingFor } from "@/src/lib/demoBriefings";

const THEME_TONE = { "1": "pink", "2": "green", "3": "amber" } as const;

export default function DemoSelection() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-10">
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-extrabold text-ink">{zh ? "选择演示场景" : "Choose Demo"}</h1>
            <p className="text-muted mt-2">
              {zh
                ? "三个真实纠纷场景：自动化、公平性与负责任 AI。"
                : "Three real dispute scenarios: automation, fairness and responsible AI."}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {DEMO_IDS.map((id) => {
              const d = briefingFor(id, locale)!;
              return (
                <Card key={id} className="p-6 flex flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill>{zh ? `演示 ${id}` : `DEMO ${id}`}</Pill>
                    <Pill tone={THEME_TONE[id]}>{d.theme.toUpperCase()}</Pill>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-mirra-soft flex items-center justify-center text-2xl mt-5">{d.icon}</div>
                  <p className="text-xl font-bold text-ink mt-4">{d.title}</p>
                  <p className="text-sm font-semibold text-mirra mt-3">“{d.question}”</p>
                  <p className="text-sm text-muted mt-2">{d.summary}</p>
                  <ul className="mt-4 space-y-1.5 flex-1">
                    {d.capabilities.map((c) => (
                      <li key={c} className="text-sm text-body flex gap-2">
                        <span className="text-mirra">✓</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/demo/${id}`}
                    className="mt-6 text-center rounded-xl bg-mirra text-white font-semibold py-2.5 hover:brightness-110"
                  >
                    {zh ? `开始演示 ${id}` : `Start Demo ${id}`}
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>
        <PresenterPanel
          className="w-full xl:w-[320px] shrink-0 xl:sticky xl:top-24"
          stage={zh ? "选择演示" : "Demo selection"}
          say={
            zh
              ? "MIRRA 是一个多智能体纠纷解决系统。我们用三个场景展示它：自动化、公平性和负责任 AI。"
              : "MIRRA is a multi-agent dispute resolution system. Three scenarios show it: automation, fairness and responsible AI."
          }
          watch={zh ? "每个演示都会先打开简报页。" : "Each demo opens a briefing page first."}
          next={zh ? "选择演示 1。" : "Pick Demo 1."}
        />
      </div>
    </div>
  );
}
