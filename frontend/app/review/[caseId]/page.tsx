"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCaseResult, submitHumanReview } from "@/src/lib/api";
import type { CaseResult, HumanReviewRequest } from "@/src/types";

type Decision = "CONFIRMED_AUTO" | "MODIFIED" | "OVERRIDDEN";

export default function HumanReviewPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  const [caseData, setCaseData] = useState<CaseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [modifiedAmount, setModifiedAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getCaseResult(caseId);
        setCaseData(data);
        const action = data.judge_verdict?.recommended_action;
        if (action) setModifiedAmount(action.refund_amount.toString());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [caseId]);

  const handleSubmit = async () => {
    if (!decision) return;
    setSubmitting(true);
    try {
      const review: HumanReviewRequest = {
        reviewer_id: "REV-001",
        reviewer_name: "Support Agent",
        approval_decision: decision,
        override_reason: notes,
        modified_action:
          decision === "MODIFIED"
            ? {
                action_type: "PARTIAL_REFUND",
                refund_amount: parseFloat(modifiedAmount) || 0,
                cleaning_fee_amount: 0,
                currency: "SGD",
                penalty_target: "NONE",
                account_action: "NONE",
              }
            : null,
        review_notes: notes,
      };
      await submitHumanReview(caseId, review);
      setResult("Review submitted successfully.");
      setTimeout(() => router.push(`/verdict/${caseId}`), 2000);
    } catch {
      setResult("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

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
  const prosecutor = caseData.prosecutor_findings;
  const bonus = caseData.bonus_modules;
  const escalation = bonus?.escalation_protocol;
  const profiles = caseData.data_sources?.historical_profiles || [];
  const rider = profiles.find((p) => p.party === "RIDER");
  const driver = profiles.find((p) => p.party === "DRIVER");
  const fare = caseData.data_sources?.payment_fare_data;
  const trip = caseData.data_sources?.trip_data;
  const action = verdict?.recommended_action;
  const verifiedFacts = prosecutor?.verified_facts || [];
  const disputedFacts = prosecutor?.disputed_facts || [];

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg border-b border-gray-100">
        <div className="relative flex items-center justify-center px-4 h-[44px]">
          <button
            onClick={() => router.push(`/verdict/${caseId}`)}
            className="absolute left-3 flex items-center text-[17px] text-[#E84360]"
          >
            <svg className="w-6 h-6 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-[17px]">Back</span>
          </button>
          <h1 className="text-[17px] font-semibold text-[#111827]">Human Review</h1>
        </div>
      </header>

      {/* Escalation Banner */}
      <div className="bg-[#FFFBEB] border-b border-[#FDE68A]/30">
        <div className="max-w-2xl mx-auto px-5 py-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#D97706] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.218 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p className="text-[14px] font-semibold text-[#D97706]">Case Escalated to Ryde Human Specialist</p>
          </div>
          {escalation?.escalation_reasons && escalation.escalation_reasons.length > 0 && (
            <div className="mt-2 ml-7 space-y-0.5">
              {escalation.escalation_reasons.map((reason, i) => (
                <p key={i} className="text-[12px] text-[#D97706]">• {reason}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">
        {/* Trip Details */}
        {trip && (
          <Section title="Trip Details">
            <DetailRow label="Trip ID" value={trip.trip_id} />
            <DetailRow label="Route" value={`${trip.pickup_location.name} → ${trip.dropoff_location.name}`} />
            {trip.scheduled_time && <DetailRow label="Date" value={new Date(trip.scheduled_time).toLocaleString()} />}
            {rider && <DetailRow label="Rider" value={rider.name || "Unknown"} />}
            {driver && <DetailRow label="Driver" value={driver.name || "Unknown"} />}
            {fare && <DetailRow label="Disputed Amount" value={`$${fare.disputed_amount.toFixed(2)} ${fare.disputed_amount_currency}`} />}
          </Section>
        )}

        {/* Frozen Evidence Summary */}
        {verifiedFacts.length > 0 && (
          <Section title="Frozen Evidence — Verified Facts">
            {verifiedFacts.map((fact, i) => (
              <div key={fact.fact_id} className={`py-2.5 ${i < verifiedFacts.length - 1 ? "border-b border-gray-100" : ""}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-mono font-bold text-[#34C759]">{fact.fact_id}</span>
                  {fact.confidence_level !== undefined && (
                    <span className="text-[10px] text-[#9CA3AF]">{Math.round(fact.confidence_level * 100)}%</span>
                  )}
                </div>
                <p className="text-[13px] text-[#111827]">{fact.description}</p>
              </div>
            ))}
          </Section>
        )}

        {disputedFacts.length > 0 && (
          <Section title="Disputed Points">
            {disputedFacts.map((fact, i) => (
              <div key={fact.fact_id} className={`py-2.5 ${i < disputedFacts.length - 1 ? "border-b border-gray-100" : ""}`}>
                <span className="text-[11px] font-mono font-bold text-[#D97706]">{fact.fact_id}</span>
                <p className="text-[13px] text-[#111827] mt-0.5">{fact.description}</p>
              </div>
            ))}
          </Section>
        )}

        {/* AI Judge Recommendation */}
        {verdict && (
          <Section title="AI Judge Recommendation">
            <div className="flex items-center justify-between py-1">
              <span className="text-[14px] text-[#6B7280]">Ruling</span>
              <span className="text-[15px] font-semibold text-[#111827]">{verdict.ruling_type.replace(/_/g, " ")}</span>
            </div>
            <DetailRow label="Confidence" value={`${Math.round(verdict.confidence_score * 100)}%`} />
            {action && (
              <>
                <DetailRow label="Action" value={action.action_type.replace(/_/g, " ")} />
                {action.refund_amount > 0 && (
                  <DetailRow label="Refund" value={`$${action.refund_amount.toFixed(2)} ${action.currency}`} />
                )}
              </>
            )}
            {verdict.reasoning_summary && (
              <p className="text-[13px] text-[#6B7280] leading-relaxed mt-2 pt-2 border-t border-gray-100">
                {verdict.reasoning_summary}
              </p>
            )}
          </Section>
        )}

        {/* Human Decision Panel */}
        <Section title="Human Decision">
          <div className="space-y-2 pt-1">
            <DecisionButton
              selected={decision === "CONFIRMED_AUTO"}
              onClick={() => setDecision("CONFIRMED_AUTO")}
              label="Approve AI Ruling"
              color="#34C759"
            />
            <DecisionButton
              selected={decision === "MODIFIED"}
              onClick={() => setDecision("MODIFIED")}
              label="Override Settlement Amount"
              color="#E84360"
            />
            <DecisionButton
              selected={decision === "OVERRIDDEN"}
              onClick={() => setDecision("OVERRIDDEN")}
              label="Dismiss & Close Case"
              color="#6B7280"
            />
          </div>

          {decision === "MODIFIED" && (
            <div className="mt-3 animate-fade-in">
              <label className="text-[13px] text-[#6B7280] block mb-1">Modified Refund Amount (SGD)</label>
              <input
                type="number"
                step="0.01"
                value={modifiedAmount}
                onChange={(e) => setModifiedAmount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-[#E84360]"
              />
            </div>
          )}

          <div className="mt-3">
            <label className="text-[13px] text-[#6B7280] block mb-1">Agent Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Review notes and override reason..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-[#E84360] resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!decision || submitting}
            className="w-full mt-3 py-3 rounded-xl bg-[#E84360] text-white text-[16px] font-semibold disabled:bg-gray-200 disabled:text-gray-400 active:bg-[#DE3557] transition-colors"
          >
            {submitting ? "Submitting..." : "Submit Review"}
          </button>

          {result && (
            <p className="mt-2 text-center text-[13px] text-[#34C759] animate-fade-in">{result}</p>
          )}
        </Section>

        <div className="h-6" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">{title}</p>
      <div>{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[14px] text-[#6B7280]">{label}</span>
      <span className="text-[14px] text-[#111827] font-medium text-right">{value}</span>
    </div>
  );
}

function DecisionButton({
  selected,
  onClick,
  label,
  color,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border-2 p-3 transition-all"
      style={{
        borderColor: selected ? color : "#E5E7EB",
        backgroundColor: selected ? `${color}08` : "transparent",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
          style={{ borderColor: selected ? color : "#D1D5DB" }}
        >
          {selected && (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          )}
        </div>
        <span className="text-[15px] font-medium text-[#111827]">{label}</span>
      </div>
    </button>
  );
}
