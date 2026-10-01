"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCaseResult } from "@/src/lib/api";
import type { CaseResult } from "@/src/types";

export default function VerdictPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  const [caseData, setCaseData] = useState<CaseResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getCaseResult(caseId);
        setCaseData(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [caseId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#E84360] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-[15px] text-[#6B7280]">Case not found</p>
      </div>
    );
  }

  const verdict = caseData.judge_verdict;
  const fare = caseData.data_sources?.payment_fare_data;
  const policy = caseData.policy_consultation;
  const isEscalated = caseData.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW";
  const rulingType = verdict?.ruling_type || "ESCALATED";
  const action = verdict?.recommended_action;
  const hasRefund = (action?.refund_amount ?? 0) > 0;
  const originalFare = fare?.original_fare.total_fare ?? 0;
  const adjustedFare = originalFare - (action?.refund_amount ?? 0);
  const clauses = policy?.suggestion?.applicable_clauses || [];
  const appliedClauses = verdict?.policy_clauses_applied || [];
  const citedClauses = clauses.filter((c) => appliedClauses.includes(c.clause_id));

  const isApproved = rulingType === "APPROVED" || rulingType === "PARTIAL_REFUND";
  const isRejected = rulingType === "REJECTED";

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg border-b border-gray-100">
        <div className="relative flex items-center justify-center px-4 h-[44px]">
          <button
            onClick={() => router.push("/")}
            className="absolute left-3 flex items-center text-[17px] text-[#E84360]"
          >
            <svg className="w-6 h-6 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-[17px]">Back</span>
          </button>
          <h1 className="text-[17px] font-semibold text-[#111827]">Tribunal Verdict</h1>
        </div>
      </header>

      <div className="px-5 py-6 space-y-6 max-w-md mx-auto">
        {/* Verdict Card */}
        <div className="text-center pt-2">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
            style={{ backgroundColor: isApproved ? "#F0FDF4" : isRejected ? "#F9FAFB" : "#FFFBEB" }}
          >
            {isApproved ? (
              <svg className="w-8 h-8 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : isRejected ? (
              <svg className="w-8 h-8 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-[#D97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.218 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            )}
          </div>
          <p
            className="text-[13px] font-semibold uppercase tracking-wide mb-1"
            style={{ color: isApproved ? "#34C759" : isRejected ? "#6B7280" : "#D97706" }}
          >
            {isApproved ? "Approved" : isRejected ? "Rejected" : "Escalated"}
          </p>
          <h2 className="text-[24px] font-bold text-[#111827] leading-tight">
            {rulingType.replace(/_/g, " ")}
          </h2>
          <p className="text-[13px] text-[#6B7280] mt-1">
            AI Confidence: <span className="font-semibold text-[#111827]">{verdict ? Math.round(verdict.confidence_score * 100) : 0}%</span>
          </p>
        </div>

        {/* Settlement Details */}
        {hasRefund && action && (
          <div className="rounded-xl border border-gray-100 p-4 space-y-3">
            <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide">Settlement</p>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-[#6B7280]">Original Fare</span>
              <span className="text-[15px] text-[#111827] font-medium line-through">
                ${originalFare.toFixed(2)} {action.currency}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-[#6B7280]">Refund</span>
              <span className="text-[15px] font-semibold text-[#34C759]">
                -${action.refund_amount.toFixed(2)} {action.currency}
              </span>
            </div>
            <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
              <span className="text-[17px] font-bold text-[#111827]">Adjusted Fare</span>
              <span className="text-[22px] font-bold text-[#111827]">
                ${adjustedFare.toFixed(2)}
              </span>
            </div>
            <p className="text-[12px] text-[#6B7280] text-center">Refund credited to RydePay within 3-5 business days</p>
          </div>
        )}

        {/* Cited Policy */}
        {citedClauses.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Cited Policy</p>
            <div className="space-y-2">
              {citedClauses.map((clause) => (
                <div key={clause.clause_id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-[#FDF1F3] px-1.5 py-0.5 text-[10px] font-bold text-[#E84360]">
                      {clause.clause_id}
                    </span>
                    <span className="text-[14px] font-semibold text-[#111827]">{clause.clause_title}</span>
                  </div>
                  {clause.clause_text_summary && (
                    <p className="text-[12px] text-[#6B7280] leading-relaxed">{clause.clause_text_summary}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Judge Reasoning */}
        {verdict?.reasoning_summary && (
          <div>
            <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Judge's Reasoning</p>
            <p className="text-[14px] text-[#111827] leading-relaxed">{verdict.reasoning_summary}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <button
            onClick={() => router.push("/")}
            className="w-full py-3.5 rounded-xl bg-[#E84360] text-white text-[17px] font-semibold active:bg-[#DE3557] transition-colors"
          >
            Accept Settlement
          </button>
          <button
            onClick={() => router.push(`/review/${caseId}`)}
            className="w-full py-3.5 rounded-xl border border-gray-200 text-[#111827] text-[16px] font-medium active:bg-gray-50 transition-colors"
          >
            Request Human Review (Escalate)
          </button>
        </div>

        <p className="text-[12px] text-center text-[#9CA3AF] pt-1">
          You may appeal this decision within 7 days.
        </p>
      </div>
    </div>
  );
}
