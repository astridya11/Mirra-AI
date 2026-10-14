"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/src/context/I18nContext";
import { useHydrated } from "@/src/hooks/useStoredValue";
import { useBackendMode } from "@/src/hooks/useBackendMode";
import { AppShell, Card, Pill, PresenterPanel, SectionLabel, type Tone } from "@/src/components/showcase/ui";
import { briefingFor } from "@/src/lib/demoBriefings";
import { briefingSessionId, peekSession, subscribeToSession } from "@/src/lib/sessionStorage";
import { consoleTarget, guidedHref, humanReviewHref, partyHref } from "@/src/lib/demoLinks";
import type { DemoId, DemoSession } from "@/src/types/session";

const BTN = "rounded-xl px-5 py-3 font-semibold text-sm border text-center transition";
const OUTCOME: Record<"green" | "slate" | "amber", { box: string; tone: Tone }> = {
  green: { box: "border-green-200 bg-green-50/60", tone: "green" },
  slate: { box: "border-line bg-slate-50", tone: "slate" },
  amber: { box: "border-amber-200 bg-amber-50/60", tone: "amber" },
};

export default function DemoBriefingPage() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useI18n();
  const demo = briefingFor(id, locale);
  const hydrated = useHydrated();

  if (!demo) {
    return (
      <AppShell>
        <p className="text-body">
          {locale === "zh" ? "未知演示。" : "Unknown demo."}{" "}
          <Link href="/demo" className="text-mirra">
            {locale === "zh" ? "返回演示列表" : "Back to demos"}
          </Link>
        </p>
      </AppShell>
    );
  }
  return <AppShell presenter>{hydrated ? <Briefing demoId={demo.id} /> : <div className="h-96" />}</AppShell>;
}

/** Rendered after hydration: the shared session id lives in localStorage. */
function Briefing({ demoId }: { demoId: DemoId }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const demo = briefingFor(demoId, locale)!;
  const { backendMode } = useBackendMode();
  const [sid, setSid] = useState(() => briefingSessionId(demoId));
  const [session, setSession] = useState<DemoSession | null>(() => peekSession(demoId, sid));

  useEffect(() => subscribeToSession(demoId, sid, setSession), [demoId, sid]);

  const freshSession = () => {
    const next = briefingSessionId(demoId, true);
    setSid(next);
    setSession(null);
  };

  const console_ = consoleTarget(demoId, session, backendMode);
  const reviewHref = humanReviewHref(demoId, sid, session);
  const stageLabel: Record<string, string> = zh
    ? { none: "尚未开始", private_support: "私人协助中", formal_filed: "已提交正式投诉", under_review: "仲裁进行中", resolved: "已裁决" }
    : { none: "Not started", private_support: "Private assistance", formal_filed: "Formal complaint filed", under_review: "Tribunal running", resolved: "Decided" };

  return (
    <div className="flex flex-col xl:flex-row xl:items-start gap-6">
      <div className="flex-1 min-w-0 max-w-4xl mx-auto w-full">
        <Link href="/demo" className="text-sm text-muted hover:text-mirra">
          ← {zh ? "全部演示" : "All demos"}
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-ink">
            {zh ? `演示 ${demoId} · ${demo.title}` : `Demo ${demoId} · ${demo.title}`}
          </h1>
          <Pill tone="blue">{(zh ? "主题：" : "THEME: ") + demo.theme.toUpperCase()}</Pill>
        </div>
        <p className="text-lg font-semibold text-mirra mt-3">“{demo.question}”</p>

        <Card className="p-6 mt-6">
          <SectionLabel>{zh ? "场景" : "Scenario"}</SectionLabel>
          <p className="text-body leading-relaxed">{demo.scenario}</p>
          <p className="text-xs text-muted mt-3">
            {zh ? `从${demo.startsFrom}一方开始` : `Starts from the ${demo.startsFrom} side`}
          </p>
        </Card>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <Card className="p-6">
            <SectionLabel>{zh ? "本演示证明" : "What this demo proves"}</SectionLabel>
            <ul className="space-y-2">
              {demo.proves.map((p) => (
                <li key={p} className="flex gap-2 text-sm text-body">
                  <span className="text-ok font-bold">✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </Card>
          <div className={`rounded-2xl border p-5 ${OUTCOME[demo.outcome.tone].box}`}>
            <SectionLabel>{zh ? "预期结果" : "Expected outcome"}</SectionLabel>
            <Pill tone={OUTCOME[demo.outcome.tone].tone}>{demo.outcome.headline}</Pill>
            <ul className="mt-3 space-y-1 text-sm text-body">
              {demo.outcome.lines.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-briefing-actions>
          <Link href={guidedHref(demoId, sid)} className={`${BTN} bg-mirra text-white border-mirra hover:brightness-110`}>
            {zh ? "开始引导演示" : "Begin Guided Demo"}
          </Link>
          <a href={partyHref(demoId, "passenger", sid)} target="_blank" rel="noreferrer" className={`${BTN} bg-white text-ink border-line hover:border-mirra/40`}>
            {zh ? "乘客应用 ↗" : "Passenger App ↗"}
          </a>
          <a href={partyHref(demoId, "driver", sid)} target="_blank" rel="noreferrer" className={`${BTN} bg-white text-ink border-line hover:border-mirra/40`}>
            {zh ? "司机应用 ↗" : "Driver App ↗"}
          </a>
          {console_.href ? (
            <a href={console_.href} target="_blank" rel="noreferrer" className={`${BTN} bg-console text-white border-console hover:brightness-125`}>
              {zh ? "内部控制台 ↗" : "Internal Console ↗"}
            </a>
          ) : (
            <span
              aria-disabled
              title={zh ? "提交正式投诉后可用" : "Available after formal complaint"}
              className={`${BTN} bg-slate-100 text-muted border-line cursor-not-allowed`}
            >
              {zh ? "内部控制台" : "Internal Console"}
              <span className="block text-[11px] font-normal">{zh ? "提交正式投诉后可用" : "Available after formal complaint"}</span>
            </span>
          )}
        </div>

        {reviewHref && (
          <a
            href={reviewHref}
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-warn hover:brightness-95"
          >
            <span>{zh ? "需要人工审核：在审核时同步更新双方结果" : "Human review required for this session"}</span>
            <span>{zh ? "打开人工审核 →" : "Open Human Review →"}</span>
          </a>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span>
            {zh ? "会话" : "Session"} <span className="font-mono text-body">{sid}</span>
          </span>
          <span>
            {zh ? "状态" : "Status"}: <span className="text-body">{stageLabel[session?.stage ?? "none"]}</span>
          </span>
          <span>
            {zh ? "后端" : "Backend"}: <span className="text-body">{backendMode === "live" ? "LIVE" : "DEMO MODE"}</span>
            {session?.liveCaseId && <span className="font-mono text-body"> · {session.liveCaseId}</span>}
          </span>
          {console_.kind === "fixture" && (
            <span>{zh ? "控制台显示演示模式示例数据" : "Console shows the Demo Mode fixture observer view"}</span>
          )}
          <button onClick={freshSession} className="ml-auto rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-muted hover:text-ink">
            {zh ? "开始新会话" : "Start fresh session"}
          </button>
        </div>
        <p className="text-xs text-muted mt-2">
          {zh
            ? "引导演示、乘客应用和司机应用共用同一个会话，可在不同标签页中同时打开。"
            : "Guided Demo, Passenger App and Driver App share this one session and can be open in separate tabs at the same time."}
        </p>
      </div>
      <PresenterPanel
        className="w-full xl:w-[320px] shrink-0 xl:sticky xl:top-24"
        stage={zh ? "简报" : "Briefing"}
        say={demo.presenter.say}
        watch={demo.presenter.watch}
        proves={demo.proves}
        expected={[demo.outcome.headline]}
        next={demo.presenter.next}
      />
    </div>
  );
}
