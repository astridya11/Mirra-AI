"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCompletedResult } from "@/src/lib/api";
import type { ActionType, RecommendedAction, HumanReviewDecision } from "@/src/types";
import {
  ApiError,
  getCase,
  resolveCase,
  submitHumanReview,
  type ReviewCase,
} from "@/src/lib/api";
import { describeAction, formatMoney } from "@/src/lib/reviewFormat";

// Form state for RecommendedAction (numbers are kept as strings while typing)
interface ActionForm {
  action_type: string;
  refund_amount: string;
  currency: string;
  cleaning_fee_amount: string;
  penalty_target: string;
  account_action: string;
}

const EMPTY_ACTION: ActionForm = {
  action_type: "",
  refund_amount: "0",
  currency: "SGD",
  cleaning_fee_amount: "",
  penalty_target: "",
  account_action: "",
};

const DECISIONS: {
  value: HumanReviewDecision;
  title: string;
  desc: string;
  needsReason: boolean;
}[] = [
  {
    value: "CONFIRMED_AUTO",
    title: "Confirm AI ruling",
    desc: "The Judge's recommendation is correct. Apply it as is.",
    needsReason: false,
  },
  {
    value: "MODIFIED",
    title: "Modify AI ruling",
    desc: "Keep the ruling but adjust the action, for example the refund amount.",
    needsReason: true,
  },
  {
    value: "OVERRIDDEN",
    title: "Override AI ruling",
    desc: "Replace the AI ruling with your own decision.",
    needsReason: true,
  },
  {
    value: "REJECTED_AUTO",
    title: "Reject AI ruling",
    desc: "Do not apply the AI ruling.",
    needsReason: true,
  },
];

/**
 * Decision rail for frontend/app/review/[caseId]/page.tsx.
 * Shows the AI recommendation, amount at stake, queue score, and opens a form
 * to submit the human review. After a successful review the reviewer lands on
 * the next highest-priority case.
 */
export default function ReviewSlaPanel({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [c, setC] = useState<ReviewCase | null>(null);
  const [open, setOpen] = useState(false);
  const [recommendedAction, setRecommendedAction] = useState<Record<string, any> | null>(null);

  // form state
  const [decision, setDecision] = useState<HumanReviewDecision>("CONFIRMED_AUTO");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<ActionForm>(EMPTY_ACTION);
  const setActionField = (k: keyof ActionForm, v: string) =>
    setAction((a) => ({ ...a, [k]: v }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    const load = () =>
      getCase(caseId)
        .then((d) => alive && setC(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [caseId]);

  // Fetch getCompletedResult once on mount and reuse it to prefill the dialog.
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    getCompletedResult(caseId)
      .then((result) => {
        if (!alive) return;
        const verdict = result?.judge_verdict;
        const current =
          (verdict?.recommended_action as Record<string, any> | undefined) ??
          (verdict?.execution_payload as Record<string, any> | undefined);
        if (current && typeof current === "object") {
          setRecommendedAction(current);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [caseId]);

  // Close the dialog with Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting]);

  const openDialog = (initialDecision: HumanReviewDecision) => {
    setDecision(initialDecision);
    setReason("");
    setNotes("");
    setError(null);
    // Prefill the editable action with the cached recommendation.
    const current = recommendedAction;
    if (current && typeof current === "object") {
      setAction({
        action_type: String(current.action_type ?? ""),
        refund_amount: String(current.refund_amount ?? 0),
        currency: String(current.currency ?? EMPTY_ACTION.currency),
        cleaning_fee_amount:
          current.cleaning_fee_amount != null ? String(current.cleaning_fee_amount) : "",
        penalty_target: String(current.penalty_target ?? ""),
        account_action: String(current.account_action ?? ""),
      });
    } else {
      setAction(EMPTY_ACTION);
    }
    setOpen(true);
  };

  const submit = async () => {
    if (!c?.support) return;
    setError(null);

    const chosen = DECISIONS.find((d) => d.value === decision)!;
    if (chosen.needsReason && !reason.trim()) {
      setError("Add a reason for this decision.");
      return;
    }

    let modified: RecommendedAction | null = null;
    if (decision === "MODIFIED") {
      const refund = Number(action.refund_amount);
      const hasCleaning = action.cleaning_fee_amount.trim() !== "";
      const cleaning = Number(action.cleaning_fee_amount);
      if (!action.action_type.trim() || !action.currency.trim()) {
        setError("Action type and currency are required.");
        return;
      }
      if (action.refund_amount.trim() === "" || !Number.isFinite(refund) || refund < 0) {
        setError("Refund amount must be a number, 0 or more.");
        return;
      }
      if (hasCleaning && (!Number.isFinite(cleaning) || cleaning < 0)) {
        setError("Cleaning fee must be a number, 0 or more.");
        return;
      }
      modified = {
        action_type: action.action_type.trim() as ActionType,
        refund_amount: refund,
        currency: action.currency.trim(),
        ...(hasCleaning ? { cleaning_fee_amount: cleaning } : {}),
        ...(action.penalty_target.trim() ? { penalty_target: action.penalty_target.trim() } : {}),
        ...(action.account_action.trim() ? { account_action: action.account_action.trim() } : {}),
      };
    }

    setSubmitting(true);
    try {
      await submitHumanReview(caseId, {
        reviewer_id: c.support.id,
        reviewer_name: c.support.name,
        approval_decision: decision,
        override_reason: chosen.needsReason ? reason.trim() : "",
        modified_action: modified,
        review_notes: notes.trim(),
      });
    } catch (e) {
      // 409 means the case was already reviewed: treat as done and move on.
      if (!(e instanceof ApiError && e.status === 409)) {
        setError(e instanceof Error ? e.message : "Could not submit the review.");
        setSubmitting(false);
        return;
      }
    }

    // Mark done in the priority queue and open the next case.
    let next: string | null = null;
    try {
      next = (await resolveCase(caseId)).next_case_id;
    } catch {
      /* queue will catch up on its next refresh */
    }
    router.push(next ? `/review/${next}` : "/review");
  };

  if (!c) return null;
  const resolved = c.status === "RESOLVED";
  const needsReason = DECISIONS.find((d) => d.value === decision)!.needsReason;

  // Primary button text matches the decision.
  const primaryButtonText = (() => {
    switch (decision) {
      case "CONFIRMED_AUTO":
        return "Confirm AI ruling";
      case "MODIFIED":
        return "Save modified ruling";
      case "OVERRIDDEN":
        return "Override ruling";
      case "REJECTED_AUTO":
        return "Reject AI ruling";
      default:
        return "Submit review";
    }
  })();

  return (
    <>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-4">
        {/* AI recommendation */}
        <div className="space-y-0.5">
          <p className="text-[12px] text-[#6B7280]">AI recommends</p>
          <p className="text-[16px] font-semibold text-[#1F2937] leading-snug">
            {describeAction(recommendedAction)}
          </p>
        </div>

        {/* Small definition list */}
        <dl className="text-[14px] space-y-1">
          <div className="flex justify-between">
            <dt className="text-[#6B7280]">Amount at stake</dt>
            <dd className="font-medium text-[#1F2937] tabular-nums">
              {c.value_source === "mock" ? (
                <span title="Amount not recorded">&mdash;</span>
              ) : (
                formatMoney(c.dispute_value)
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#6B7280]">Queue score</dt>
            <dd className="font-medium text-[#1F2937] tabular-nums">{c.priority_score}</dd>
          </div>
        </dl>

        {resolved ? (
          <div className="text-[14px] text-[#6B7280] space-y-0.5">
            <p>Reviewed by {c.resolved_by ?? "support"}</p>
            {c.resolved_at && (
              <p className="text-[12px] text-[#9CA3AF] tabular-nums">
                {new Date(c.resolved_at).toLocaleString()}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => openDialog("CONFIRMED_AUTO")}
              className="w-full rounded-lg bg-[#E84360] px-3 py-2 text-[14px] font-medium text-white hover:opacity-90"
            >
              Confirm AI ruling
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => openDialog("MODIFIED")}
                className="rounded-lg border border-[#E5E7EB] px-2 py-2 text-[12px] font-medium text-[#6B7280] hover:bg-gray-100"
              >
                Modify
              </button>
              <button
                onClick={() => openDialog("OVERRIDDEN")}
                className="rounded-lg border border-[#E5E7EB] px-2 py-2 text-[12px] font-medium text-[#6B7280] hover:bg-gray-100"
              >
                Override
              </button>
              <button
                onClick={() => openDialog("REJECTED_AUTO")}
                className="rounded-lg border border-[#E5E7EB] px-2 py-2 text-[12px] font-medium text-[#6B7280] hover:bg-gray-100"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-5"
          >
            <div>
              <h2 id="review-title" className="text-[20px] font-semibold text-[#1F2937]">
                Review {caseId}
              </h2>
              <p className="text-[14px] text-[#6B7280]">
                Reviewing as {c.support?.name ?? "support"}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[14px] font-medium text-[#1F2937] mb-2">Your decision</legend>
              {DECISIONS.map((d) => (
                <label
                  key={d.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    decision === d.value
                      ? "border-[#E84360] bg-[#E84360]/5"
                      : "border-[#E5E7EB] hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value={d.value}
                    checked={decision === d.value}
                    onChange={() => {
                      setDecision(d.value);
                      setError(null);
                    }}
                    className="mt-1 accent-[#E84360]"
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-[#1F2937]">{d.title}</span>
                    <span className="block text-[14px] text-[#6B7280]">{d.desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {(decision === "MODIFIED" || decision === "OVERRIDDEN") && (
              <fieldset className="space-y-3">
                <legend className="text-[14px] font-medium text-[#1F2937] mb-2">Modified action</legend>
                <div className="grid grid-cols-2 gap-3">
                  <ActionField id="action-type" label="Action type" value={action.action_type}
                    onChange={(v) => setActionField("action_type", v)} />
                  <ActionField id="currency" label="Currency" value={action.currency}
                    onChange={(v) => setActionField("currency", v)} />
                  <ActionField id="refund-amount" label="Refund amount" type="number" value={action.refund_amount}
                    onChange={(v) => setActionField("refund_amount", v)} />
                  <ActionField id="cleaning-fee" label="Cleaning fee (optional)" type="number" value={action.cleaning_fee_amount}
                    onChange={(v) => setActionField("cleaning_fee_amount", v)} />
                  <ActionField id="penalty-target" label="Penalty target (optional)" value={action.penalty_target}
                    onChange={(v) => setActionField("penalty_target", v)} />
                  <ActionField id="account-action" label="Account action (optional)" value={action.account_action}
                    onChange={(v) => setActionField("account_action", v)} />
                </div>
              </fieldset>
            )}

            {needsReason && (
              <div className="space-y-1">
                <label htmlFor="reason" className="text-[14px] font-medium text-[#1F2937]">
                  Reason (required)
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why are you changing the AI ruling?"
                  className="w-full rounded-lg border border-[#E5E7EB] p-3 text-[14px] text-[#1F2937] focus:border-[#E84360] focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="notes" className="text-[14px] font-medium text-[#1F2937]">
                Notes (optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[#E5E7EB] p-3 text-[14px] text-[#1F2937] focus:border-[#E84360] focus:outline-none"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[14px] text-red-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-[14px] text-[#6B7280] hover:bg-gray-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="rounded-lg bg-[#E84360] px-4 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? "Submitting\u2026" : primaryButtonText}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function ActionField({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[14px] text-[#6B7280]">
        {label}
      </label>
      <input
        id={id}
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] text-[#1F2937] focus:border-[#E84360] focus:outline-none"
      />
    </div>
  );
}
