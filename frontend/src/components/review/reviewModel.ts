/**
 * Human Support review helpers — shared by the queue (/review) and the case detail decision section.
 * Pure display/mapping logic over the existing backend contract (CaseResult, ReviewCase,
 * HumanReviewRequest). No new decision enum: the four HumanReviewDecision values are used as-is.
 */

import { backendUrl } from "@/src/lib/api";
import type { CaseResult, HumanReviewDecision, RecommendedAction } from "@/src/types";
import { tEn, type Locale, type Translator } from "@/src/i18n";
import { describeAction, formatMoney } from "@/src/lib/reviewFormat";
import { en, type MessageKey } from "@/src/i18n/en";

export const money = (n?: number | null) => `S$${(n ?? 0).toFixed(2)}`;

/** Display label for a raw enum: the dictionary label when one exists, else Title Case. Raw value untouched. */
export const typeLabel = (v?: string, t: Translator = tEn) => {
  const key = `enum.${v}` as MessageKey;
  if (v && key in en) return t(key);
  return (v ?? "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

const FAILED_RUN = /fail|error|not set|unavailable|exception/i;

/**
 * Judge confidence only when it comes from a completed, non-failed Judge run.
 * A failed run (e.g. missing LLM credentials) stores confidence_score=0 — that is not a confidence.
 */
export function judgeConfidence(verdict?: { confidence_score?: number | null; reasoning_summary?: string | null; ruling_type?: string } | null): number | null {
  if (!verdict || typeof verdict.confidence_score !== "number" || !verdict.ruling_type) return null;
  if (verdict.confidence_score === 0 && (!verdict.reasoning_summary || FAILED_RUN.test(verdict.reasoning_summary))) return null;
  return verdict.confidence_score;
}

export const confidenceLabel = (c: number | null, t: Translator = tEn) => (c == null ? t("review.unavailable") : c.toFixed(2));

/** Escalation reasons quoting a 0.00 confidence come from failed Judge runs — don't present 0.00 as a score. */
export const reasonLabel = (r: string, t: Translator = tEn) => (/confidence \(0\.00\)/.test(r) ? t("review.reasonIncomplete") : r);

export const isReviewed = (r?: CaseResult | null) => {
  const s = r?.judge_verdict?.execution_payload?.execution_status;
  return s === "HUMAN_CONFIRMED" || s === "HUMAN_OVERRIDDEN";
};

/** What the AI recommended, in support-agent language. */
export function recommendationLabel(r?: CaseResult | null, t: Translator = tEn): string {
  const a = r?.judge_verdict?.recommended_action;
  if (!r?.judge_verdict) return t("review.judgeIncomplete");
  if (!a || a.action_type === "ESCALATED_NO_ACTION") return t("review.humanRequired");
  if (a.action_type === "CLEANING_FEE_CHARGE") return t("review.chargeFee", { amount: money(a.cleaning_fee_amount) });
  if (a.action_type === "FULL_REFUND" || a.action_type === "PARTIAL_REFUND") return `${typeLabel(a.action_type, t)} ${money(a.refund_amount)}`;
  return typeLabel(a.action_type, t);
}

/** Money movement implied by an action. Cleaning fee: rider → driver. Refund: Ryde → rider. */
export function moneyFlow(a?: RecommendedAction | null) {
  const cleaning = a?.action_type === "CLEANING_FEE_CHARGE" ? a.cleaning_fee_amount ?? 0 : 0;
  const refund = a?.action_type === "FULL_REFUND" || a?.action_type === "PARTIAL_REFUND" ? a.refund_amount ?? 0 : 0;
  return { cleaning, refund, moves: cleaning > 0 || refund > 0 };
}

/** Final action after human review: the human's modified action, or the AI's when confirmed as-is. */
export function finalAction(r?: CaseResult | null): RecommendedAction | null {
  const d = r?.judge_verdict?.execution_payload?.human_confirmation_details;
  if (!d) return null;
  if (d.modified_action) return d.modified_action;
  return d.approval_decision === "CONFIRMED_AUTO" ? r?.judge_verdict?.recommended_action ?? null : null;
}

export function decisionLabel(decision: HumanReviewDecision | undefined, action: RecommendedAction | null, cleaning: boolean, t: Translator = tEn): string {
  const f = moneyFlow(action);
  switch (decision) {
    case "CONFIRMED_AUTO":
      return t(cleaning && f.cleaning > 0 ? "review.d.feeApproved" : f.refund > 0 ? "review.d.refundApproved" : "review.d.confirmed");
    case "MODIFIED":
      return t(cleaning ? (f.cleaning > 0 ? "review.d.feeModified" : "review.d.feeNotCharged") : "review.d.modified");
    case "OVERRIDDEN":
      return t("review.d.overridden");
    case "REJECTED_AUTO":
      return t(cleaning ? "review.d.feeRejected" : "review.d.rejected");
    default:
      return t("review.d.completed");
  }
}

/** A "no money moves" action, sent with rejections so the stored final action is explicit. */
export const NO_ACTION = (currency = "SGD"): RecommendedAction => ({
  action_type: "NO_REFUND",
  refund_amount: 0,
  cleaning_fee_amount: 0,
  currency,
  penalty_target: "NONE",
  account_action: "NONE",
});

export interface PaymentResult {
  transaction_id: string;
  kind: "cleaning-fee" | "refund";
  amount: number;
}

/**
 * Executes the approved money movement through the existing mock Ryde Pay API — only called
 * AFTER the human decision was accepted by POST /api/disputes/{id}/human-review.
 * Returns null when the final action moves no money.
 */
export async function executeApprovedAction(r: CaseResult, action: RecommendedAction | null): Promise<PaymentResult | null> {
  const f = moneyFlow(action);
  if (!f.moves || !action) return null;
  const meta = r.case_metadata;
  const kind = f.cleaning > 0 ? "cleaning-fee" : "refund";
  const amount = f.cleaning > 0 ? f.cleaning : f.refund;
  const res = await fetch(backendUrl(`/api/mock-ryde-pay/${kind}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, currency: action.currency || "SGD", case_id: meta.case_id, rider_id: meta.rider_id, driver_id: meta.driver_id }),
  });
  if (!res.ok) throw new Error(`Payment execution failed (${res.status})`);
  const body = await res.json();
  return { transaction_id: body.transaction_id, kind, amount };
}

/** Teammate's describeAction wording in English; the same sentence built from dictionary keys otherwise. */
export function describeActionI18n(action: Record<string, unknown> | null | undefined, t: Translator, locale: Locale): string {
  if (locale === "en") return describeAction(action as Record<string, any> | null);
  if (!action || typeof action !== "object") return t("ra.none");
  const type = String(action.action_type ?? "").trim();
  const refund = Number(action.refund_amount ?? 0);
  const cleaning = Number(action.cleaning_fee_amount ?? 0);
  let out =
    type === "CLEANING_FEE_CHARGE"
      ? t("ra.cleaning", { amount: formatMoney(cleaning || undefined) })
      : type === "FULL_REFUND" || type === "PARTIAL_REFUND"
        ? t("ra.refund", { amount: formatMoney(refund || undefined) })
        : type === "NO_REFUND"
          ? t("ra.noRefund")
          : type === "PENALTY_ONLY"
            ? t("ra.penalty", { target: typeLabel(String(action.penalty_target || "RIDER"), t) })
            : !type || type === "ESCALATED_NO_ACTION"
              ? t("ra.none")
              : typeLabel(type, t);
  const acct = String(action.account_action ?? "").trim();
  if (acct && acct !== "NONE") out += `；${typeLabel(acct, t)}`;
  return out;
}
