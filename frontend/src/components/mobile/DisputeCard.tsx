"use client";

import { useState } from "react";
import { RouteBadge } from "@/src/components/showcase/ui";
import type { AppFixture } from "@/src/demo/scenarios";
import type { Action, Party, PartyView } from "@/src/demo/session";
import { useCaseTribunal } from "@/src/demo/live";
import { enumLabel, useI18n } from "@/src/i18n";
import { RawText } from "@/src/i18n/RawText";

/**
 * Formal dispute card — the ONLY dispute surface a party sees, and only once view.dispute exists.
 * Shows the formal claim and the shared ruling, never anyone's private MIRRA chat.
 */
export function DisputeCard({
  app,
  dispute,
  party,
  dispatch,
  uploads,
}: {
  app: AppFixture;
  dispute: NonNullable<PartyView["dispute"]>;
  party: Party;
  dispatch: (a: Action) => void;
  /** This party's own claim evidence (complainant only). */
  uploads?: PartyView["uploads"];
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const filer = t(app.complainant === "driver" ? "role.driver" : "role.passenger");
  const { role, phase } = dispute;
  const statement = t(role === "complainant" ? "dispute.statement" : "dispute.explanation");

  if (phase === "DECIDED" || phase === "HUMAN_REVIEW")
    return <Verdict app={app} party={party} evidenceProvided={dispute.evidenceProvided} liveCaseId={dispute.liveCaseId} />;

  return (
    <div className="rounded-2xl border border-mirra/30 bg-mirra-soft/60 p-3 space-y-2 animate-pop-in">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink">{t(role === "complainant" ? "dispute.caseOpened" : "dispute.newDispute")}</p>
      </div>
      <p className="text-xs text-body">
        {app.claim.title} · {app.claim.amount} · {app.trip.id}
      </p>
      <button onClick={() => setOpen(!open)} className="w-full text-left text-xs font-semibold text-mirra bg-white rounded-lg border border-line px-3 py-2">
        {t(open ? "dispute.hideClaim" : "dispute.viewClaim")} ›
      </button>
      {open && (
        <p className="text-[11px] text-body bg-white rounded-lg border border-line px-3 py-2">
          <span className="block text-[10px] font-bold text-muted uppercase mb-1">{t("dispute.claimBy", { party: filer })}</span>
          <RawText as="span" text={`“${app.claim.description}”`} />
        </p>
      )}

      {uploads && app.claimForm && (
        <p className="text-[11px] text-body bg-white rounded-lg border border-line px-3 py-2">
          {t("dispute.uploads", {
            photo: t(uploads.photo ? "dispute.received" : "dispute.notSubmitted"),
            receipt: t(uploads.receipt ? "dispute.received" : "dispute.notSubmitted"),
          })}
        </p>
      )}
      {phase === "EVIDENCE" ? (
        <div className="bg-white rounded-lg border border-line px-3 py-2 space-y-2">
          <p className="text-[10px] font-bold text-muted uppercase">{t("dispute.finalHeading", { what: statement })}</p>
          {dispute.submitted ? (
            <p className="text-xs font-semibold text-ok">{t("dispute.submitted")}</p>
          ) : (
            <>
              <p className="text-[11px] text-muted">{t("dispute.finalChance")}</p>
              <button onClick={() => dispatch({ type: "submitFinal", party })} className="w-full rounded-lg bg-mirra text-white text-xs font-semibold py-2">
                {t("dispute.submitFinal", { what: statement })}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-white border border-mirra/30 px-3 py-2">
          <p className="text-xs font-bold text-mirra">🔒 {t("tribunal.frozen")}</p>
          <p className="text-[11px] text-muted">{t(phase === "FROZEN" ? "dispute.aboutToBegin" : "dispute.reviewing")}</p>
        </div>
      )}
    </div>
  );
}

/** Same underlying ruling for both parties, perspective-specific wording. Structured fields first. */
function Verdict({ app, party, evidenceProvided, liveCaseId }: { app: AppFixture; party: Party; evidenceProvided: boolean; liveCaseId: string | null }) {
  const { t, locale } = useI18n();
  const { tc } = useCaseTribunal(app, liveCaseId, evidenceProvided, locale);
  if (!tc) return <p className="rounded-2xl border border-line bg-white p-3 text-xs text-muted">{t("verdict.loading")}</p>;
  const cleaning = tc.disputeType === "CLEANING_FEE";
  const payout = cleaning ? tc.execution?.at(-1) : undefined;
  const v = tc.verdict[party];
  const escalated = tc.route === "ESCALATED_HUMAN_REVIEW";
  const conf = tc.judge?.confidence;
  return (
    <div className="rounded-2xl border border-line bg-white p-3 space-y-3 shadow-sm animate-pop-in">
      <div className="flex items-center justify-between">
        <span
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
            tc.route === "FULLY_AUTOMATED" ? "text-ok bg-green-50" : escalated ? "text-warn bg-amber-50" : "text-slate-600 bg-slate-100"
          }`}
        >
          {v.headline}
        </span>
      </div>
      <p className="text-lg font-extrabold text-ink leading-tight">{v.big}</p>
      {tc.judge && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted">{t("verdict.ruling")}</dt>
          <dd className="font-semibold text-ink break-words">{tc.judge.ruling}</dd>
          {tc.judge.action && (
            <>
              <dt className="text-muted">{t("verdict.action")}</dt>
              <dd className="font-semibold text-ink break-words">{tc.judge.action}</dd>
            </>
          )}
          <dt className="text-muted">{t("verdict.route")}</dt>
          <dd className="font-semibold text-ink">{tc.route ? enumLabel(t, tc.route) : t("verdict.awaiting")}</dd>
          <dt className="text-muted">{t("verdict.confidence")}</dt>
          <dd className="font-semibold text-ink">{conf == null ? t("verdict.unavailable") : conf === 0 ? t("verdict.noAutoDecision") : conf.toFixed(2)}</dd>
        </dl>
      )}
      <RawText text={v.body} raw={!!v.raw} className="text-[11px] text-body" />
      {v.note && <p className="text-[11px] text-body font-semibold">{v.note}</p>}
      {tc.judge && tc.route === "FULLY_AUTOMATED" && (
        <ul className="text-[11px] text-body space-y-0.5">
          {tc.judge.findings.slice(0, 3).map((f) => (
            <li key={f}>
              ✓ <RawText as="span" text={f} raw={!!tc.judge?.raw} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 border-t border-line pt-2">
        <div className="text-[10px] text-muted space-y-1 min-w-0">
          <p>{t("verdict.policy", { ids: tc.policy.clauses.map((c) => c.id).join(", ") })}</p>
          {tc.policyNote && <p>{tc.policyNote}</p>}
          {payout && <p className="font-semibold">{t("verdict.payout", { status: payout.status })}</p>}
          {tc.route ? <RouteBadge route={tc.route} /> : !payout && <p className="font-semibold">{t("verdict.awaiting")}</p>}
        </div>
      </div>
      {tc.route === "FULLY_AUTOMATED" && (
        <a
          href={`/review/${tc.caseId}`}
          target="_blank"
          rel="noreferrer"
          className="block text-center rounded-lg border border-line text-xs font-semibold py-2 hover:border-mirra/40"
        >
          {t("verdict.requestReview")}
        </a>
      )}
    </div>
  );
}
