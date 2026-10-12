"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ConfidenceMeter } from "@/src/components/ConfidenceMeter";
import { DriverApp } from "@/src/components/mobile/DriverApp";
import { PassengerApp } from "@/src/components/mobile/PassengerApp";
import { TripMap } from "@/src/components/mobile/common";
import { TribunalBoard } from "@/src/components/tribunal/TribunalBoard";
import { type AppFixture, type GuideStage } from "@/src/demo/scenarios";
import { defaultSession, driverView, internalView, passengerView, type Action, type DemoSession, type Stage } from "@/src/demo/session";
import { liveTribunal, pendingTribunal, startLiveRun, useLiveMode, useLiveResult, useLiveRun } from "@/src/demo/live";
import { tribunalFor, type TribunalCase } from "@/src/demo/tribunal";
import { useScenarioSession } from "@/src/demo/useDemoSession";
import { reasonLabel } from "@/src/components/review/reviewModel";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { appFor, demoFor, guideFor } from "@/src/i18n/content";
import { RawText } from "@/src/i18n/RawText";
import { AppShell, Card, Phone, Pill, PresenterPanel, RouteBadge, usePresenter } from "./ui";

const STEPPER: MessageKey[] = ["stepper.private", "stepper.formal", "stepper.evidence", "stepper.tribunal", "stepper.decision"];
const STEP_OF: Record<Stage, number> = {
  TRIP: 0,
  PRIVATE_ASSIST: 0,
  FORMAL_COMPLAINT: 1,
  EVIDENCE_INTAKE: 2,
  EVIDENCE_FROZEN: 3,
  TRIBUNAL: 3,
  DECISION: 4,
  HUMAN_REVIEW: 4,
};
const GUIDE_OF: Record<Stage, GuideStage> = {
  TRIP: "TRIP",
  PRIVATE_ASSIST: "PRIVATE",
  FORMAL_COMPLAINT: "FORMAL",
  EVIDENCE_INTAKE: "FORMAL",
  EVIDENCE_FROZEN: "FROZEN",
  TRIBUNAL: "TRIBUNAL",
  DECISION: "DECISION",
  HUMAN_REVIEW: "DECISION",
};

export function GuidedDemo({ n }: { n: string }) {
  return (
    <Suspense>
      <GuidedInner n={n} />
    </Suspense>
  );
}

function GuidedInner({ n }: { n: string }) {
  const params = useSearchParams();
  const sid = params.get("session") ?? defaultSession(n);
  const { app: source, session, dispatch } = useScenarioSession(n, sid);
  const liveRes = useLiveResult(session.liveCaseId);
  const run = useLiveRun(session.liveCaseId);
  const { t, locale } = useI18n();
  const demo = demoFor(n, locale);
  const app = source && appFor(source, locale);

  if (!demo || !app) {
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

  const evidenceProvided = session.photoUploaded && session.receiptUploaded;
  // Live mode: streamed events while running, then the completed backend result. Otherwise the fixture.
  const tc = session.liveCaseId
    ? liveRes
      ? liveTribunal(app, liveRes, run, t)
      : pendingTribunal(app, run, t, locale)
    : tribunalFor(app.caseId, evidenceProvided, locale);
  // Demo 3: once the claim is filed without the required evidence, the presenter guide follows the missing-evidence path.
  const g = guideFor(app.claimForm && session.formalBy && !evidenceProvided ? `${n}-missing` : n, locale)[GUIDE_OF[session.stage]];
  const step = STEP_OF[session.stage];
  const time = app.clock[session.tripStatus] ?? "9:41";

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <Link href={`/demo/${n}`} className="text-xs text-muted hover:text-mirra">
              {t("guided.backToBriefing")}
            </Link>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h1 className="text-2xl font-extrabold text-ink tracking-tight">
                {t("guided.title", { n, title: demo.title.toUpperCase() })}
              </h1>
              <Pill tone="blue">{demo.theme.toUpperCase()}</Pill>
              {session.liveCaseId ? (
                <Pill tone="green">{t("live.badge", { id: session.liveCaseId })}</Pill>
              ) : session.liveStatus === "ERROR" ? (
                <Pill tone="amber">{t("live.unavailable")}</Pill>
              ) : null}
              <span className="text-xs font-mono text-muted">
                {t("guided.meta", { caseId: app.caseId, sid })}
              </span>
            </div>
            <ol className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm">
              {STEPPER.map((s, i) => (
                <li key={s} className={`flex items-center gap-1.5 ${i === step ? "text-mirra font-semibold" : i < step ? "text-ink" : "text-muted"}`}>
                  <span>{i < step ? "●" : i === step ? "◉" : "○"}</span>
                  {t(s)}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <ExtLink href={`/demo/${n}/passenger?session=${sid}`}>{t("briefing.passengerApp")}</ExtLink>
            <ExtLink href={`/demo/${n}/driver?session=${sid}`}>{t("briefing.driverApp")}</ExtLink>
            <ExtLink href={`/internal/${app.caseId}?session=${sid}`} dark>
              {t("briefing.internal")} ↗
            </ExtLink>
            {app.live && <LiveSwitch />}
            <button onClick={() => dispatch({ type: "reset" })} className="rounded-lg border border-line bg-white px-3 py-1.5 text-muted hover:text-ink">
              {t("common.resetSession")}
            </button>
          </div>
        </div>

        {app.claimForm && <EvidenceBranch session={session} />}

        {/* Passenger | shared case context | Driver */}
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_300px] items-start justify-items-center xl:justify-items-stretch">
          <PhoneColumn label={t("guided.passengerView")} tone="pink">
            <Phone size="md" time={time}>
              <PassengerApp app={app} view={passengerView(session)} dispatch={dispatch} />
            </Phone>
          </PhoneColumn>
          <div className="w-full min-w-0 space-y-4">
            <PresenterPanel
              note={{ stage: t(STEPPER[step]), say: g.say, watch: g.watch, next: g.next }}
              proves={[g.proves]}
              expected={
                session.liveCaseId
                  ? [
                      t("guided.referenceOutcome", { outcome: g.expected }),
                      liveRes ? t("guided.liveOutcome", { outcome: tc.headline ?? tc.verdict.passenger.big }) : t("guided.liveOutcomePending"),
                    ]
                  : [g.expected]
              }
            />
            <CaseContext app={app} tc={tc} session={session} dispatch={dispatch} />
          </div>
          <PhoneColumn label={t("guided.driverView")} tone="blue">
            <Phone size="md" time={time}>
              <DriverApp app={app} view={driverView(session)} dispatch={dispatch} />
            </Phone>
          </PhoneColumn>
        </div>
        <p className="text-center text-[11px] text-muted">
          {t("guided.sideBySide")}
        </p>

        {session.frozen && <TribunalBoard tc={tc} revealed={session.liveCaseId ? tc.events.length : session.revealed} />}
      </div>
    </AppShell>
  );
}

/** Backend LIVE (real pipeline) or OFFLINE (fixture) for new claims — a stage fallback if the backend is down. */
function LiveSwitch() {
  const [on, set] = useLiveMode();
  const { t } = useI18n();
  return (
    <button
      onClick={() => set(!on)}
      aria-pressed={on}
      title={t("live.switchHint")}
      className={`rounded-lg border px-3 py-1.5 font-semibold ${on ? "border-green-300 bg-green-50 text-ok" : "border-line bg-white text-muted"}`}
    >
      {t("live.switch", { mode: t(on ? "live.modeLive" : "live.modeOffline") })}
    </button>
  );
}

function ExtLink({ href, children, dark = false }: { href: string; children: ReactNode; dark?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`rounded-lg border px-3 py-1.5 font-semibold ${dark ? "bg-console text-white border-console" : "bg-white text-ink border-line hover:border-mirra/40"}`}
    >
      {children}
    </a>
  );
}

function PhoneColumn({ label, tone, children }: { label: string; tone: "pink" | "blue"; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${tone === "pink" ? "bg-mirra-soft text-mirra" : "bg-blue-50 text-info"}`}>{label}</span>
      {children}
    </div>
  );
}

/** Demo 3: one cleaning-fee claim; the driver's evidence choice picks the path. */
function EvidenceBranch({ session }: { session: DemoSession }) {
  const [presenter] = usePresenter();
  const { t } = useI18n();
  const filed = !!session.formalBy;
  const both = session.photoUploaded && session.receiptUploaded;
  const path = !filed ? null : both ? "upload" : "skip";
  const node = "rounded-xl border px-3 py-2 text-xs";
  const tone = (on: boolean | null) => (on === null ? "border-line bg-white" : on ? "border-mirra bg-mirra-soft" : "border-line bg-white opacity-45");
  const tick = (ok: boolean) => (ok ? "✓" : "—");
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t("branch.aria")}>
      <div className={`${node} ${tone(null)}`}>
        <p className="font-bold text-ink">{t("branch.start")}</p>
      </div>
      <span className="text-mirra">→</span>
      <div className={`${node} ${tone(null)}`}>
        <p className="font-bold text-ink">{t("branch.intake")}</p>
        <p className="text-muted">{t("branch.intakeStatus", { photo: tick(session.photoUploaded), receipt: tick(session.receiptUploaded) })}</p>
      </div>
      <span className="text-mirra">→</span>
      <div className="flex flex-col gap-1.5">
        <div className={`${node} ${tone(path === null ? null : path === "skip")}`}>
          <p className="font-bold text-ink">
            {t("branch.skip")}
            {presenter && <span className="font-normal text-muted"> · {t("branch.skipRef")}</span>}
          </p>
        </div>
        <div className={`${node} ${tone(path === null ? null : path === "upload")}`}>
          <p className="font-bold text-ink">
            {t("branch.upload")}
            {presenter && <span className="font-normal text-muted"> · DISP-004</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function CaseContext({
  app,
  tc,
  session,
  dispatch,
}: {
  app: AppFixture;
  tc: TribunalCase;
  session: DemoSession;
  dispatch: (a: Action) => void;
}) {
  const iv = internalView(session);
  const { t } = useI18n();
  const upload = (ok: boolean) => t(ok ? "context.received" : "context.missing");

  if (!session.formalBy) {
    return (
      <Card className="p-4 space-y-3">
        <p className="text-[11px] font-bold tracking-widest text-muted uppercase">{t("context.sharedTrip")}</p>
        <TripMap deviation={app.trip.deviation} from={app.trip.pickup} to={app.trip.dropoff} className="h-40 rounded-xl" />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat k={t("context.trip")} v={app.trip.id} />
          <Stat k={t("context.when")} v={app.trip.times} />
          <Stat k={t("context.fare")} v={`${app.trip.fare} · ${app.trip.payment}`} />
          <Stat k={t("context.parties")} v={`${app.rider.name} · ${app.driver.name}`} />
        </div>
        <div className="rounded-xl bg-console text-slate-300 px-3 py-2 text-[11px] space-y-1">
          <p className="text-[10px] font-bold tracking-wider text-slate-400">{t("context.observerOnly")}</p>
          {iv.privateSessions.length === 0 ? (
            <p>{t("context.noPrivate")}</p>
          ) : (
            iv.privateSessions.map((p) => (
              <p key={p.party}>
                <span className="text-white font-semibold">{t(p.party === "passenger" ? "private.passengerActive" : "private.driverActive")}</span> ·{" "}
                <span className="text-mirra">{t(p.party === "passenger" ? "private.hiddenFromDriver" : "private.hiddenFromPassenger")}</span>
              </p>
            ))
          )}
          {iv.uploadedBy && (
            <p>
              <span className="text-white font-semibold">{t("context.driverPreparing")}</span> ·{" "}
              {t("branch.intakeStatus", { photo: iv.photoUploaded ? "✓" : "—", receipt: iv.receiptUploaded ? "✓" : "—" })} ·{" "}
              <span className="text-mirra">{t("context.notVisibleRider")}</span>
            </p>
          )}
        </div>
      </Card>
    );
  }

  if (!session.frozen) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold tracking-widest text-muted uppercase">{t("context.formalWindow")}</p>
          <span className="text-[11px] font-mono text-muted">{session.stage}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat k={t("context.caseId")} v={app.caseId} />
          <Stat k={t("context.disputeType")} v={enumLabel(t, tc.disputeType)} />
          <Stat k={t("context.claim")} v={`${app.claim.title} · ${app.claim.amount}`} />
          <Stat k={t("context.filedBy")} v={t(app.complainant === "passenger" ? "role.rider" : "role.driverCap")} />
          <Stat k={t("context.riderEvidence")} v={session.submitted.passenger ? t("context.statementSubmitted") : t("context.waiting")} />
          <Stat k={t("context.driverEvidence")} v={session.submitted.driver ? t("context.explanationSubmitted") : t("context.waiting")} />
          {app.claimForm && <Stat k={t("context.cleaningPhoto")} v={upload(session.photoUploaded)} />}
          {app.claimForm && <Stat k={t("context.cleaningReceipt")} v={upload(session.receiptUploaded)} />}
        </div>
        {app.claimForm && <p className="text-[11px] text-muted">{t("context.notAnalysedYet")}</p>}
        <p className="text-[11px] text-muted">{t("context.finalChance")}</p>
        {session.liveCaseId && (
          <p className="text-[11px] text-ok font-semibold">{t("context.liveCreated", { id: session.liveCaseId })}</p>
        )}
        <button
          onClick={() => {
            dispatch({ type: "startTribunal" });
            const id = session.liveCaseId;
            if (!id) return;
            dispatch({ type: "live", status: "RUNNING" });
            // Started from the click (not an effect) so the backend pipeline runs exactly once.
            startLiveRun(
              id,
              (r) => {
                dispatch({ type: "live", status: "DONE" });
                dispatch({ type: "finishTribunal", escalate: r?.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW" });
              },
              () => dispatch({ type: "live", status: "ERROR" }),
            );
          }}
          className="w-full rounded-xl bg-mirra text-white font-semibold py-3 hover:brightness-110"
        >
          {t("context.startTribunal")}
        </button>
      </Card>
    );
  }

  if (session.liveCaseId) return <LiveControls tc={tc} session={session} dispatch={dispatch} />;
  return <TribunalControls tc={tc} session={session} dispatch={dispatch} replay={!!app.claimForm && !(session.photoUploaded && session.receiptUploaded)} />;
}

/** Live pipeline status + decision. Any tab can finish the session once the backend result exists. */
function LiveControls({ tc, session, dispatch }: { tc: TribunalCase; session: DemoSession; dispatch: (a: Action) => void }) {
  const run = useLiveRun(session.liveCaseId);
  const result = useLiveResult(session.liveCaseId);
  const settled = session.stage === "DECISION" || session.stage === "HUMAN_REVIEW";
  const { t } = useI18n();

  useEffect(() => {
    if (!result || settled) return;
    dispatch({ type: "live", status: "DONE" });
    dispatch({ type: "finishTribunal", escalate: result.result.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW" });
  }, [result, settled, dispatch]);

  return (
    <Card className="p-4 space-y-3">
      <div className="rounded-xl bg-mirra-soft border border-mirra/30 px-4 py-3 text-center">
        <p className="text-lg font-extrabold text-mirra">🔒 {t("tribunal.frozenBanner")}</p>
        <p className="text-xs text-muted">{t("live.frozenNote", { id: session.liveCaseId ?? "" })}</p>
      </div>
      {result ? (
        <Decision tc={tc} />
      ) : (
        <>
          {session.liveStatus === "ERROR" || run?.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {t("live.streamStopped")}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-body">
              <span className="w-2 h-2 rounded-full bg-mirra animate-pulse-dot" />
              {run ? t("live.running", { n: tc.events.length }) : t("live.runningElsewhere")}
            </p>
          )}
          <button onClick={() => dispatch({ type: "goOffline" })} className="text-xs text-muted underline">
            {t("live.switchToDemo")}
          </button>
        </>
      )}
    </Card>
  );
}

function TribunalControls({
  tc,
  session,
  dispatch,
  replay,
}: {
  tc: TribunalCase;
  session: DemoSession;
  dispatch: (a: Action) => void;
  /** Demo 3 missing-evidence path: offer to replay the same claim with evidence. */
  replay: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const { t } = useI18n();
  const total = tc.events.length;
  const done = session.revealed >= total;
  const revealNext = () =>
    dispatch({ type: "reveal", total, escalate: tc.route === "ESCALATED_HUMAN_REVIEW", claim: tc.events[session.revealed]?.claim });

  useEffect(() => {
    if (!playing || done) return;
    const t = setTimeout(revealNext, 1300);
    return () => clearTimeout(t);
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="rounded-xl bg-mirra-soft border border-mirra/30 px-4 py-3 text-center">
        <p className="text-lg font-extrabold text-mirra">🔒 {t("tribunal.frozenBanner")}</p>
        <p className="text-xs text-muted">{t("tribunal.frozenNote")}</p>
      </div>
      {tc.multimodal && <Multimodal tc={tc} />}
      {!done ? (
        <div className="flex items-center gap-2">
          <button onClick={revealNext} className="flex-1 rounded-xl bg-ink text-white font-semibold py-2.5 text-sm">
            {t("tribunal.nextAgent")}
          </button>
          <button onClick={() => setPlaying(!playing)} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
            {playing ? t("tribunal.pause") : t("tribunal.playAll")}
          </button>
          <span className="text-xs font-mono text-muted">
            {session.revealed}/{total}
          </span>
        </div>
      ) : (
        <Decision tc={tc} />
      )}
      {done && replay && (
        <button onClick={() => dispatch({ type: "reset" })} className="w-full rounded-xl bg-info text-white font-semibold py-3 hover:brightness-110">
          {t("tribunal.replay")}
        </button>
      )}
    </Card>
  );
}

function Decision({ tc }: { tc: TribunalCase }) {
  const { t } = useI18n();
  const live = tc.source.startsWith("LIVE") || tc.source.startsWith("实时");
  return (
    <div className="space-y-3 animate-pop-in">
      <div className="flex flex-wrap items-center gap-3">
        {tc.judge?.confidence != null && tc.judge.confidence > 0 && (
          <div className="flex items-center gap-2">
            <ConfidenceMeter score={tc.judge.confidence} size={112} label={t("decision.gaugeLabel")} />
            <p className="text-[10px] text-muted leading-tight">
              {t("decision.judgeConfidence")}
              <br />
              {t(live ? "decision.liveBackend" : "decision.fixtureValue")}
            </p>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {tc.judge
              ? t("decision.recommends", { what: tc.judge.action.startsWith(tc.judge.ruling) ? tc.judge.action : `${tc.judge.ruling} · ${tc.judge.action}` })
              : t("decision.awaitingJudge")}
            {tc.judge?.confidence === 0 && ` · ${t("decision.noAuto")}`}
          </p>
          <p className="text-xl font-extrabold text-ink">{tc.headline ?? tc.verdict.passenger.big}</p>
        </div>
      </div>
      {tc.judge && <RawText text={tc.judge.explanation} raw={!!tc.judge.raw} className="text-xs text-body" />}
      {tc.route === "ESCALATED_HUMAN_REVIEW" && tc.safety.reasons.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <p className="font-bold">{t("decision.whyNotAuto")}</p>
          <ul>
            {tc.safety.reasons.map((r) => (
              <li key={r}>
                • <RawText as="span" text={tc.judge?.confidence != null ? r : reasonLabel(r, t)} raw={tc.judge?.confidence != null} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {tc.execution && (
        <ol className="grid sm:grid-cols-2 gap-1.5 text-[11px]" aria-label={t("decision.executionFlow")}>
          {tc.execution.map((e) => (
            <li
              key={e.step}
              className={`rounded-lg border px-2.5 py-1.5 ${
                e.tone === "pending" ? "border-amber-200 bg-amber-50" : e.tone === "blocked" ? "border-red-200 bg-red-50" : e.tone === "done" ? "border-green-200 bg-green-50" : "border-line bg-surface"
              }`}
            >
              <span className="font-bold text-ink">{e.step}</span>
              <span className="block text-muted">{e.status}</span>
            </li>
          ))}
        </ol>
      )}
      {tc.policyNote && <p className="text-[11px] text-muted border-l-2 border-line pl-2">{t("decision.policySafeguard", { note: tc.policyNote })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {tc.route ? <RouteBadge route={tc.route} /> : !tc.execution && <Pill tone="slate">{t("verdict.awaiting")}</Pill>}
        {tc.route === "ESCALATED_HUMAN_REVIEW" && (
          <a href={`/review/${tc.caseId}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-mirra">
            {t("decision.openReview")}
          </a>
        )}
      </div>
    </div>
  );
}

/** Demo 3 multimodal verification on the frozen evidence — runs as the tribunal begins. */
function Multimodal({ tc }: { tc: TribunalCase }) {
  const mm = tc.multimodal!;
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const finished = step >= mm.steps.length;

  useEffect(() => {
    if (step < 0 || finished) return;
    const id = setTimeout(() => setStep(step + 1), 650);
    return () => clearTimeout(id);
  }, [step, finished]);

  if (step < 0)
    return (
      <button onClick={() => setStep(0)} className="w-full rounded-xl border-2 border-dashed border-info/50 text-info font-semibold py-3 text-sm">
        {t("multimodal.run")}
      </button>
    );

  return (
    <div className="rounded-xl bg-console text-slate-200 p-3 space-y-2">
      <ul className="grid sm:grid-cols-2 gap-1 text-[11px] font-mono">
        {mm.steps.map((s, i) => (
          <li key={s} className={i < step ? "text-slate-300" : i === step ? "text-white" : "text-slate-600"}>
            {i < step ? "✓" : i === step ? "◌" : "·"} {s}
          </li>
        ))}
      </ul>
      {finished && (
        <div className="space-y-2 animate-pop-in">
          <ul className="grid sm:grid-cols-2 gap-1.5">
            {mm.checks.map((c) => (
              <li key={c.label} className={`rounded-lg px-2 py-1.5 text-[11px] ${c.ok ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
                <span className="font-bold">
                  {c.ok ? "✓" : "✕"} {c.label}
                </span>
                <span className="block text-slate-400">{c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white">{t("multimodal.summary")}</p>
          <p className="text-xs">
            {t("metric.fraudScore")} <b className="text-red-300">{tc.fraud.score}</b>
            {tc.fraud.fixture && <span className="text-slate-400"> ({t("metric.demoFixture")})</span>} · <b className="text-red-300">{enumLabel(t, tc.fraud.level)}</b> ·{" "}
            {t("metric.escalation")} <b className="text-red-300">{t(tc.safety.escalated ? "common.yes" : "common.no")}</b>
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-surface border border-line px-2.5 py-1.5 min-w-0">
      <p className="text-[10px] text-muted">{k}</p>
      <p className="font-semibold text-ink truncate">{v}</p>
    </div>
  );
}

