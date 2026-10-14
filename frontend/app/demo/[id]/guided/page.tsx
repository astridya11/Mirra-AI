"use client";

import { Suspense } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import RydeApp from "@/src/components/ryde/RydeApp";
import TribunalBoard from "@/src/components/demo/TribunalBoard";
import DecisionView from "@/src/components/demo/DecisionView";
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
} from "@/src/lib/sessionStorage";
import { getFixtureByDemoId } from "@/src/lib/tribunalFixtures";
import { createDispute } from "@/src/lib/api";
import { demoReviewRef, formatSgd, partyFinalResult } from "@/src/lib/humanReview";
import { useCaseOutcome } from "@/src/hooks/useCaseOutcome";
import Link from "next/link";
import { AppShell, Phone, Pill, PresenterPanel } from "@/src/components/showcase/ui";
import { briefingFor } from "@/src/lib/demoBriefings";
import { consoleTarget, partyHref } from "@/src/lib/demoLinks";
import { useHydrated } from "@/src/hooks/useStoredValue";
import {
  mapCaseResultToTribunalDecision,
  buildEvidenceFromCaseResult,
  buildFraudSignalsFromCaseResult,
} from "@/src/lib/liveTribunalAdapter";

function GuidedDemoContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const demoId = (params.id as string) as DemoId;
  const sessionId = searchParams.get("session") ?? `${demoId}-default`;
  const { locale } = useI18n();
  const t = useTranslation();
  const { presenterMode } = usePresenterMode();
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

  // Refresh / return from the review page: rebuild a LIVE tribunal from the stored
  // result. The SSE endpoint re-runs the pipeline per connection, so never auto-reconnect.
  const liveRestore = liveTribunal.restore;
  const liveCaseId = session?.liveCaseId;
  const needsRestore =
    effectiveMode === "live" &&
    !!liveCaseId &&
    !!session?.tribunalStarted &&
    !liveTribunal.isStreaming &&
    !liveTribunal.result &&
    liveTribunal.events.length === 0 &&
    !liveTribunal.error;
  useEffect(() => {
    if (!needsRestore || !liveCaseId) return;
    void liveRestore(liveCaseId).then((ok) => {
      if (!ok) {
        setLiveStatus(
          demoId,
          sessionId,
          "error",
          "The live tribunal was interrupted (page reloaded before it finished). Retry to run it again."
        );
      }
    });
  }, [needsRestore, liveCaseId, liveRestore, demoId, sessionId]);

  // Human review outcome (Demo 3): LIVE case id, or an explicit DEMO MODE review reference.
  const reviewRef =
    demoId === "3" && session?.tribunalCompleted
      ? session.liveCaseId ?? demoReviewRef(sessionId)
      : undefined;
  const { outcome } = useCaseOutcome(reviewRef, { demoId, sessionId });

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

  const handleOpenHumanReview = useCallback(() => {
    if (!reviewRef) return;
    // LIVE: the real review page for the backend case; the query links the decision back
    // to this demo session. DEMO MODE: the offline demo review reference.
    router.push(
      session?.liveCaseId
        ? `/review/${encodeURIComponent(reviewRef)}?demo=${demoId}&session=${encodeURIComponent(sessionId)}`
        : `/review/${encodeURIComponent(reviewRef)}`
    );
  }, [reviewRef, session?.liveCaseId, router, demoId, sessionId]);

  const fixture = getFixtureByDemoId(demoId);
  const presenterStep = session ? getPresenterStep(demoId, session.stage, locale) : undefined;

  // Determine what to show in the tribunal board
  // LIVE never falls back to fixture events: an empty feed shows "waiting for events".
  const tribunalEvents =
    effectiveMode === "live" && session?.liveCaseId ? liveTribunal.events : fixture?.events ?? [];
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

  const zh = locale === "zh";
  const brief = briefingFor(demoId, locale);
  const steps = zh
    ? demoId === "3"
      ? ["行程", "私人协助", "正式索赔", "证据核查", "仲裁", "裁决", "人工审核"]
      : ["行程", "私人协助", "正式投诉", "仲裁", "裁决"]
    : demoId === "3"
    ? ["Trip", "Private Assistance", "Formal Claim", "Evidence / Verification", "Tribunal", "Decision", "Human Review"]
    : ["Trip", "Private Assistance", "Formal Complaint", "Tribunal", "Decision"];
  const d3 = demoId === "3";
  const stepIndex = (() => {
    switch (session?.stage ?? "none") {
      case "none":
        return 0;
      case "private_support":
        return 1;
      case "formal_filed":
        return d3 ? 3 : 2; // Demo 3: the claim is filed together with its evidence
      case "under_review":
        return d3 ? 4 : 3;
      case "resolved":
        return d3 ? (session?.humanReview ? 7 : session?.decision?.executionRoute === "human_review" ? 6 : 5) : 4;
      default:
        return 0;
    }
  })();
  const console_ = consoleTarget(demoId, session, effectiveMode);
  const referenceOutcome = brief?.outcome.headline ?? "";
  const liveOutcome = liveDecision
    ? liveDecision.status === "partial_refund"
      ? `${liveDecision.amount} ${zh ? "退款" : "refund"} · ${liveDecision.executionRoute}`
      : liveDecision.status === "no_refund"
      ? `${zh ? "不予退款" : "No refund"} · ${liveDecision.executionRoute}`
      : liveDecision.status === "human_review"
      ? `${zh ? "人工审核" : "Human review"} · ${liveDecision.executionRoute}`
      : zh
      ? "裁决结果不完整"
      : "Judge result incomplete"
    : null;

  return (
    <AppShell presenter>
      <div className="space-y-5">
        {/* Demo header: title / theme / session, then demo controls (global nav stays above) */}
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0">
            <Link href={`/demo/${demoId}`} className="text-xs text-muted hover:text-mirra">
              ← {zh ? "返回演示简报" : "Back to briefing"}
            </Link>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h1 className="text-2xl font-extrabold text-ink tracking-tight">
                {zh ? `演示 ${demoId} · ${brief?.title ?? ""}` : `DEMO ${demoId} · ${(brief?.title ?? "").toUpperCase()}`}
              </h1>
              <Pill tone="blue">{(brief?.theme ?? "").toUpperCase()}</Pill>
              {session?.liveCaseId ? (
                <Pill tone="green">LIVE · {session.liveCaseId}</Pill>
              ) : effectiveMode === "demo" ? (
                <Pill tone="slate">DEMO MODE</Pill>
              ) : null}
              <span className="text-xs font-mono text-muted">
                {zh ? "会话" : "session"} {sessionId}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs" data-demo-controls>
            <a href={partyHref(demoId, "passenger", sessionId)} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-ink hover:border-mirra/40">
              {zh ? "乘客应用 ↗" : "Passenger App ↗"}
            </a>
            <a href={partyHref(demoId, "driver", sessionId)} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-ink hover:border-mirra/40">
              {zh ? "司机应用 ↗" : "Driver App ↗"}
            </a>
            {console_.href ? (
              <a href={console_.href} target="_blank" rel="noreferrer" className="rounded-lg border border-console bg-console px-3 py-1.5 font-semibold text-white">
                {zh ? "内部控制台 ↗" : "Internal Console ↗"}
              </a>
            ) : (
              <span title={zh ? "提交正式投诉后可用" : "Available after formal complaint"} className="rounded-lg border border-line bg-slate-100 px-3 py-1.5 font-semibold text-muted cursor-not-allowed">
                {zh ? "内部控制台（投诉后可用）" : "Internal Console (after complaint)"}
              </span>
            )}
            <button
              onClick={toggleBackendMode}
              aria-pressed={effectiveMode === "live"}
              className={`rounded-lg border px-3 py-1.5 font-semibold ${
                effectiveMode === "live" ? "border-green-300 bg-green-50 text-ok" : "border-line bg-white text-muted"
              }`}
            >
              {effectiveMode === "live" ? t("live.backendLive") : t("live.backendDemo")}
            </button>
            <button onClick={handleReset} className="rounded-lg border border-line bg-white px-3 py-1.5 text-muted hover:text-ink">
              {t("guided.reset")}
            </button>
          </div>
        </div>

        {/* Progress */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label={zh ? "演示进度" : "Demo progress"} data-progress>
          {steps.map((label, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    current
                      ? "border-mirra bg-mirra text-white"
                      : done
                      ? "border-mirra/30 bg-mirra-soft text-mirra"
                      : "border-line bg-white text-muted"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      current ? "bg-white text-mirra" : done ? "bg-mirra text-white" : "bg-slate-100 text-muted"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  {label}
                </span>
                {i < steps.length - 1 && <span className={`h-px w-4 ${done ? "bg-mirra/40" : "bg-line"}`} />}
              </li>
            );
          })}
        </ol>

        {/* Passenger | presenter + tribunal | Driver */}
        <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)_310px] items-start justify-items-center xl:justify-items-stretch">
          <PhoneColumn label={zh ? "乘客视图" : "Passenger view"} tone="pink">
            <Phone size="md">
              <div className="flex-1 min-h-0" data-phone="passenger">
                <RydeApp demoId={demoId} sessionId={sessionId} party="passenger" embedded />
              </div>
            </Phone>
          </PhoneColumn>

          <div className="w-full min-w-0 space-y-4">
            {presenterStep && (
              <PresenterPanel
                stage={steps[Math.min(stepIndex, steps.length - 1)]}
                say={presenterStep.say}
                watch={presenterStep.watch}
                proves={[presenterStep.proves]}
                expected={[
                  `${zh ? "参考结果" : "Reference"}: ${referenceOutcome}`,
                  ...(effectiveMode === "live" && session?.tribunalStarted
                    ? [`${zh ? "后端结果（以此为准）" : "Backend outcome (authoritative)"}: ${liveOutcome ?? (zh ? "处理中…" : "Processing…")}`]
                    : []),
                ]}
                next={presenterStep.next}
              />
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

            {/* Human Review Required: the decision is made in the real review system, not here */}
            {session?.tribunalCompleted &&
              reviewRef &&
              !outcome &&
              (session.decision?.executionRoute === "human_review" ||
                (effectiveMode === "live" && liveDecision?.executionRoute === "human_review")) && (
                <div className="rounded-2xl border border-[#B45309]/25 bg-[#FFFBEB] p-5 space-y-3" data-human-review-required>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#B45309] animate-pulse" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B45309]">
                      {locale === "zh" ? "需要人工审核" : "Human Review Required"}
                    </p>
                  </div>
                  <p className="text-sm text-[#111827] leading-relaxed">
                    {locale === "zh"
                      ? "MIRRA 已停止自动执行。在人工审核员做出决定之前，不会收取清洁费，也不会向司机付款。"
                      : "MIRRA stopped automation. No cleaning fee is charged and no driver payout happens until a human reviewer decides."}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleOpenHumanReview}
                      className="px-5 py-2.5 rounded-xl bg-[#111827] text-white text-sm font-semibold hover:bg-[#374151] active:scale-[0.98] transition-all"
                    >
                      {locale === "zh" ? "打开人工审核" : "Open Human Review"} →
                    </button>
                    <span className="text-[11px] text-[#6B7280] font-mono break-all">
                      {session.liveCaseId
                        ? `/review/${reviewRef}`
                        : locale === "zh"
                        ? `演示审核参考 · ${reviewRef}`
                        : `Demo review reference · ${reviewRef}`}
                    </span>
                  </div>
                </div>
              )}

            {/* Human final decision + simulated payment (after a successful review only) */}
            {outcome && session?.humanReview && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4" data-final-decision>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B7280]">
                    {locale === "zh" ? "人工最终决定" : "Human final decision"}
                  </p>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold text-[#6B7280]">
                    {outcome.mode === "live" ? `LIVE · ${outcome.caseRef}` : "DEMO MODE"}
                  </span>
                </div>
                <p className="text-xl font-bold text-[#111827]">
                  {outcome.decision === "REJECTED_AUTO" || !outcome.amount
                    ? locale === "zh"
                      ? "索赔已拒绝 · 不收取清洁费 · 不向司机付款"
                      : "Claim rejected · No cleaning fee charged · No driver payout"
                    : locale === "zh"
                    ? `已批准 ${formatSgd(outcome.amount)} 清洁费${outcome.decision === "MODIFIED" ? "（审核员已修改）" : ""}`
                    : `${formatSgd(outcome.amount)} cleaning fee approved${outcome.decision === "MODIFIED" ? " (modified by reviewer)" : ""}`}
                </p>
                {outcome.paymentStatus === "pending" && (
                  <p className="text-xs text-[#6B7280]">
                    {locale === "zh" ? "正在执行模拟 Ryde 支付…" : "Running simulated Ryde payment…"}
                  </p>
                )}
                {outcome.paymentStatus === "completed" && (
                  <div className="rounded-xl border border-[#0D9488]/25 bg-[#F0FDFA] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
                      {locale === "zh" ? "模拟 Ryde 支付" : "Simulated Ryde Payment"}
                    </p>
                    <p className="text-xs text-[#374151] mt-0.5">
                      {locale === "zh" ? "演示交易 ID" : "Demo Transaction ID"}:{" "}
                      <span className="font-mono text-[#111827] break-all">{outcome.txnId}</span>
                    </p>
                  </div>
                )}
                {outcome.paymentStatus === "failed" && (
                  <p className="text-xs font-medium text-[#E84360]">
                    {locale === "zh" ? "模拟支付失败，可在审核页面重试。" : "Simulated payment failed. Retry it from the review page."}
                  </p>
                )}
                {outcome.paymentStatus === "not_required" && (
                  <p className="text-xs text-[#6B7280]">
                    {locale === "zh" ? "无需支付：未调用支付接口。" : "No payment required: the payment endpoint was not called."}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["passenger", "driver"] as const).map((p) => {
                    const r = partyFinalResult(session.humanReview!, p, locale);
                    return (
                      <div key={p} className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3">
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${p === "passenger" ? "text-[#E84360]" : "text-[#0D9488]"}`}>
                          {p === "passenger" ? t("rydeApp.passenger") : t("rydeApp.driver")}
                        </p>
                        <p className="text-sm font-semibold text-[#111827] mt-1">{r.title}</p>
                        <p className="text-xs text-[#6B7280] mt-0.5">{r.body}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tribunal decision (before human review) */}
            {session?.tribunalCompleted && !session.humanReview && (
              <div className="grid gap-4 md:grid-cols-2">
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
              <StageCard demoId={demoId} locale={locale} stage={session?.stage ?? "none"} hint={t("guided.usePartyApps")} />
            )}
          </div>

          <PhoneColumn label={zh ? "司机视图" : "Driver view"} tone="blue">
            <Phone size="md">
              <div className="flex-1 min-h-0" data-phone="driver">
                <RydeApp demoId={demoId} sessionId={sessionId} party="driver" embedded />
              </div>
            </Phone>
          </PhoneColumn>
        </div>
        <p className="text-center text-[11px] text-muted">
          {zh
            ? "两部手机共享同一案件会话，但各自只显示本方视图。"
            : "Both phones share one case session, but each shows only its own party's view."}
        </p>
      </div>
    </AppShell>
  );
}

function PhoneColumn({ label, tone, children }: { label: string; tone: "pink" | "blue"; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${tone === "pink" ? "bg-mirra-soft text-mirra" : "bg-blue-50 text-info"}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** Session, language and modes live in localStorage: render after hydration (no mismatch). */
function HydratedGuidedDemo() {
  return useHydrated() ? (
    <GuidedDemoContent />
  ) : (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-sm text-[#9CA3AF]">Loading guided demo...</div>
    </div>
  );
}

const STAGE_COPY: Record<DemoId, { en: [string, string, string]; zh: [string, string, string] }> = {
  "1": {
    en: [
      "A rider thinks the driver took a longer route.",
      "MIRRA checks GPS against the optimal route: 2.3 km deviation, S$3.25 disputed on a S$18.50 fare.",
      "Passenger phone: open MIRRA AI, ask about the route, then submit a formal complaint.",
    ],
    zh: [
      "乘客认为司机绕了远路。",
      "MIRRA 将 GPS 轨迹与最优路线对比：偏离 2.3 公里，S$18.50 车费中争议 S$3.25。",
      "乘客手机：打开 MIRRA AI，询问路线，然后提交正式投诉。",
    ],
  },
  "2": {
    en: [
      "A rider disputes a S$5 no-show fee.",
      "MIRRA reads the full timeline (08:43 arrival → 08:51 cancellation) and does not automatically side with the complainant.",
      "Passenger phone: open MIRRA AI, check the waiting timeline, then submit a formal complaint.",
    ],
    zh: [
      "乘客对 S$5 未到场费提出异议。",
      "MIRRA 查看完整时间线（08:43 到达 → 08:51 取消），不会自动偏袒投诉方。",
      "乘客手机：打开 MIRRA AI，查看等候时间线，然后提交正式投诉。",
    ],
  },
  "3": {
    en: [
      "A driver claims a S$60 cleaning fee.",
      "MIRRA checks the photo and receipt, flags reuse risk, and stops automation: a human decides before any money moves.",
      "Driver phone: open MIRRA AI, start the cleaning-fee claim and add the photo and receipt.",
    ],
    zh: [
      "司机申请 S$60 清洁费。",
      "MIRRA 核查照片和收据，标记重复使用风险并停止自动执行：任何资金变动前由人工决定。",
      "司机手机：打开 MIRRA AI，开始清洁费索赔并添加照片和收据。",
    ],
  },
};

/** Centre-column guide before the tribunal: what this demo shows and what to do next. */
function StageCard({ demoId, locale, stage, hint }: { demoId: DemoId; locale: "en" | "zh"; stage: DisputeStage; hint: string }) {
  const [story, shows, next] = STAGE_COPY[demoId]?.[locale] ?? ["", "", hint];
  const zh = locale === "zh";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4" data-stage-card>
      <p className="text-lg font-semibold text-[#111827] leading-snug">{story}</p>
      <div className="rounded-xl bg-[#F9FAFB] border border-gray-100 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF] mb-1">
          {zh ? "本演示展示" : "What this demo shows"}
        </p>
        <p className="text-sm text-[#374151] leading-relaxed">{shows}</p>
      </div>
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#E84360] animate-pulse" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#E84360]">
            {stage === "private_support" ? (zh ? "私人协助进行中" : "Private assist in progress") : zh ? "下一步" : "Next step"}
          </p>
          <p className="text-sm text-[#111827] leading-relaxed">
            {stage === "private_support"
              ? zh
                ? "私人 MIRRA 对话只在该方手机上可见。准备好后，在对话中提交正式投诉。"
                : "The private MIRRA chat stays on that party's phone only. When ready, submit the formal complaint from the chat."
              : next}
          </p>
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
      <HydratedGuidedDemo />
    </Suspense>
  );
}
