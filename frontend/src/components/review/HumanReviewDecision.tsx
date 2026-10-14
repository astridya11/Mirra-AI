"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { HumanReviewDecision as Decision, RecommendedAction } from "@/src/types";
import type { DemoId } from "@/src/types/session";
import { ApiError, getCompletedResult, submitHumanReview } from "@/src/lib/api";
import { formatSgd, markPaymentRetry, recordReview } from "@/src/lib/humanReview";
import { useCaseOutcome } from "@/src/hooks/useCaseOutcome";
import { useI18n } from "@/src/context/I18nContext";

type Choice = "confirm" | "modify" | "reject";

interface Props {
  caseRef: string;
  mode: "live" | "demo";
  /** Evidence-supported claim amount in SGD (S$60 for Demo 3). */
  claimAmount: number;
  /** Judge recommendation; for Demo 3 it is usually ESCALATED_NO_ACTION with no fee. */
  recommendedAction?: RecommendedAction | null;
  reviewer?: { id: string; name: string } | null;
  riderId?: string;
  driverId?: string;
  link?: { demoId: DemoId; sessionId: string };
}

/**
 * HUMAN REVIEW DECISION for cleaning-fee cases: Confirm / Modify / Reject.
 * Order is fixed: human decision → POST /human-review succeeds → decision recorded in the
 * ledger → (approved only) one simulated Ryde payment with the human-final amount.
 */
export default function HumanReviewDecision({
  caseRef,
  mode,
  claimAmount,
  recommendedAction,
  reviewer,
  riderId,
  driverId,
  link,
}: Props) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const { outcome, sync } = useCaseOutcome(caseRef, link);
  const [choice, setChoice] = useState<Choice>("confirm");
  const [amount, setAmount] = useState(String(claimAmount));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const aiFee = recommendedAction?.cleaning_fee_amount ?? 0;
  const aiHasFee = aiFee > 0;
  const confirmAmount = aiHasFee ? aiFee : claimAmount;

  const submit = async () => {
    if (inFlight.current || outcome) return;
    setError(null);

    let finalAmount: number | null = null;
    if (choice === "confirm") finalAmount = confirmAmount;
    if (choice === "modify") {
      const n = Number(amount);
      if (amount.trim() === "" || !Number.isFinite(n) || n < 0) {
        setError(zh ? "请输入有效金额（数字，且不小于 0）。" : "Enter a valid amount: a number, 0 or more.");
        return;
      }
      finalAmount = Math.round(n * 100) / 100;
    }
    const decision: Decision =
      choice === "confirm" ? "CONFIRMED_AUTO" : choice === "modify" ? "MODIFIED" : "REJECTED_AUTO";
    const defaultReason =
      choice === "modify"
        ? `Reviewer adjusted the cleaning fee to ${formatSgd(finalAmount ?? 0)}.`
        : choice === "reject"
        ? "Reviewer rejected the cleaning fee claim: evidence does not support the charge."
        : "";
    const reasonText = reason.trim() || defaultReason;

    inFlight.current = true;
    setSubmitting(true);
    try {
      if (mode === "live") {
        if (!reviewer) throw new Error(zh ? "审核员身份不可用。" : "Reviewer identity unavailable.");
        const base: RecommendedAction = recommendedAction ?? {
          action_type: "CLEANING_FEE_CHARGE",
          refund_amount: 0,
          currency: "SGD",
        };
        // The action actually executed. Confirm sends it only when the Judge escalated
        // without an amount, so the backend record matches the approved S$ charge.
        const executed: RecommendedAction = {
          ...base,
          action_type: "CLEANING_FEE_CHARGE",
          refund_amount: 0,
          currency: "SGD",
          cleaning_fee_amount: finalAmount ?? 0,
        };
        try {
          await submitHumanReview(caseRef, {
            reviewer_id: reviewer.id,
            reviewer_name: reviewer.name,
            approval_decision: decision,
            override_reason: decision === "CONFIRMED_AUTO" ? "" : reasonText,
            modified_action:
              decision === "MODIFIED" || (decision === "CONFIRMED_AUTO" && !aiHasFee) ? executed : null,
            review_notes:
              decision === "CONFIRMED_AUTO" && !aiHasFee
                ? `Approved the evidence-supported ${formatSgd(confirmAmount)} cleaning fee claim.`
                : reason.trim(),
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          // Already reviewed elsewhere: record what the backend actually holds, never our local choice.
          const result = await getCompletedResult(caseRef);
          const hd = result?.judge_verdict?.execution_payload?.human_confirmation_details;
          if (!hd?.approval_decision) throw e;
          const fee =
            hd.modified_action?.cleaning_fee_amount ?? result?.judge_verdict?.recommended_action?.cleaning_fee_amount ?? 0;
          recordReview(caseRef, { mode, decision: hd.approval_decision, amount: fee, riderId, driverId });
          sync();
          return;
        }
      }
      recordReview(caseRef, { mode, decision, amount: finalAmount, riderId, driverId });
      sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : zh ? "提交失败。" : "Could not submit the review.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const options: { key: Choice; label: string; title: string; tone: string }[] = [
    {
      key: "confirm",
      label: zh ? "确认 AI 建议" : "Confirm AI recommendation",
      title: zh ? `批准 ${formatSgd(confirmAmount)} 清洁费` : `Approve ${formatSgd(confirmAmount)} Cleaning Fee`,
      tone: "border-[#0D9488] bg-[#F0FDFA]",
    },
    {
      key: "modify",
      label: zh ? "修改决定" : "Modify decision",
      title: zh ? "设定最终新币金额" : "Set the final SGD amount",
      tone: "border-[#B45309] bg-[#FFFBEB]",
    },
    {
      key: "reject",
      label: zh ? "拒绝建议" : "Reject recommendation",
      title: zh ? "拒绝清洁费索赔" : "Reject Cleaning Fee Claim",
      tone: "border-[#E84360] bg-[#FDF1F3]",
    },
  ];

  const backHref = link ? `/demo/${link.demoId}/guided?session=${encodeURIComponent(link.sessionId)}` : null;

  return (
    <section
      aria-labelledby="hrd-title"
      className="rounded-2xl border-2 border-[#111827] bg-white shadow-sm overflow-hidden"
      data-human-review-decision
    >
      <header className="flex flex-wrap items-center justify-between gap-2 bg-[#111827] px-5 py-3">
        <h2 id="hrd-title" className="text-[13px] font-bold uppercase tracking-[0.12em] text-white">
          {zh ? "人工审核决定" : "Human Review Decision"}
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            mode === "live" ? "bg-[#0D9488] text-white" : "bg-white/15 text-white"
          }`}
        >
          {mode === "live" ? "LIVE" : zh ? "演示模式 · 非真实案件" : "DEMO MODE · not a live case"}
        </span>
      </header>

      <div className="p-5 space-y-4">
        <div className="rounded-xl bg-[#F9FAFB] border border-gray-100 p-3 text-[13px] text-[#374151] leading-relaxed">
          <span className="font-semibold text-[#111827]">{zh ? "AI 建议：" : "AI recommendation: "}</span>
          {aiHasFee
            ? zh
              ? `收取 ${formatSgd(aiFee)} 清洁费，执行前需人工确认。`
              : `charge a ${formatSgd(aiFee)} cleaning fee, pending human confirmation.`
            : zh
            ? `不自动执行。${formatSgd(claimAmount)} 的清洁费索赔需要人工审核。`
            : `no automatic action. The ${formatSgd(claimAmount)} cleaning fee claim needs a human decision.`}
          <span className="block text-[12px] text-[#6B7280] mt-1">
            {zh ? "在人工审核成功之前不会发生任何付款。" : "No payment runs until a human review succeeds."}
          </span>
        </div>

        {outcome ? (
          <OutcomeView outcome={outcome} zh={zh} backHref={backHref} onRetry={() => { markPaymentRetry(caseRef); sync(); }} />
        ) : (
          <>
            <fieldset className="grid gap-3 sm:grid-cols-3" disabled={submitting}>
              <legend className="sr-only">{zh ? "您的决定" : "Your decision"}</legend>
              {options.map((o) => (
                <label
                  key={o.key}
                  className={`cursor-pointer rounded-xl border-2 p-3 transition-colors ${
                    choice === o.key ? o.tone : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="hrd-choice"
                    value={o.key}
                    checked={choice === o.key}
                    onChange={() => {
                      setChoice(o.key);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">{o.label}</span>
                  <span className="mt-1 block text-[14px] font-semibold text-[#111827] leading-snug">{o.title}</span>
                </label>
              ))}
            </fieldset>

            {choice === "modify" && (
              <div className="space-y-1">
                <label htmlFor="hrd-amount" className="text-[13px] font-medium text-[#111827]">
                  {zh ? "最终清洁费（新币）" : "Final cleaning fee (SGD)"}
                </label>
                <div className="flex items-center gap-2 max-w-[220px]">
                  <span className="text-[14px] font-semibold text-[#6B7280]">S$</span>
                  <input
                    id="hrd-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] tabular-nums focus:border-[#B45309] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {choice !== "confirm" && (
              <div className="space-y-1">
                <label htmlFor="hrd-reason" className="text-[13px] font-medium text-[#111827]">
                  {zh ? "原因（可选，将记录到审核记录）" : "Reason (optional, saved with the review)"}
                </label>
                <textarea
                  id="hrd-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-[13px] focus:border-[#111827] focus:outline-none"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className={`w-full rounded-xl px-4 py-3 text-[14px] font-semibold text-white transition-opacity disabled:opacity-50 ${
                choice === "reject" ? "bg-[#E84360]" : choice === "modify" ? "bg-[#B45309]" : "bg-[#0D9488]"
              }`}
            >
              {submitting
                ? zh
                  ? "正在提交人工审核…"
                  : "Submitting human review…"
                : choice === "confirm"
                ? options[0].title
                : choice === "modify"
                ? zh
                  ? `批准修改后的 ${formatSgd(Number(amount) || 0)} 清洁费`
                  : `Approve modified ${formatSgd(Number(amount) || 0)} cleaning fee`
                : options[2].title}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function OutcomeView({
  outcome,
  zh,
  backHref,
  onRetry,
}: {
  outcome: NonNullable<ReturnType<typeof useCaseOutcome>["outcome"]>;
  zh: boolean;
  backHref: string | null;
  onRetry: () => void;
}) {
  const rejected = outcome.decision === "REJECTED_AUTO" || !outcome.amount;
  const decisionLabel =
    outcome.decision === "CONFIRMED_AUTO"
      ? zh ? "已确认" : "Confirmed"
      : outcome.decision === "MODIFIED"
      ? zh ? "已修改" : "Modified"
      : outcome.decision === "OVERRIDDEN"
      ? zh ? "已推翻" : "Overridden"
      : zh ? "已拒绝" : "Rejected";

  return (
    <div className="space-y-3" data-review-outcome={outcome.decision}>
      <div className={`rounded-xl border p-4 ${rejected ? "border-gray-200 bg-[#F9FAFB]" : "border-[#0D9488]/30 bg-[#F0FDFA]"}`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
          {zh ? "人工最终决定" : "Human final decision"} · {decisionLabel}
        </p>
        <p className="mt-1 text-[18px] font-bold text-[#111827]">
          {rejected
            ? zh
              ? "索赔已拒绝"
              : "Claim rejected"
            : zh
            ? `已批准 ${formatSgd(outcome.amount ?? 0)} 清洁费`
            : `${formatSgd(outcome.amount ?? 0)} cleaning fee approved`}
        </p>
        {rejected && (
          <p className="mt-1 text-[13px] text-[#374151]">
            {zh ? "不收取清洁费 · 不向司机付款" : "No cleaning fee charged · No driver payout"}
          </p>
        )}
      </div>

      {outcome.paymentStatus === "pending" && (
        <div className="rounded-xl border border-[#0D9488]/20 bg-white p-4 text-[13px] text-[#374151] flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#0D9488] animate-pulse" />
          {zh ? "人工审核已成功，正在执行模拟 Ryde 支付…" : "Human review succeeded. Running simulated Ryde payment…"}
        </div>
      )}
      {outcome.paymentStatus === "completed" && (
        <div className="rounded-xl border border-[#0D9488]/30 bg-white p-4 space-y-1" data-payment-completed>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
            {zh ? "模拟 Ryde 支付" : "Simulated Ryde Payment"}
          </p>
          <p className="text-[14px] font-semibold text-[#111827]">
            {zh ? `已扣取 ${formatSgd(outcome.amount ?? 0)} 清洁费` : `${formatSgd(outcome.amount ?? 0)} cleaning fee charged`}
          </p>
          <p className="text-[12px] text-[#6B7280] tabular-nums break-all">
            {zh ? "演示交易 ID" : "Demo Transaction ID"}: <span className="font-mono text-[#111827]">{outcome.txnId}</span>
          </p>
        </div>
      )}
      {outcome.paymentStatus === "failed" && (
        <div className="rounded-xl border border-[#E84360]/30 bg-[#FDF1F3] p-4 space-y-2">
          <p className="text-[13px] font-semibold text-[#E84360]">
            {zh ? "模拟支付失败。审核决定已保存。" : "Simulated payment failed. The review decision is saved."}
          </p>
          <button onClick={onRetry} className="rounded-lg bg-[#E84360] px-3 py-1.5 text-[12px] font-semibold text-white">
            {zh ? "重试支付" : "Retry payment"}
          </button>
        </div>
      )}
      {outcome.paymentStatus === "not_required" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
            {zh ? "支付" : "Payment"}
          </p>
          <p className="text-[13px] text-[#374151]">
            {zh ? "无需支付：未调用支付接口。" : "Not required: the payment endpoint was not called."}
          </p>
        </div>
      )}

      {backHref && (
        <Link
          href={backHref}
          className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-center text-[13px] font-semibold text-[#111827] hover:bg-gray-50"
        >
          {zh ? "返回引导演示，查看双方结果" : "Back to Guided Demo to see both parties' results"}
        </Link>
      )}
    </div>
  );
}
