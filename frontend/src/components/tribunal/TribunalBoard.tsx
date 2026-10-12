"use client";

import { Avatar } from "@/src/components/Avatar";
import { AGENTS, type AgentKey } from "@/src/demo/scenarios";
import { factCounts, STEPS, stepName, type EvState, type TribunalCase } from "@/src/demo/tribunal";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { RawText } from "@/src/i18n/RawText";

const SPEAKER: Record<AgentKey, string> = {
  collector: "EVIDENCE_COLLECTOR",
  rider: "RIDER_ADVOCATE",
  driver: "DRIVER_ADVOCATE",
  prosecutor: "PROSECUTOR",
  policy: "POLICY",
  judge: "JUDGE",
  router: "ROUTER",
};

export const EV_STYLE: Record<EvState, string> = {
  VERIFIED: "bg-green-50 text-ok border-green-200",
  DISPUTED: "bg-amber-50 text-warn border-amber-200",
  MISSING: "bg-slate-100 text-slate-500 border-slate-200",
  CONTRADICTED: "bg-red-50 text-red-600 border-red-200",
};

/**
 * Multi-agent tribunal: agent timeline | structured event feed | evidence reviewed.
 * Renders structured agent outputs only — no chain-of-thought.
 */
export function TribunalBoard({ tc, revealed }: { tc: TribunalCase; revealed: number }) {
  const shown = tc.events.slice(0, revealed);
  const done = revealed >= tc.events.length;
  const lastIdx = shown.length ? STEPS.findIndex((s) => s.key === shown[shown.length - 1].step) : -1;
  const audited = shown.some((e) => e.step === "audit");
  const { t } = useI18n();

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* LEFT — agent timeline */}
      <section className="rounded-2xl bg-white border border-line p-4" aria-label={t("board.timeline")}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-ink">{t("board.title")}</p>
          {!done && revealed > 0 && <span className="text-[10px] font-bold text-white bg-mirra rounded px-1.5 py-0.5">{t("board.live")}</span>}
        </div>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const status = i < lastIdx || (i === lastIdx && done) ? "done" : i === lastIdx ? "active" : "pending";
            return (
              <li
                key={s.key}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${status === "active" ? "bg-mirra-soft" : ""} ${
                  status === "pending" ? "opacity-45" : ""
                }`}
              >
                <Avatar speaker={SPEAKER[s.agent]} />
                <span className="flex-1 font-semibold text-ink">{stepName(t, s.key)}</span>
                <span className="text-[10px] text-muted">{status === "done" ? "✓" : status === "active" ? "●" : "…"}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* CENTER — structured agent events */}
      <section className="rounded-2xl bg-white border border-line p-4 min-w-0" aria-label={t("board.discussion")}>
        <p className="text-sm font-bold text-ink mb-3">{t("board.events")}</p>
        {shown.length === 0 && <p className="text-xs text-muted">{t("board.empty")}</p>}
        <ol className="space-y-2">
          {shown.map((e, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line px-3 py-2 animate-pop-in">
              <Avatar speaker={SPEAKER[e.speaker]} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold" style={{ color: AGENTS[e.speaker].color }}>
                    {e.kind === "RESPONSE"
                      ? t("board.relaying", { agent: t(`agent.${e.speaker}.name` as MessageKey), party: t(e.claim?.party === "driver" ? "role.driver" : "role.passenger") })
                      : stepName(t, e.step)}
                  </span>
                  <span className="text-[9px] font-bold tracking-wider text-muted border border-line rounded px-1">{t(`kind.${e.kind}` as MessageKey)}</span>
                  {e.claim && <span className="text-[9px] font-bold tracking-wider text-warn bg-amber-50 border border-amber-200 rounded px-1">{t("board.claim")}</span>}
                </div>
                <RawText text={e.text} raw={!!e.raw} className="text-xs text-body mt-0.5 whitespace-pre-line" />
                {e.imageUrl && (
                  <a href={e.imageUrl} target="_blank" rel="noreferrer" className="block mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- backend-rendered evidence image */}
                    <img src={e.imageUrl} alt={e.note ?? t("board.evidenceImage")} className="max-h-64 rounded-lg border border-line" />
                  </a>
                )}
                {e.note && <p className="text-[11px] text-muted mt-1 italic">{e.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* RIGHT — evidence reviewed */}
      <section className="rounded-2xl bg-white border border-line p-4 space-y-3" aria-label={t("board.evidence")}>
        <p className="text-sm font-bold text-ink">{t("board.evidence")}</p>
        <div className="rounded-xl bg-mirra-soft border border-mirra/25 px-3 py-2">
          <p className="text-xs font-bold text-mirra">🔒 {t("tribunal.frozen")}</p>
          <p className="text-[11px] text-muted">{t("board.frozenNote")}</p>
        </div>
        <ul className="space-y-1.5">
          {tc.evidence.map((ev) => (
            <li key={ev.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink truncate">{ev.label}</p>
                <p className="text-[10px] text-muted font-mono truncate">
                  {ev.id} · {enumLabel(t, ev.type)}
                </p>
              </div>
              <span className={`text-[9px] font-bold rounded border px-1.5 py-0.5 ${audited ? EV_STYLE[ev.state] : "bg-slate-50 text-slate-400 border-line"}`}>
                {audited ? enumLabel(t, ev.state) : t("board.pending")}
              </span>
            </li>
          ))}
        </ul>
        {audited && !tc.pending && (
          <div className="grid grid-cols-2 gap-2 text-[11px] animate-pop-in">
            <Metric
              label={t("metric.fraudRisk")}
              value={`${enumLabel(t, tc.fraud.level)} · ${tc.fraud.score}${tc.fraud.fixture ? ` (${t("metric.fixture")})` : ""}`}
              tone={tc.fraud.level}
            />
            <Metric label={t("metric.escalation")} value={t(tc.safety.escalated ? "common.yes" : "common.no")} tone={tc.safety.escalated ? "HIGH" : "LOW"} />
          </div>
        )}
        {audited && !tc.pending && (
          <p className="text-[10px] text-muted">
            {factCounts(tc, t)}
          </p>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const cls = tone === "HIGH" ? "text-red-600 bg-red-50" : tone === "MEDIUM" ? "text-warn bg-amber-50" : "text-ok bg-green-50";
  return (
    <div className={`rounded-lg px-2 py-1.5 ${cls}`}>
      <p className="text-[9px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}
