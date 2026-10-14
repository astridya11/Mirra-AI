"use client";

import { Suspense } from "react";
import { useSearchParams, useParams } from "next/navigation";
import RydeApp from "@/src/components/ryde/RydeApp";
import TribunalBoard from "@/src/components/demo/TribunalBoard";
import DecisionView from "@/src/components/demo/DecisionView";
import PresenterGuide from "@/src/components/demo/PresenterGuide";
import { getPresenterStep } from "@/src/components/demo/presenterSteps";
import { usePresenterMode } from "@/src/hooks/usePresenterMode";
import { useBackendMode } from "@/src/hooks/useBackendMode";
import { useLiveTribunal } from "@/src/hooks/useLiveTribunal";
import { useI18n } from "@/src/context/I18nContext";
import { useTranslation } from "@/src/hooks/useTranslation";
import { useState, useEffect, useCallback, useRef } from "react";
import type { DemoId, DemoSession, DisputeStage } from "@/src/types/session";
import {
  getOrCreateSession,
  subscribeToSession,
  startTribunal,
  completeTribunal,
  resetSession,
  setLiveCaseId,
  setLiveStatus,
  clearLiveError,
  claimCaseCreationLock,
  clearCaseCreationLock,
  setPaymentStatus,
} from "@/src/lib/sessionStorage";
import { getScenario } from "@/src/lib/demoScenarios";
import { getFixtureByDemoId } from "@/src/lib/tribunalFixtures";
import { createDispute, getCompletedResult, mockRydePayCleaningFee } from "@/src/lib/api";
import {
  mapCaseResultToTribunalDecision,
  buildEvidenceFromCaseResult,
  buildFraudSignalsFromCaseResult,
} from "@/src/lib/liveTribunalAdapter";

function GuidedDemoContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const demoId = (params.id as string) as DemoId;
  const sessionId = searchParams.get("session") ?? `${demoId}-default`;
  const { locale } = useI18n();
  const t = useTranslation();
  const { presenterMode, togglePresenterMode } = usePresenterMode();
  const { backendMode, toggleBackendMode, setBackendMode } = useBackendMode();
  const liveTribunal = useLiveTribunal();

  const effectiveMode: "live" | "demo" = backendMode;

  const [session, setSession] = useState<DemoSession | null>(() =>
    getOrCreateSession(demoId, sessionId)
  );

  const [ownerId] = useState(() =>
    `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const creatingCaseRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeToSession(demoId, sessionId, (latest) => {
      setSession(latest);
    });
    return unsub;
  }, [demoId, sessionId]);

  // Auto-create live case when formal complaint is filed in LIVE mode
  useEffect(() => {
    if (
      effectiveMode !== "live" ||
      session?.stage !== "formal_filed" ||
      session?.liveCaseId ||
      session?.tribunalStarted ||
      creatingCaseRef.current ||
      session?.liveError
    ) {
      return;
    }

    const { claimed } = claimCaseCreationLock(demoId, sessionId, ownerId);
    if (!claimed) return;

    creatingCaseRef.current = true;

    let payload: import("@/src/lib/api").CreateDisputePayload;
    if (demoId === "1") {
      payload = {
        trip_id: "TRIP-2026-08112",
        dispute_type: "ROUTE_DEVIATION",
        dispute_claim_description:
          "Driver deviated from the optimal ECP route to PIE without a valid reason, adding 2.3km and 7 extra minutes to the trip.",
        filed_by: "RIDER",
        rider_id: "R-1092",
        driver_id: "D-5541",
      };
    } else if (demoId === "2") {
      payload = {
        trip_id: "TRIP-2026-09945",
        dispute_type: "NO_SHOW_CHARGE",
        dispute_claim_description:
          "Driver cancelled the trip after the free waiting period expired and a $5.00 no-show cancellation fee was applied to the rider.",
        filed_by: "RIDER",
        rider_id: "R-7823",
        driver_id: "D-2398",
      };
    } else {
      // Demo 3 — Cleaning Fee
      payload = {
        trip_id: "TRIP-2026-09104",
        dispute_type: "CLEANING_FEE",
        dispute_claim_description:
          session?.evidence?.skipped
            ? "Driver submitted a cleaning-fee claim without providing evidence."
            : "Driver submitted a cleaning-fee claim with photo and receipt evidence.",
        filed_by: "DRIVER",
        rider_id: "R-5520",
        driver_id: "D-3307",
      };
      const ev = session?.evidence;
      if (ev?.photoDataUrl) {
        payload.image_evidence = [ev.photoDataUrl];
      }
      if (ev?.receiptDataUrl) {
        payload.receipt_evidence = [ev.receiptDataUrl];
      }
    }

    createDispute(payload)
      .then((response) => {
        setLiveCaseId(demoId, sessionId, response.case_id);
        setLiveStatus(demoId, sessionId, "ready");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to create case";
        clearCaseCreationLock(demoId, sessionId, ownerId);
        setLiveStatus(demoId, sessionId, "error", msg);
      })
      .finally(() => {
        creatingCaseRef.current = false;
      });
  }, [effectiveMode, session?.stage, session?.liveCaseId, session?.tribunalStarted, session?.liveError, session?.evidence, demoId, sessionId, ownerId]);

  // When live tribunal completes, derive decision and complete session
  useEffect(() => {
    if (liveTribunal.isComplete && liveTribunal.result && session && !session.tribunalCompleted) {
      const mapped = mapCaseResultToTribunalDecision(liveTribunal.result);
      const decision = {
        status: mapped.status,
        amount: mapped.amount,
        reasoning: mapped.reasoning,
        executionRoute: mapped.executionRoute,
      };
      completeTribunal(demoId, sessionId, decision);
      setLiveStatus(demoId, sessionId, "completed");
    }
  }, [liveTribunal.isComplete, liveTribunal.result, session, demoId, sessionId]);

  // When live tribunal errors, update session
  useEffect(() => {
    if (liveTribunal.error && session && session.liveStatus !== "error") {
      setLiveStatus(demoId, sessionId, "error", liveTribunal.error);
    }
  }, [liveTribunal.error, session, demoId, sessionId]);

  // Poll for human review completion when tribunal is done and route is human_review
  useEffect(() => {
    if (
      effectiveMode !== "live" ||
      !session?.tribunalCompleted ||
      !session.liveCaseId ||
      session.decision?.executionRoute !== "human_review" ||
      session.paymentStatus === "completed" ||
      session.paymentStatus === "failed"
    ) {
      return;
    }

    let alive = true;
    const poll = async () => {
      try {
        const result = await getCompletedResult(session.liveCaseId!);
        if (!alive || !result) return;
        const payload = result.judge_verdict?.execution_payload;
        const status = payload?.execution_status;
        if (status === "HUMAN_CONFIRMED" || status === "HUMAN_OVERRIDDEN") {
          const action = result.judge_verdict?.recommended_action;
          const fee = action?.cleaning_fee_amount ?? 0;
          if (fee > 0 && session.paymentStatus !== "completed" && session.paymentStatus !== "failed") {
            try {
              const payRes = await mockRydePayCleaningFee({
                amount: fee,
                case_id: session.liveCaseId,
                rider_id: result.case_metadata?.rider_id,
                driver_id: result.case_metadata?.driver_id,
              });
              setPaymentStatus(demoId, sessionId, "completed", payRes.transaction_id);
            } catch {
              setPaymentStatus(demoId, sessionId, "failed");
            }
          } else if (fee === 0) {
            // Rejected or no fee
            setPaymentStatus(demoId, sessionId, "completed");
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [
    effectiveMode,
    session?.tribunalCompleted,
    session?.liveCaseId,
    session?.decision?.executionRoute,
    session?.paymentStatus,
    demoId,
    sessionId,
  ]);

  const handleStartTribunal = useCallback(() => {
    const updated = startTribunal(demoId, sessionId);
    setSession(updated);

    if (effectiveMode === "live" && updated.liveCaseId) {
      setLiveStatus(demoId, sessionId, "streaming");
      liveTribunal.start(updated.liveCaseId);
    }
  }, [demoId, sessionId, effectiveMode, liveTribunal]);

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
    liveTribunal.stop();
    const fresh = resetSession(demoId, sessionId);
    setSession(fresh);
  }, [demoId, sessionId, liveTribunal]);

  const handleSwitchToDemo = useCallback(() => {
    liveTribunal.stop();
    setBackendMode("demo");
    clearLiveError(demoId, sessionId);
  }, [setBackendMode, demoId, sessionId, liveTribunal]);

  const handleSimulateHumanApprove = useCallback(async () => {
    if (!session) return;
    const amount = demoId === "3" ? 60 : 0;
    if (amount > 0) {
      try {
        const payRes = await mockRydePayCleaningFee({
          amount,
          case_id: session.liveCaseId ?? `DEMO-${demoId}`,
        });
        setPaymentStatus(demoId, sessionId, "completed", payRes.transaction_id);
      } catch {
        setPaymentStatus(demoId, sessionId, "failed");
      }
    } else {
      setPaymentStatus(demoId, sessionId, "completed");
    }
  }, [session, demoId, sessionId]);

  const handleSimulateHumanReject = useCallback(() => {
    setPaymentStatus(demoId, sessionId, "completed");
  }, [demoId, sessionId]);

  const scenario = getScenario(demoId);
  const fixture = getFixtureByDemoId(demoId);
  const presenterStep = session ? getPresenterStep(demoId, session.stage) : undefined;

  // Determine what to show in the tribunal board
  const tribunalEvents =
    effectiveMode === "live" && liveTribunal.events.length > 0
      ? liveTribunal.events
      : fixture?.events ?? [];
  const tribunalEvidence =
    effectiveMode === "live" && liveTribunal.result
      ? buildEvidenceFromCaseResult(liveTribunal.result)
      : fixture?.evidence ?? [];
  const tribunalFraud =
    effectiveMode === "live" && liveTribunal.result
      ? buildFraudSignalsFromCaseResult(liveTribunal.result)
      : fixture?.fraudSignals;
  const isLiveStreaming = effectiveMode === "live" && liveTribunal.isStreaming;

  // Determine decision data
  const liveDecision = liveTribunal.result
    ? mapCaseResultToTribunalDecision(liveTribunal.result)
    : null;

  const progressStages: { key: DisputeStage | "resolved"; labelEn: string; labelZh: string }[] = [
    { key: "none", labelEn: "Trip", labelZh: "行程" },
    { key: "private_support", labelEn: "Private Assist", labelZh: "私人协助" },
    { key: "formal_filed", labelEn: "Formal Case", labelZh: "正式案件" },
    { key: "under_review", labelEn: "Tribunal", labelZh: "法庭" },
    { key: "resolved", labelEn: "Decision", labelZh: "裁决" },
  ];

  const currentProgressIndex = progressStages.findIndex(
    (s) => s.key === (session?.stage ?? "none")
  );

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
              {scenario
                ? locale === "zh"
                  ? demoId === "1"
                    ? "自动化"
                    : demoId === "2"
                    ? "公平性"
                    : "负责任 AI"
                  : demoId === "1"
                  ? "AUTOMATION"
                  : demoId === "2"
                  ? "FAIRNESS"
                  : "RESPONSIBLE AI"
                : ""}
            </span>
            {session?.liveCaseId && (
              <span className="inline-flex items-center rounded-full bg-[#F0FDFA] px-2.5 py-0.5 text-[10px] font-bold text-[#0D9488]">
                LIVE · {session.liveCaseId}
              </span>
            )}
            {effectiveMode === "demo" && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold text-[#6B7280]">
                DEMO MODE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleBackendMode}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                effectiveMode === "live"
                  ? "bg-[#0D9488] text-white"
                  : "bg-gray-100 text-[#6B7280] hover:bg-gray-200"
              }`}
            >
              {effectiveMode === "live" ? t("live.backendLive") : t("live.backendDemo")}
            </button>
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
                <RydeApp demoId={demoId} sessionId={sessionId} party="passenger" embedded />
              </div>
            </div>
          </div>

          {/* Center */}
          <div className="xl:col-span-6 space-y-4">
            {/* Presenter guide */}
            {presenterMode && presenterStep && (
              <PresenterGuide step={presenterStep} />
            )}

            {/* Presenter mode: reference vs live outcome */}
            {presenterMode && session?.tribunalStarted && presenterStep && (
              <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
                  {t("live.referenceOutcome")}
                </p>
                <p className="text-xs text-[#111827]">
                  {demoId === "1"
                    ? "S$3.25 partial refund — automated"
                    : demoId === "2"
                    ? "No refund — automated"
                    : "Human review required"}
                </p>
                {effectiveMode === "live" && (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#E84360] pt-1">
                      {t("live.backendOutcome")}
                    </p>
                    {liveDecision ? (
                      <p className="text-xs text-[#111827]">
                        {liveDecision.status === "partial_refund"
                          ? `${liveDecision.amount} refund — ${liveDecision.executionRoute}`
                          : liveDecision.status === "no_refund"
                          ? `No refund — ${liveDecision.executionRoute}`
                          : liveDecision.status === "human_review"
                          ? `Human review — ${liveDecision.executionRoute}`
                          : `Judge result incomplete — ${liveDecision.executionRoute}`}
                      </p>
                    ) : (
                      <p className="text-xs text-[#6B7280]">
                        {session?.tribunalCompleted
                          ? "Unavailable / incomplete"
                          : "Processing..."}
                      </p>
                    )}
                    {liveDecision && (
                      <p className="text-[10px] text-[#6B7280]">
                        {t("live.backendAuthoritative")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* LIVE: Creating case */}
            {effectiveMode === "live" &&
              session?.stage === "formal_filed" &&
              !session.tribunalStarted &&
              !session.liveCaseId &&
              !session.liveError && (
                <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#0D9488] animate-pulse" />
                    <p className="text-sm text-[#111827] font-medium">
                      {t("live.creatingCase")}
                    </p>
                  </div>
                </div>
              )}

            {/* LIVE: Case created, ready to start tribunal */}
            {effectiveMode === "live" &&
              session?.stage === "formal_filed" &&
              !session.tribunalStarted &&
              session.liveCaseId && (
                <div className="rounded-xl border border-[#E84360]/20 bg-[#FDF1F3] p-4 text-center">
                  <p className="text-sm text-[#111827] font-medium mb-1">
                    {t("live.caseCreated")}: {session.liveCaseId}
                  </p>
                  <p className="text-xs text-[#6B7280] mb-3">
                    {t("live.readyForTribunal")}
                  </p>
                  <button
                    onClick={handleStartTribunal}
                    className="px-6 py-2.5 rounded-lg bg-[#E84360] text-white text-sm font-semibold hover:bg-[#DE3557] active:scale-[0.98] transition-all"
                  >
                    {t("guided.startTribunal")}
                  </button>
                </div>
              )}

            {/* LIVE: Case creation error */}
            {effectiveMode === "live" &&
              session?.stage === "formal_filed" &&
              !session.tribunalStarted &&
              !session.liveCaseId &&
              session.liveError && (
                <div className="rounded-xl border border-[#E84360]/20 bg-[#FDF1F3] p-4 text-center space-y-3">
                  <p className="text-sm text-[#E84360] font-medium">{t("live.backendUnavailable")}</p>
                  {session.liveError && (
                    <p className="text-xs text-[#6B7280]">{session.liveError}</p>
                  )}
                  <button
                    onClick={handleSwitchToDemo}
                    className="px-4 py-2 rounded-lg bg-gray-100 text-[#6B7280] text-xs font-semibold hover:bg-gray-200 transition-colors"
                  >
                    {t("live.switchToDemo")}
                  </button>
                </div>
              )}

            {/* DEMO: Start tribunal button */}
            {effectiveMode === "demo" &&
              session?.stage === "formal_filed" &&
              !session.tribunalStarted && (
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

            {/* Streaming status */}
            {isLiveStreaming && (
              <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-[#0D9488] animate-pulse" />
                  <p className="text-sm text-[#111827] font-medium">{t("live.streamingTribunal")}</p>
                </div>
                <p className="text-xs text-[#6B7280]">{session?.liveCaseId}</p>
              </div>
            )}

            {/* DEMO: Complete tribunal button */}
            {effectiveMode === "demo" &&
              session?.tribunalStarted &&
              !session.tribunalCompleted &&
              fixture && (
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

            {/* SSE Error with fallback */}
            {effectiveMode === "live" && session?.liveStatus === "error" && (
              <div className="rounded-xl border border-[#E84360]/20 bg-[#FDF1F3] p-4 text-center space-y-3">
                <p className="text-sm text-[#E84360] font-medium">{t("live.pipelineStopped")}</p>
                {session.liveError && (
                  <p className="text-xs text-[#6B7280]">{session.liveError}</p>
                )}
                <div className="flex items-center justify-center gap-3">
                  {session.liveCaseId && (
                    <button
                      onClick={() => liveTribunal.retry(session.liveCaseId!)}
                      className="px-4 py-2 rounded-lg bg-[#0D9488] text-white text-xs font-semibold hover:bg-[#0F766E] transition-colors"
                    >
                      {t("live.retry")}
                    </button>
                  )}
                  <button
                    onClick={handleSwitchToDemo}
                    className="px-4 py-2 rounded-lg bg-gray-100 text-[#6B7280] text-xs font-semibold hover:bg-gray-200 transition-colors"
                  >
                    {t("live.switchToDemo")}
                  </button>
                </div>
              </div>
            )}

            {/* Tribunal Board */}
            {session?.tribunalStarted && (tribunalEvents.length > 0 || fixture) && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <TribunalBoard
                  events={tribunalEvents}
                  evidence={tribunalEvidence}
                  fraudSignals={tribunalFraud}
                  locale={locale}
                  isLive={isLiveStreaming}
                />
              </div>
            )}

            {/* Human Review Required */}
            {session?.tribunalCompleted &&
              (session.decision?.executionRoute === "human_review" ||
                (effectiveMode === "live" && liveDecision?.executionRoute === "human_review")) &&
              session.paymentStatus !== "completed" &&
              session.paymentStatus !== "failed" && (
                <div className="rounded-xl border border-[#B45309]/20 bg-[#FEF3C7] p-4 text-center space-y-3">
                  <p className="text-sm text-[#B45309] font-medium">
                    {locale === "zh" ? "需要人工审查" : "Human Review Required"}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    {locale === "zh"
                      ? "清洁费在执行前需要人工确认。"
                      : "Cleaning fee requires human confirmation before execution."}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleSimulateHumanApprove}
                      className="px-4 py-2 rounded-lg bg-[#0D9488] text-white text-xs font-semibold hover:bg-[#0F766E] transition-colors"
                    >
                      {locale === "zh" ? "批准 S$60 清洁费" : "Approve S$60 Cleaning Fee"}
                    </button>
                    <button
                      onClick={handleSimulateHumanReject}
                      className="px-4 py-2 rounded-lg bg-gray-100 text-[#6B7280] text-xs font-semibold hover:bg-gray-200 transition-colors"
                    >
                      {locale === "zh" ? "拒绝索赔" : "Reject Claim"}
                    </button>
                  </div>
                </div>
              )}

            {/* Payment Result */}
            {session?.paymentStatus === "completed" && (
              <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 text-center space-y-2">
                <p className="text-sm text-[#111827] font-medium">
                  {locale === "zh" ? "模拟 Ryde 支付完成" : "Simulated Ryde Payment Completed"}
                </p>
                {session.paymentTxnId && (
                  <p className="text-xs text-[#6B7280]">
                    {locale === "zh" ? "演示交易 ID" : "Demo Transaction ID"}: {session.paymentTxnId}
                  </p>
                )}
              </div>
            )}
            {session?.paymentStatus === "failed" && (
              <div className="rounded-xl border border-[#E84360]/20 bg-[#FDF1F3] p-4 text-center space-y-2">
                <p className="text-sm text-[#E84360] font-medium">
                  {locale === "zh" ? "支付模拟失败" : "Payment simulation failed"}
                </p>
              </div>
            )}

            {/* Decision */}
            {session?.tribunalCompleted && (
              <div className="space-y-4">
                {effectiveMode === "live" && liveDecision ? (
                  <>
                    <DecisionView
                      status={liveDecision.status}
                      amount={liveDecision.amount}
                      party="passenger"
                      executionRoute={liveDecision.executionRoute}
                      explanation={liveDecision.explanationForRider}
                      isLive
                    />
                    <DecisionView
                      status={liveDecision.status}
                      amount={liveDecision.amount}
                      party="driver"
                      executionRoute={liveDecision.executionRoute}
                      explanation={liveDecision.explanationForDriver}
                      isLive
                    />
                  </>
                ) : session.decision ? (
                  <>
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
                  </>
                ) : null}
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
                <RydeApp demoId={demoId} sessionId={sessionId} party="driver" embedded />
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
