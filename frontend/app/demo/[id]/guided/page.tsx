"use client";

import { Suspense } from "react";
import { useSearchParams, useParams } from "next/navigation";
import RydeApp from "@/src/components/ryde/RydeApp";
import TribunalBoard from "@/src/components/demo/TribunalBoard";
import DecisionView from "@/src/components/demo/DecisionView";
import PresenterGuide from "@/src/components/demo/PresenterGuide";
import { getPresenterStep } from "@/src/components/demo/presenterSteps";
import { usePresenterMode } from "@/src/hooks/usePresenterMode";
import { useI18n } from "@/src/context/I18nContext";
import { useTranslation } from "@/src/hooks/useTranslation";
import { useState, useEffect, useCallback } from "react";
import type { DemoId, DemoSession, DisputeStage } from "@/src/types/session";
import {
  getOrCreateSession,
  subscribeToSession,
  startTribunal,
  completeTribunal,
  resetSession,
} from "@/src/lib/sessionStorage";
import { getScenario } from "@/src/lib/demoScenarios";
import { getFixtureByDemoId } from "@/src/lib/tribunalFixtures";

function GuidedDemoContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const demoId = (params.id as string) as DemoId;
  const sessionId = searchParams.get("session") ?? `${demoId}-default`;
  const { locale } = useI18n();
  const t = useTranslation();
  const { presenterMode, togglePresenterMode } = usePresenterMode();

  const [session, setSession] = useState<DemoSession | null>(() =>
    getOrCreateSession(demoId, sessionId)
  );

  useEffect(() => {
    const unsub = subscribeToSession(demoId, sessionId, (latest) => {
      setSession(latest);
    });
    return unsub;
  }, [demoId, sessionId]);

  const handleStartTribunal = useCallback(() => {
    const updated = startTribunal(demoId, sessionId);
    setSession(updated);
  }, [demoId, sessionId]);

  const handleCompleteTribunal = useCallback(() => {
    const fixture = getFixtureByDemoId(demoId);
    if (!fixture) return;
    const decision =
      fixture.demoId === "1"
        ? { status: "partial_refund" as const, amount: "S$3.25", reasoning: "GPS-confirmed route deviation", executionRoute: "automated" as const }
        : fixture.demoId === "2"
        ? { status: "no_refund" as const, reasoning: "Driver followed procedure", executionRoute: "automated" as const }
        : { status: "human_review" as const, reasoning: "Insufficient and suspicious evidence", executionRoute: "human_review" as const };
    const updated = completeTribunal(demoId, sessionId, decision);
    setSession(updated);
  }, [demoId, sessionId]);

  const handleReset = useCallback(() => {
    const fresh = resetSession(demoId, sessionId);
    setSession(fresh);
  }, [demoId, sessionId]);

  const scenario = getScenario(demoId);
  const fixture = getFixtureByDemoId(demoId);
  const presenterStep = session ? getPresenterStep(demoId, session.stage) : undefined;

  const progressStages: { key: DisputeStage | "resolved"; labelEn: string; labelZh: string }[] = [
    { key: "none", labelEn: "Trip", labelZh: "行程" },
    { key: "private_support", labelEn: "Private Assist", labelZh: "私人协助" },
    { key: "formal_filed", labelEn: "Formal Case", labelZh: "正式案件" },
    { key: "under_review", labelEn: "Tribunal", labelZh: "法庭" },
    { key: "resolved", labelEn: "Decision", labelZh: "裁决" },
  ];

  const currentProgressIndex = progressStages.findIndex((s) => s.key === (session?.stage ?? "none"));

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-[#111827]">
              {t("guided.demo")} {demoId}
            </h1>
            <span className="text-xs text-[#6B7280]">
              {scenario ? (locale === "zh" ? scenario.titleZh : scenario.titleEn) : ""}
            </span>
            <span className="inline-flex items-center rounded-full bg-[#FDF1F3] px-2.5 py-0.5 text-[10px] font-bold text-[#E84360]">
              {scenario ? (locale === "zh"
                ? (demoId === "1" ? "自动化" : demoId === "2" ? "公平性" : "负责任 AI")
                : (demoId === "1" ? "AUTOMATION" : demoId === "2" ? "FAIRNESS" : "RESPONSIBLE AI")
              ) : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={togglePresenterMode}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                presenterMode
                  ? "bg-[#0D9488] text-white"
                  : "bg-gray-100 text-[#6B7280] hover:bg-gray-200"
              }`}
            >
              {presenterMode ? t("presenter.on") : t("presenter.off")}
            </button>
            <button
              onClick={handleReset}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-[#6B7280] hover:bg-gray-200 transition-colors"
            >
              {t("guided.reset")}
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center gap-2">
            {progressStages.map((stage, i) => {
              const isActive = i <= currentProgressIndex;
              const isCurrent = i === currentProgressIndex;
              return (
                <div key={stage.key} className="flex items-center gap-2 flex-1">
                  <div
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      isActive ? "bg-[#E84360]" : "bg-gray-100"
                    } ${isCurrent ? "ring-2 ring-[#E84360]/30" : ""}`}
                  />
                  <span
                    className={`text-[10px] font-medium whitespace-nowrap ${
                      isActive ? "text-[#E84360]" : "text-[#D1D5DB]"
                    }`}
                  >
                    {locale === "zh" ? stage.labelZh : stage.labelEn}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main triptych */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Passenger */}
          <div className="xl:col-span-3">
            <div className="mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#E84360]">
                {t("rydeApp.passenger")}
              </span>
            </div>
            <div className="rounded-3xl border-4 border-gray-800 bg-gray-800 p-2 shadow-2xl max-w-[360px] mx-auto xl:mx-0">
              <div className="rounded-2xl overflow-hidden bg-white h-[640px]">
                <RydeApp demoId={demoId} sessionId={sessionId} party="passenger" />
              </div>
            </div>
          </div>

          {/* Center */}
          <div className="xl:col-span-6 space-y-4">
            {/* Presenter guide */}
            {presenterMode && presenterStep && (
              <PresenterGuide step={presenterStep} />
            )}

            {/* Stage actions */}
            {session?.stage === "formal_filed" && !session.tribunalStarted && (
              <div className="rounded-xl border border-[#E84360]/20 bg-[#FDF1F3] p-4 text-center">
                <p className="text-sm text-[#111827] font-medium mb-3">
                  {t("guided.readyForTribunal")}
                </p>
                <button
                  onClick={handleStartTribunal}
                  className="px-6 py-2.5 rounded-lg bg-[#E84360] text-white text-sm font-semibold hover:bg-[#DE3557] active:scale-[0.98] transition-all"
                >
                  {t("guided.startTribunal")}
                </button>
              </div>
            )}

            {session?.tribunalStarted && !session.tribunalCompleted && fixture && (
              <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 text-center">
                <p className="text-sm text-[#111827] font-medium mb-3">
                  {t("guided.tribunalInProgress")}
                </p>
                <button
                  onClick={handleCompleteTribunal}
                  className="px-6 py-2.5 rounded-lg bg-[#0D9488] text-white text-sm font-semibold hover:bg-[#0F766E] active:scale-[0.98] transition-all"
                >
                  {t("guided.completeTribunal")}
                </button>
              </div>
            )}

            {/* Tribunal Board */}
            {session?.tribunalStarted && fixture && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <TribunalBoard fixture={fixture} locale={locale} />
              </div>
            )}

            {/* Decision */}
            {session?.tribunalCompleted && session.decision && (
              <div className="space-y-4">
                <DecisionView
                  status={session.decision.status}
                  amount={session.decision.amount}
                  party="passenger"
                  executionRoute={session.decision.executionRoute}
                />
                <DecisionView
                  status={session.decision.status}
                  amount={session.decision.amount}
                  party="driver"
                  executionRoute={session.decision.executionRoute}
                />
              </div>
            )}

            {/* Initial state placeholder */}
            {!session?.tribunalStarted && session?.stage !== "formal_filed" && !presenterMode && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
                <p className="text-sm text-[#9CA3AF]">{t("guided.usePartyApps")}</p>
              </div>
            )}
          </div>

          {/* Driver */}
          <div className="xl:col-span-3">
            <div className="mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
                {t("rydeApp.driver")}
              </span>
            </div>
            <div className="rounded-3xl border-4 border-gray-800 bg-gray-800 p-2 shadow-2xl max-w-[360px] mx-auto xl:mx-0">
              <div className="rounded-2xl overflow-hidden bg-white h-[640px]">
                <RydeApp demoId={demoId} sessionId={sessionId} party="driver" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GuidedDemoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-sm text-[#9CA3AF]">Loading guided demo...</div>
        </div>
      }
    >
      <GuidedDemoContent />
    </Suspense>
  );
}
