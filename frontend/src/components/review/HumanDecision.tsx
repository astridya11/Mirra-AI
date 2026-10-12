"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, getCase, getCompletedResult, resolveCase, submitHumanReview, type ReviewCase } from "@/src/lib/api";
import type { ActionType, CaseResult, HumanReviewDecision, RecommendedAction } from "@/src/types";
import {
  NO_ACTION,
  confidenceLabel,
  decisionLabel,
  executeApprovedAction,
  finalAction,
  isReviewed,
  judgeConfidence,
  money,
  moneyFlow,
  reasonLabel,
  recommendationLabel,
  typeLabel,
  type PaymentResult,
} from "./reviewModel";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { RawText } from "@/src/i18n/RawText";

const ACTION_TYPES: ActionType[] = ["FULL_REFUND", "PARTIAL_REFUND", "CLEANING_FEE_CHARGE", "NO_REFUND", "PENALTY_ONLY", "ESCALATED_NO_ACTION"];
const ACCOUNT_ACTIONS = ["NONE", "WARNING_ISSUED", "TEMPORARY_SUSPENSION", "ACCOUNT_BAN"];
const DEFAULT_REVIEWER = { id: "support-demo", name: "Support Agent" };

type Mode = null | "modify" | "reject";
interface Pending {
  decision: HumanReviewDecision;
  action: RecommendedAction | null;
  reason: string;
  title: MessageKey;
}

/**
 * HUMAN REVIEW DECISION — the final step of /review/[caseId].
 * Judge recommendation → Execution Router → PENDING_HUMAN_APPROVAL → this decision → execution.
 * Money moves only after POST /human-review succeeds, via the existing mock Ryde Pay API.
 */
export function HumanDecision({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<CaseResult | null | undefined>(undefined);
  const [queue, setQueue] = useState<ReviewCase | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ action_type: "", refund: "", cleaning: "", account: "NONE" });
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    const [r, q] = await Promise.all([getCompletedResult(caseId).catch(() => null), getCase(caseId).catch(() => null)]);
    setResult(r);
    setQueue(q);
  }, [caseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of external data
    load();
  }, [load]);

  if (result === undefined) return <Shell>{t("hd.loading")}</Shell>;
  if (!result?.judge_verdict)
    return (
      <Shell>
        <p className="text-sm text-gray-600">{t("hd.noResult", { caseId })}</p>
      </Shell>
    );

  const verdict = result.judge_verdict;
  const rec = verdict.recommended_action ?? null;
  const cleaningCase = result.case_metadata.dispute_type === "CLEANING_FEE";
  const recFlow = moneyFlow(rec);
  const currency = rec?.currency || "SGD";
  const conf = judgeConfidence(verdict);
  const reasons = (queue?.escalation_reasons?.length ? queue.escalation_reasons : result.bonus_modules?.escalation_protocol?.escalation_reasons) ?? [];
  const reviewer = queue?.support ?? DEFAULT_REVIEWER;

  const openModify = () => {
    setMode("modify");
    setError(null);
    setForm({
      action_type: rec?.action_type && rec.action_type !== "ESCALATED_NO_ACTION" ? rec.action_type : cleaningCase ? "CLEANING_FEE_CHARGE" : "NO_REFUND",
      refund: String(rec?.refund_amount ?? 0),
      cleaning: String(rec?.cleaning_fee_amount ?? 0),
      account: rec?.account_action ?? "NONE",
    });
  };

  const reviewModified = () => {
    const refund = Number(form.refund);
    const cleaning = Number(form.cleaning);
    if (!reason.trim()) return setError(t("hd.err.modifyReason"));
    if (!Number.isFinite(refund) || refund < 0 || !Number.isFinite(cleaning) || cleaning < 0) return setError(t("hd.err.amounts"));
    const action: RecommendedAction = {
      action_type: form.action_type as ActionType,
      refund_amount: refund,
      cleaning_fee_amount: cleaning,
      currency,
      penalty_target: rec?.penalty_target ?? "NONE",
      account_action: form.account,
    };
    // Same action type with adjusted values = MODIFIED; a different action type replaces the ruling = OVERRIDDEN.
    const decision: HumanReviewDecision = rec && rec.action_type === action.action_type ? "MODIFIED" : "OVERRIDDEN";
    setPending({ decision, action, reason: reason.trim(), title: cleaningCase ? "hd.t.modifiedFee" : "hd.t.modified" });
  };

  const reviewReject = () => {
    if (!reason.trim()) return setError(t("hd.err.rejectReason"));
    setPending({ decision: "REJECTED_AUTO", action: NO_ACTION(currency), reason: reason.trim(), title: cleaningCase ? "hd.t.rejectFee" : "hd.t.reject" });
  };

  const execute = async () => {
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    let updated: CaseResult | null = null;
    try {
      updated = await submitHumanReview(caseId, {
        reviewer_id: reviewer.id,
        reviewer_name: reviewer.name,
        approval_decision: pending.decision,
        override_reason: pending.reason,
        modified_action: pending.action,
        review_notes: "",
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) {
        setError(e instanceof Error ? e.message : t("hd.err.submit"));
        setSubmitting(false);
        return;
      }
    }
    // Decision accepted by the backend → only now execute the approved money movement.
    if (updated && isReviewed(updated)) {
      try {
        setPayment(await executeApprovedAction(updated, finalAction(updated)));
      } catch (e) {
        setPaymentError(e instanceof Error ? e.message : t("hd.err.payment"));
      }
    }
    await resolveCase(caseId).catch(() => {}); // not every case is in the SLA queue
    await load();
    setPending(null);
    setMode(null);
    setSubmitting(false);
  };

  if (isReviewed(result)) return <FinalCard result={result} queue={queue} cleaningCase={cleaningCase} payment={payment} paymentError={paymentError} />;

  const confirmLabel =
    cleaningCase && rec?.action_type === "CLEANING_FEE_CHARGE" && recFlow.cleaning > 0
      ? t("hd.approveFee", { amount: money(recFlow.cleaning) })
      : recFlow.refund > 0
        ? t("hd.confirmRefund", { amount: money(recFlow.refund), type: typeLabel(rec?.action_type, t) })
        : t("hd.confirmAi");

  return (
    <Shell>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-bold tracking-widest text-gray-500 uppercase mb-3">{t("hd.aiOutcome")}</p>
          <dl className="space-y-1.5 text-sm">
            <Row k={t("verdict.ruling")}>
              <span title={verdict.ruling_type}>{enumLabel(t, verdict.ruling_type)}</span>
            </Row>
            <Row k={t("hd.recommendedAction")}>{recommendationLabel(result, t)}</Row>
            <Row k={t("hd.refund")}>{money(rec?.refund_amount)}</Row>
            <Row k={t("hd.cleaningFee")}>{money(rec?.cleaning_fee_amount)}</Row>
            <Row k={t("hd.accountAction")}>{typeLabel(rec?.account_action ?? "NONE", t)}</Row>
            <Row k={t("decision.judgeConfidence")}>
              {conf == null ? <span className="text-amber-700">{t("hd.confUnavailable")}</span> : confidenceLabel(conf, t)}
            </Row>
            <Row k={t("hd.policy")}>{verdict.policy_clauses_applied?.join(", ") || "—"}</Row>
          </dl>
        </section>
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
          <div>
            <p className="text-xs font-bold tracking-widest text-amber-800 uppercase mb-1">{t("hd.whyHuman")}</p>
            <ul className="text-sm text-amber-900 space-y-1">
              {reasons.length ? (
                reasons.map((r) => (
                  <li key={r}>
                    • <RawText as="span" text={reasonLabel(r, t)} raw={reasonLabel(r, t) === r} />
                  </li>
                ))
              ) : (
                <li>• {t("hd.routedDefault")}</li>
              )}
            </ul>
          </div>
          {cleaningCase && (
            <div className="rounded-lg border border-amber-300 bg-white p-3 text-sm space-y-1">
              <p className="font-semibold text-gray-900">{t("hd.pol4")}</p>
              {rec?.action_type === "CLEANING_FEE_CHARGE" && recFlow.cleaning > 0 && (
                <p className="text-gray-700">{t("hd.ifApproved", { amount: money(recFlow.cleaning) })}</p>
              )}
            </div>
          )}
          <p className="text-sm">
            <span className="text-gray-600">{t("hd.paymentStatus")} </span>
            <span className="font-bold text-amber-800">{t("hd.pendingDecision")}</span>
          </p>
        </section>
      </div>

      {!mode && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setPending({ decision: "CONFIRMED_AUTO", action: null, reason: "", title: "hd.t.confirm" })}
            className="flex-1 rounded-xl bg-green-600 text-white font-semibold py-3 hover:bg-green-700"
          >
            {confirmLabel}
          </button>
          <button onClick={openModify} className="flex-1 rounded-xl border-2 border-amber-400 text-amber-800 bg-amber-50 font-semibold py-3 hover:bg-amber-100">
            {t(cleaningCase ? "hd.modifyAmount" : "hd.modifyDecision")}
          </button>
          <button
            onClick={() => {
              setMode("reject");
              setError(null);
            }}
            className="flex-1 rounded-xl border-2 border-red-300 text-red-700 bg-white font-semibold py-3 hover:bg-red-50"
          >
            {t(cleaningCase ? "hd.rejectFee" : "hd.rejectAi")}
          </button>
        </div>
      )}

      {mode === "modify" && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4 space-y-3">
          <p className="font-semibold text-gray-900">{t(cleaningCase ? "hd.modifyFeeTitle" : "hd.modifyTitle")}</p>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <Field label={t("hd.finalAction")}>
              <select value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })} className={INPUT}>
                {ACTION_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {typeLabel(a, t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("hd.accountAction")}>
              <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={INPUT}>
                {ACCOUNT_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {typeLabel(a, t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("hd.cleaningAmount", { currency })}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.cleaning}
                onChange={(e) => setForm({ ...form, cleaning: e.target.value })}
                className={INPUT}
                aria-label={t("hd.cleaningAmountAria")}
              />
            </Field>
            <Field label={t("hd.refundAmount", { currency })}>
              <input type="number" min={0} step="0.01" value={form.refund} onChange={(e) => setForm({ ...form, refund: e.target.value })} className={INPUT} aria-label={t("hd.refundAmountAria")} />
            </Field>
          </div>
          <Field label={t("hd.modifyReason")}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={INPUT} aria-label={t("hd.modifyReasonAria")} />
          </Field>
          <Actions onCancel={() => setMode(null)} onNext={reviewModified} next={t("hd.confirmModified")} tone="amber" />
        </section>
      )}

      {mode === "reject" && (
        <section className="rounded-xl border-2 border-red-200 bg-red-50/40 p-4 space-y-3">
          <p className="font-semibold text-gray-900">{t(cleaningCase ? "hd.t.rejectFee" : "hd.t.reject")}</p>
          <p className="text-sm text-gray-600">{t("hd.noMoneyWillMove", { zero: money(0) })}</p>
          <Field label={t("hd.reasonRequired")}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={INPUT} aria-label={t("hd.rejectReasonAria")} />
          </Field>
          <Actions onCancel={() => setMode(null)} onNext={reviewReject} next={t(cleaningCase ? "hd.rejectFee" : "hd.rejectRec")} tone="red" />
        </section>
      )}

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {pending && (
        <ConfirmModal
          pending={pending}
          action={pending.decision === "CONFIRMED_AUTO" ? rec : pending.action}
          cleaningCase={cleaningCase}
          submitting={submitting}
          onCancel={() => setPending(null)}
          onConfirm={execute}
          error={error}
        />
      )}
    </Shell>
  );
}

function ConfirmModal({
  pending,
  action,
  cleaningCase,
  submitting,
  onCancel,
  onConfirm,
  error,
}: {
  pending: Pending;
  action: RecommendedAction | null;
  cleaningCase: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  error: string | null;
}) {
  const f = moneyFlow(action);
  const { t } = useI18n();
  const question =
    pending.decision === "REJECTED_AUTO"
      ? t(cleaningCase ? "hd.q.rejectFee" : "hd.q.reject")
      : f.cleaning > 0
        ? t("hd.q.fee", { amount: money(f.cleaning) })
        : f.refund > 0
          ? t("hd.q.refund", { amount: money(f.refund) })
          : t("hd.q.confirm");
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 p-4" onClick={() => !submitting && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label={t("hd.modalTitle")} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4">
        <div>
          <p className="text-lg font-bold text-gray-900">{t("hd.modalTitle")}</p>
          <p className="text-sm text-gray-500">{t(pending.title)}</p>
        </div>
        <p className="font-semibold text-gray-900">{question}</p>
        <dl className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm space-y-1">
          {f.cleaning > 0 && (
            <>
              <Row k={t("hd.willCharge")}>{money(f.cleaning)}</Row>
              <Row k={t("hd.willCredit")}>{money(f.cleaning)}</Row>
            </>
          )}
          {f.refund > 0 && <Row k={t("hd.willRefund")}>{money(f.refund)}</Row>}
          {!f.moves && <Row k={t("hd.moneyMovement")}>{t("hd.noneMoves", { zero: money(0) })}</Row>}
          {pending.reason && <Row k={t("hd.reason")}>{pending.reason}</Row>}
          <Row k={t("hd.backendDecision")}>
            <span title={pending.decision}>{enumLabel(t, pending.decision)}</span>
          </Row>
        </dl>
        <p className="text-xs text-gray-500">{t("hd.willResolve")}</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={submitting} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${pending.decision === "REJECTED_AUTO" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
          >
            {submitting ? t("hd.executing") : t("hd.confirmExecute")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only result after human review — also what a reopened resolved case shows. */
function FinalCard({
  result,
  queue,
  cleaningCase,
  payment,
  paymentError,
}: {
  result: CaseResult;
  queue: ReviewCase | null;
  cleaningCase: boolean;
  payment: PaymentResult | null;
  paymentError: string | null;
}) {
  const ep = result.judge_verdict!.execution_payload!;
  const d = ep.human_confirmation_details ?? {};
  const action = finalAction(result);
  const f = moneyFlow(action);
  const rejected = d.approval_decision === "REJECTED_AUTO";
  const { t } = useI18n();
  return (
    <Shell>
      <section className={`rounded-xl border-2 p-5 space-y-4 ${rejected ? "border-red-200 bg-red-50/40" : "border-green-200 bg-green-50/50"}`}>
        <p className={`text-sm font-extrabold tracking-wide ${rejected ? "text-red-700" : "text-green-700"}`}>✓ {t("hd.completed")}</p>
        <p className="text-2xl font-extrabold text-gray-900">{decisionLabel(d.approval_decision, action, cleaningCase, t)}</p>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          {cleaningCase ? (
            <>
              <Row k={t("hd.riderCharged")}>{money(f.cleaning)}</Row>
              <Row k={t("hd.driverCredited")}>{money(f.cleaning)}</Row>
            </>
          ) : (
            <Row k={t("hd.refundToRider")}>{money(f.refund)}</Row>
          )}
          <Row k={t("hd.finalAction")}>{action ? typeLabel(action.action_type, t) : t("hd.asRecommended")}</Row>
          <Row k={t("hd.executionStatus")}>
            <span title={ep.execution_status}>{enumLabel(t, ep.execution_status)}</span>
          </Row>
          <Row k={t("hd.reviewedBy")}>{queue?.resolved_by ?? d.reviewer_id ?? "Support Agent"}</Row>
          <Row k={t("hd.reviewedAt")}>{d.approval_timestamp ? new Date(d.approval_timestamp).toLocaleString() : "—"}</Row>
          <Row k={t("hd.decision")}>
            <span title={d.approval_decision}>{enumLabel(t, d.approval_decision)}</span>
          </Row>
          {d.override_reason && <Row k={t("hd.reason")}>{d.override_reason}</Row>}
        </dl>
        {f.moves && (
          <p className="text-xs text-gray-600">
            {payment
              ? t("hd.paid", { id: payment.transaction_id })
              : paymentError
                ? t("hd.paymentFailed", { error: paymentError })
                : t("hd.paymentNotStored")}
          </p>
        )}
        <Link href="/review" className="inline-block rounded-lg bg-[#E84360] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          {t("hd.backToQueue")}
        </Link>
      </section>
    </Shell>
  );
}

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#E84360] focus:outline-none bg-white";

function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section id="human-decision" className="mt-8 rounded-2xl border-2 border-gray-900/10 bg-white shadow-sm p-6 md:p-8 space-y-5 scroll-mt-24" aria-label={t("hd.aria")}>
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <span className="w-2 h-6 bg-[#E84360] rounded-sm" />
        <h2 className="text-lg font-extrabold tracking-wide text-gray-900">{t("hd.title")}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium text-gray-900 text-right">{children}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Actions({ onCancel, onNext, next, tone }: { onCancel: () => void; onNext: () => void; next: string; tone: "amber" | "red" }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-2">
      <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
        {t("common.cancel")}
      </button>
      <button onClick={onNext} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}>
        {next}
      </button>
    </div>
  );
}
