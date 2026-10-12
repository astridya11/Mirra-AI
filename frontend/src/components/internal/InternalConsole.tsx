"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { MirraLogo, RouteBadge } from "@/src/components/showcase/ui";
import { APPS } from "@/src/demo/scenarios";
import { defaultSession, internalView } from "@/src/demo/session";
import { liveTribunal, pendingTribunal, useLiveResult, useLiveRun } from "@/src/demo/live";
import { STEPS, stepName, tribunalFor, type EvState, type Step } from "@/src/demo/tribunal";
import { useScenarioSession } from "@/src/demo/useDemoSession";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { appFor } from "@/src/i18n/content";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";
import { RawText } from "@/src/i18n/RawText";

const TABS = ["overview", "evidence", "logs", "policy", "decision", "learnings"] as const;
type Tab = (typeof TABS)[number];

const EV_DARK: Record<EvState, string> = {
  VERIFIED: "text-green-300 bg-green-500/10",
  DISPUTED: "text-amber-300 bg-amber-500/10",
  MISSING: "text-slate-400 bg-white/5",
  CONTRADICTED: "text-red-300 bg-red-500/10",
};

/**
 * Demo observer console. Reads internalView(session) — the only consumer allowed to
 * see private-session status — plus structured tribunal outputs. No chain-of-thought.
 */
export function InternalConsole({ caseId }: { caseId: string }) {
  return (
    <Suspense>
      <ConsoleInner caseId={caseId} />
    </Suspense>
  );
}

function ConsoleInner({ caseId }: { caseId: string }) {
  const params = useSearchParams();
  const entry = Object.entries(APPS).find(([, a]) => a.caseId === caseId);
  const demoId = entry?.[1].demoId ?? "";
  const sid = params.get("session") ?? defaultSession(demoId);
  const { session } = useScenarioSession(demoId, sid);
  const [tab, setTab] = useState<Tab>("overview");
  const liveRes = useLiveResult(session.liveCaseId);
  const run = useLiveRun(session.liveCaseId);
  const { t, locale } = useI18n();
  const app = entry && appFor(entry[1], locale);
  const tc = !app
    ? undefined
    : session.liveCaseId
      ? liveRes
        ? liveTribunal(app, liveRes, run, t)
        : pendingTribunal(app, run, t, locale)
      : tribunalFor(caseId, session.photoUploaded && session.receiptUploaded, locale);

  if (!entry || !tc) return <Shell>{t("console.unknown", { caseId })}</Shell>;
  const live = !!session.liveCaseId;
  const backendText = live || !!tc.judge?.raw;
  const yesNo = (b: boolean) => t(b ? "common.yes" : "common.no");

  const iv = internalView(session);
  // Live: every streamed/result event is shown; fixture: only the presenter-revealed ones.
  const revealed = session.liveCaseId ? tc.events.length : iv.revealed;
  const shown = tc.events.slice(0, revealed);
  const reached = (s: Step) => shown.some((e) => e.step === s);
  const done = session.liveCaseId ? !!liveRes : iv.revealed >= tc.events.length;
  const lastIdx = shown.length ? STEPS.findIndex((s) => s.key === shown[shown.length - 1].step) : -1;

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <MirraLogo dark subtitle={false} />
          <p className="text-lg font-bold text-white mt-3">{t("console.title")}</p>
          <p className="text-xs text-mirra font-semibold">{t("console.observer")}</p>
          <div className="mt-2">
            <LanguageSwitch dark compact />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
          <Dt k={t("console.case")}>{session.liveCaseId ? `${session.liveCaseId} (${t("console.live")})` : caseId}</Dt>
          <Dt k={t("console.type")}>{enumLabel(t, tc.disputeType)}</Dt>
          <Dt k={t("console.stage")}>{iv.stage}</Dt>
          <Dt k={t("console.session")}>{iv.sessionId}</Dt>
          <Dt k={t("console.frozen")}>{yesNo(iv.frozen)}</Dt>
          <Dt k={t("console.events")}>
            {revealed}/{tc.events.length}
          </Dt>
        </dl>
      </header>

      <nav className="flex gap-1 overflow-x-auto no-scrollbar my-4" aria-label={t("console.sections")}>
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === k ? "bg-mirra text-white" : "text-slate-400 hover:text-white bg-white/5"}`}
          >
            {t(`console.tab.${k}` as MessageKey)}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t("console.privateSessions")}>
            {iv.privateSessions.length === 0 && <p className="text-slate-500">{t("console.none")}</p>}
            {iv.privateSessions.map((p) => (
              <div key={p.party} className="rounded-lg border border-mirra/40 bg-mirra/10 px-3 py-2 mb-2">
                <p className="text-[10px] font-bold tracking-widest text-mirra">{t("console.privateSession")}</p>
                <p className="text-white">{t(p.party === "passenger" ? "private.passengerActive" : "private.driverActive")}</p>
                <p className="text-slate-400">{t("console.privateMeta", { n: p.messages })}</p>
              </div>
            ))}
          </Panel>
          <Panel title={t("console.formalPipeline")}>
            {!iv.formalBy ? (
              <p className="text-slate-500">{t("console.pipelineIdle")}</p>
            ) : (
              <ul className="space-y-1">
                <Row k={t("context.filedBy")}>{t(iv.formalBy === "passenger" ? "role.rider" : "role.driverCap")}</Row>
                <Row k={t("console.riderStatement")}>{t(iv.submitted.passenger ? "console.submitted" : "console.pending")}</Row>
                <Row k={t("console.driverExplanation")}>{t(iv.submitted.driver ? "console.submitted" : "console.pending")}</Row>
                <Row k={t("console.evidence")}>{iv.frozen ? `🔒 ${t("console.frozenState")}` : t("console.open")}</Row>
              </ul>
            )}
          </Panel>
          {entry[1].claimForm && (
            <Panel title={t("console.evidencePath")} className="lg:col-span-2">
              <ul className="space-y-1">
                <Row k={t("console.photoUploaded")}>{iv.photoUploaded ? `${yesNo(true)} · ${iv.uploadNames.photo}` : yesNo(false)}</Row>
                <Row k={t("console.receiptUploaded")}>{iv.receiptUploaded ? `${yesNo(true)} · ${iv.uploadNames.receipt}` : yesNo(false)}</Row>
                <Row k={t("console.submissionCompleted")}>{yesNo(iv.evidenceSubmissionCompleted)}</Row>
              </ul>
              <p className="text-white mt-2">{!iv.evidenceSubmissionCompleted ? t("console.pathUndecided") : tc.path}</p>
            </Panel>
          )}
          <Panel title={t("console.agents")} className="lg:col-span-2">
            <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {STEPS.map((s, i) => {
                const status = i < lastIdx || (i === lastIdx && done) ? "COMPLETE" : i === lastIdx ? "RUNNING" : "IDLE";
                return (
                  <li key={s.key} className="rounded-lg bg-white/5 px-3 py-2">
                    <p className="text-white">{stepName(t, s.key)}</p>
                    <p className={`font-mono text-[10px] ${status === "COMPLETE" ? "text-green-300" : status === "RUNNING" ? "text-mirra" : "text-slate-500"}`}>
                      {t(`console.status.${status}` as MessageKey)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {tab === "evidence" &&
        (!reached("audit") || tc.pending ? (
          <Idle>{t("console.idle.evidence")}</Idle>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("console.frozenRecord")} className="lg:col-span-2">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 font-normal">{t("console.th.id")}</th>
                    <th className="font-normal">{t("console.type")}</th>
                    <th className="font-normal">{t("console.th.detail")}</th>
                    <th className="font-normal">{t("console.th.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tc.evidence.map((e) => (
                    <tr key={e.id} className="border-t border-white/5">
                      <td className="py-1.5 font-mono text-slate-300">{e.id}</td>
                      <td className="text-slate-400">{enumLabel(t, e.type)}</td>
                      <td className="text-slate-300">{e.label}</td>
                      <td>
                        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${EV_DARK[e.state]}`} title={e.state}>
                          {enumLabel(t, e.state)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Facts title={t("console.verifiedFacts", { n: tc.verified.length })} facts={tc.verified} tone="text-green-300" raw={backendText} />
            <Facts title={t("console.disputedFacts", { n: tc.disputed.length })} facts={tc.disputed} tone="text-amber-300" raw={backendText} />
            <Facts
              raw={backendText}
              title={
                tc.missingCategories
                  ? t("console.missingFactsCats", { n: tc.missing.length, c: tc.missingCategories.length })
                  : t("console.missingFacts", { n: tc.missing.length })
              }
              facts={tc.missing.map((f) => {
                const cat = tc.missingCategories?.find((c) => c.checks.includes(f.id));
                return cat ? { ...f, text: `[${cat.label}] ${f.text}` } : f;
              })}
              tone="text-slate-400"
            />
            <Panel title={t("console.riskSignals")}>
              <ul className="space-y-1">
                <Row k={t("metric.fraudRisk")}>
                  {enumLabel(t, tc.fraud.level)} · {tc.fraud.score}
                  {tc.fraud.fixture ? ` (${t("metric.fixture")})` : ""}
                </Row>
                <Row k={t("console.safetyThreat")}>{yesNo(tc.safety.threat)}</Row>
                <Row k={t("console.escalationSignal")}>{yesNo(tc.safety.escalated)}</Row>
                <Row k={t("console.priority")}>{enumLabel(t, tc.safety.priority)}</Row>
              </ul>
              <p className="text-slate-400 mt-2">{tc.fraud.note}</p>
            </Panel>
            <Panel title={t("console.crossExam")}>
              {tc.questions.length === 0 && <p className="text-slate-500">{t("console.noQuestions")}</p>}
              {tc.questions.map((q) => (
                <div key={q.text} className="text-slate-300 mb-1">
                  <span className="text-mirra">{t("console.questionTo", { party: t(q.to === "driver" ? "role.driver" : "role.passenger") })}</span>{" "}
                  <RawText as="span" text={q.text} raw={backendText} />
                </div>
              ))}
              <p className="text-[10px] font-bold tracking-widest text-amber-300 mt-3">{t("console.claimsHeader", { n: iv.claims.length })}</p>
              {iv.claims.map((c, i) => (
                <p key={i} className="text-slate-300">
                  {t(c.party === "driver" ? "role.driver" : "role.passenger")}: “{c.text}”
                </p>
              ))}
            </Panel>
          </div>
        ))}

      {tab === "logs" &&
        (shown.length === 0 ? (
          <Idle>{t("console.idle.logs")}</Idle>
        ) : (
          <ol className="space-y-2 font-mono text-xs">
            {shown.map((e, i) => (
              <li key={i} className="rounded-lg bg-white/5 px-3 py-2">
                <p>
                  <span className="text-slate-500">#{String(i + 1).padStart(2, "0")}</span>{" "}
                  <span className="text-mirra">{stepName(t, e.step)}</span> <span className="text-slate-500">{t(`kind.${e.kind}` as MessageKey)}</span>
                  {e.claim && <span className="text-amber-300"> {t("board.claim")}</span>}
                </p>
                <RawText text={e.text} raw={!!e.raw} className="text-slate-200 mt-0.5" />
                {e.note && <p className="text-slate-500">{e.note}</p>}
                {e.imageUrl && (
                  <a href={e.imageUrl} target="_blank" rel="noreferrer" className="text-mirra">
                    {t("console.viewImage")}
                  </a>
                )}
              </li>
            ))}
          </ol>
        ))}

      {tab === "policy" &&
        (!reached("policy") ? (
          <Idle>{t("console.idle.policy")}</Idle>
        ) : (
          <Panel title={t("console.relevantPolicy")}>
            {tc.policy.clauses.map((c) => (
              <div key={c.id} className="mb-2">
                <p className="text-white">
                  <span className="font-mono text-mirra">{c.id}</span> {c.title}
                </p>
                <p className="text-slate-400">{c.summary}</p>
              </div>
            ))}
            {tc.policyNote && <p className="text-amber-300 mt-2">{t("decision.policySafeguard", { note: tc.policyNote })}</p>}
            <div className="text-slate-300 mt-2">
              <span className="text-slate-500">{t("console.policySuggestion")}</span> <RawText as="span" text={tc.policy.suggestion} raw={backendText} />
            </div>
          </Panel>
        ))}

      {tab === "decision" &&
        (!reached("judge") ? (
          <Idle>{t("console.idle.judge")}</Idle>
        ) : (
          <Panel title={t("console.judgeExecution")}>
            {tc.judge ? (
              <ul className="space-y-1">
                <Row k={t("verdict.ruling")}>{tc.judge.ruling}</Row>
                <Row k={t("verdict.action")}>{tc.judge.action}</Row>
                <Row k={t("verdict.confidence")}>
                  {tc.judge.confidence === 0
                    ? `0.00 · ${t("verdict.noAutoDecision")}`
                    : tc.judge.confidence != null
                      ? `${tc.judge.confidence.toFixed(2)}${live ? "" : ` (${t("metric.fixture")})`}`
                      : live
                        ? t("console.judgeUnavailable")
                        : t("console.notAsserted")}
                </Row>
              </ul>
            ) : (
              <p className="text-slate-300">{t("console.awaitingFixture")}</p>
            )}
            {tc.judge && <RawText text={tc.judge.explanation} raw={!!tc.judge.raw} className="text-slate-300 mt-2" />}
            <div className="mt-3">
              {reached("router") && tc.route ? <RouteBadge route={tc.route} /> : <p className="text-slate-500">{t("console.routePending")}</p>}
            </div>
          </Panel>
        ))}

      {tab === "learnings" &&
        (!done ? (
          <Idle>{t("console.idle.learnings")}</Idle>
        ) : (
          <Panel title={t("console.tab.learnings")}>
            <ul className="space-y-1">
              {tc.learnings.map((l) => (
                <li key={l} className="text-slate-300">
                  • {l}
                </li>
              ))}
            </ul>
          </Panel>
        ))}

      <p className="text-[10px] text-slate-600 mt-6">{tc.source}</p>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-console text-slate-300 text-sm">
      <div className="max-w-[1280px] mx-auto px-4 md:px-8 py-6">{children}</div>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs ${className}`}>
      <p className="text-[11px] font-bold tracking-widest text-slate-500 uppercase mb-2">{title}</p>
      {children}
    </section>
  );
}

function Facts({ title, facts, tone, raw }: { title: string; facts: { id: string; text: string }[]; tone: string; raw: boolean }) {
  const { t } = useI18n();
  return (
    <Panel title={title}>
      {facts.length === 0 && <p className="text-slate-500">{t("console.none")}</p>}
      {facts.map((f) => (
        <div key={f.id} className="text-slate-300 mb-1">
          <span className={`font-mono ${tone}`}>{f.id}</span> <RawText as="span" text={f.text} raw={raw} />
        </div>
      ))}
    </Panel>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <li className="flex justify-between gap-4">
      <span className="text-slate-500">{k}</span>
      <span className="font-mono text-slate-200 text-right">{children}</span>
    </li>
  );
}

function Dt({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-200">{children}</dd>
    </>
  );
}

function Idle({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-slate-500">{children}</p>;
}
