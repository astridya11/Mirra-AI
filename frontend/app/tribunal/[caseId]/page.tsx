"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { streamPipeline, getCaseResult } from "@/src/lib/api";
import type {
  CaseResult,
  PipelineEvent,
  AgentConversationMessage,
} from "@/src/types";
import {
  AgentBadge,
  getAgentColor,
  getAgentInitials,
} from "@/src/components/AgentBadge";
import { LiveDot, TypingDots } from "@/src/components/TypingDots";

type StepStatus = "pending" | "active" | "completed";

type ProcessStep = {
  key: string;
  phase: string;
  label: string;
  status: StepStatus;
};

type FeedItem =
  | {
      type: "phase";
      id: string;
      eventType: "PHASE_STARTED" | "PHASE_COMPLETED";
      phase: string;
      label: string;
      data: Record<string, unknown>;
    }
  | {
      type: "conversation";
      id: string;
      phase: string;
      message: AgentConversationMessage;
    };

const STEP_DEFINITIONS: Array<{
  key: string;
  phase: string;
  fallbackLabel: string;
}> = [
  {
    key: "INIT_CLAIM",
    phase: "INIT_CLAIM",
    fallbackLabel: "Initializing & Evidence Frozen",
  },
  {
    key: "ROUND_1_PLEADINGS",
    phase: "ROUND_1_PLEADINGS",
    fallbackLabel: "Round 1: Advocate Pleadings",
  },
  {
    key: "ROUND_2_AUDIT",
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    fallbackLabel: "Prosecutor Evidence Audit & Fraud Screening",
  },
  {
    key: "ROUND_2_CROSS_EXAM",
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    fallbackLabel: "Cross-Examination & Prosecutor Report",
  },
  {
    key: "POLICY_CONSULTATION",
    phase: "POLICY_CONSULTATION",
    fallbackLabel: "Policy & Precedent Consultation",
  },
  {
    key: "JUDGE_DELIBERATION",
    phase: "JUDGE_DELIBERATION",
    fallbackLabel: "Judge Deliberation",
  },
  {
    key: "EXECUTION_ROUTER",
    phase: "EXECUTION_ROUTER",
    fallbackLabel: "Execution & Routing",
  },
];

function createInitialSteps(): ProcessStep[] {
  return STEP_DEFINITIONS.map((definition) => ({
    key: definition.key,
    phase: definition.phase,
    label: definition.fallbackLabel,
    status: "pending",
  }));
}

function isAgentConversation(event: PipelineEvent): boolean {
  return (
    event.event_type === "AGENT_CONVERSATION" ||
    event.label === "AGENT_CONVERSATION"
  );
}

function getStepKey(phase: string, label?: string): string | null {
  if (phase === "INIT_CLAIM") return "INIT_CLAIM";
  if (phase === "ROUND_1_PLEADINGS") return "ROUND_1_PLEADINGS";
  if (phase === "ROUND_2_PROSECUTOR_AUDIT") {
    if (
      label?.startsWith("3a.") ||
      label?.includes("初始证据审计") ||
      label?.includes("欺诈筛查")
    ) {
      return "ROUND_2_AUDIT";
    }
    if (
      label?.startsWith("3b.") ||
      label?.includes("第二轮调查") ||
      label?.includes("交叉质询")
    ) {
      return "ROUND_2_CROSS_EXAM";
    }
    return "ROUND_2_AUDIT";
  }
  if (phase === "POLICY_CONSULTATION") return "POLICY_CONSULTATION";
  if (phase === "JUDGE_DELIBERATION") return "JUDGE_DELIBERATION";
  if (phase === "EXECUTION_ROUTER") return "EXECUTION_ROUTER";
  return null;
}

function makeFeedId(event: PipelineEvent, index: number): string {
  return [event.event_type, event.phase, event.label ?? "", index].join(":");
}

export default function TribunalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <TribunalContent />
    </Suspense>
  );
}

function TribunalContent() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  const [steps, setSteps] = useState<ProcessStep[]>(createInitialSteps);
  const [, setConversations] = useState<AgentConversationMessage[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [complete, setComplete] = useState(false);
  const [finalResult, setFinalResult] = useState<CaseResult | null>(null);
  const [caseData, setCaseData] = useState<CaseResult | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const feedIndexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getCaseResult(caseId);
        if (!cancelled) setCaseData(data);
      } catch {
        // Fallback silently if unavailable
      }
    }
    if (caseId) load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    setSteps(createInitialSteps());
    setConversations([]);
    setFeed([]);
    setActiveStepKey(null);
    setIsStreaming(true);
    setComplete(false);
    setFinalResult(null);
    feedIndexRef.current = 0;
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;

    const cleanup = streamPipeline(caseId, {
      onEvent: (event: PipelineEvent) => {
        const eventType = event.event_type;

        if (isAgentConversation(event)) {
          const conv = event.data as unknown as AgentConversationMessage;
          if (!conv || typeof conv !== "object") return;

          setConversations((prev) => {
            if (prev.some((item) => item.message_id === conv.message_id)) return prev;
            return [...prev, conv];
          });

          const feedId = makeFeedId(event, feedIndexRef.current++);
          setFeed((prev) => [
            ...prev,
            {
              type: "conversation",
              id: feedId,
              phase: event.phase,
              message: conv,
            },
          ]);
          return;
        }

        if (eventType !== "PHASE_STARTED" && eventType !== "PHASE_COMPLETED") return;

        const label = event.label || event.phase;
        const stepKey = getStepKey(event.phase, label);

        setFeed((prev) => [
          ...prev,
          {
            type: "phase",
            id: makeFeedId(event, feedIndexRef.current++),
            eventType,
            phase: event.phase,
            label,
            data: (event.data ?? {}) as Record<string, unknown>,
          },
        ]);

        if (!stepKey) return;

        if (eventType === "PHASE_STARTED") {
          setActiveStepKey(stepKey);
          setSteps((prev) =>
            prev.map((step) => {
              if (step.key === stepKey) {
                return { ...step, label, status: "active" };
              }
              if (step.status === "active") {
                return { ...step, status: "completed" };
              }
              return step;
            })
          );
          return;
        }

        setSteps((prev) =>
          prev.map((step) =>
            step.key === stepKey ? { ...step, label, status: "completed" } : step
          )
        );
        setActiveStepKey((current) => (current === stepKey ? null : current));
      },

      onComplete: (result) => {
        setIsStreaming(false);
        setComplete(true);
        setFinalResult(result);

        setSteps((prev) =>
          prev.map((step) =>
            step.status === "active" ? { ...step, status: "completed" } : step
          )
        );
        setActiveStepKey(null);
      },

      onError: () => {
        setIsStreaming(false);
      },
    });

    return cleanup;
  }, [caseId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [feed]);

  const handleViewVerdict = () => {
    router.push(`/verdict/${caseId}`);
  };

  const profiles = caseData?.data_sources?.historical_profiles || [];
  const rider = profiles.find((p) => p.party === "RIDER");
  const driver = profiles.find((p) => p.party === "DRIVER");

  const activeStep = steps.find((step) => step.key === activeStepKey);
  const latestCompletedStep = [...steps].reverse().find((step) => step.status === "completed");
  const headerLabel = activeStep?.label || latestCompletedStep?.label || "Initializing";

  return (
    <div className="flex flex-col h-screen bg-[#F9FAFB] text-[#111827]">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
        <div className="relative flex items-center justify-between px-4 h-[44px]">
          <button
            onClick={() => router.push("/")}
            className="flex items-center text-[16px] font-normal text-[#E84360] active:opacity-60 transition-opacity"
          >
            <svg className="w-5 h-5 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="text-center">
            <h1 className="text-[16px] font-semibold tracking-tight text-[#111827]">
              AI Tribunal
            </h1>
          </div>

          <div className="w-12 text-right">
            {isStreaming && <LiveDot color="#E84360" />}
          </div>
        </div>

        {/* Progress Line */}
        <div className="px-4 pb-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] font-medium text-[#6B7280] truncate max-w-[80%]">
              {headerLabel}
            </span>
            <span className="text-[11px] text-[#9CA3AF] tracking-tight">{caseId}</span>
          </div>

          <div className="flex gap-1 h-[2px]">
            {steps.map((step) => (
              <div
                key={step.key}
                className={`flex-1 rounded-full transition-colors duration-300 ${
                  step.status === "active"
                    ? "bg-[#E84360]"
                    : step.status === "completed"
                    ? "bg-[#E84360]/30"
                    : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Feed Container */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {rider && driver && (
          <div className="flex items-center justify-center gap-3 py-1 text-[12px] text-[#6B7280]">
            <span className="font-medium text-[#111827]">{rider.name} (Rider)</span>
            <span className="text-gray-300">•</span>
            <span className="font-medium text-[#111827]">{driver.name} (Driver)</span>
          </div>
        )}

        {/* Feed Items */}
        {feed.map((item) => {
          if (item.type === "conversation") {
            return <AgentMessage key={item.id} conv={item.message} />;
          }
          return (
            <PhaseFeedItem
              key={item.id}
              eventType={item.eventType}
              phase={item.phase}
              label={item.label}
              data={item.data}
            />
          );
        })}

        {isStreaming && (
          <div className="flex items-center justify-center gap-2 py-2">
            <TypingDots />
            <span className="text-[12px] text-[#9CA3AF] font-normal">
              Tribunal Deliberating...
            </span>
          </div>
        )}

        {complete && finalResult && (
          <div className="pt-4 pb-6 flex justify-center animate-fade-in">
            <button
              onClick={handleViewVerdict}
              className="w-full max-w-xs bg-[#E84360] hover:bg-[#DE3557] active:scale-[0.98] text-white py-3.5 rounded-full font-semibold text-[15px] shadow-sm transition-all"
            >
              View Official Verdict
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================
   Phase Lifecycle Event Card (Support Special Policy Render)
   ====================================================================== */

function PhaseFeedItem({
  eventType,
  phase,
  label,
  data,
}: {
  eventType: "PHASE_STARTED" | "PHASE_COMPLETED";
  phase: string;
  label: string;
  data?: Record<string, unknown>;
}) {
  const started = eventType === "PHASE_STARTED";

  // Special card view for POLICY_CONSULTATION completion
  if (!started && phase === "POLICY_CONSULTATION" && data) {
    const suggestion = (data.suggestion || (data.policy_consultation as any)?.suggestion) as any;
    const clauses = suggestion?.applicable_clauses || [];
    const precedents = suggestion?.matching_precedents || [];

    return (
      <div className="my-3 mx-auto max-w-md bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm space-y-2">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-[12px] font-semibold text-slate-800">
              Policy & Precedent Consultation
            </span>
          </div>
          <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
            Completed
          </span>
        </div>

        {clauses.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-slate-500">Applicable Policy Clauses:</p>
            <div className="flex flex-wrap gap-1">
              {clauses.map((c: any, i: number) => (
                <span key={i} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  {c.clause_id || c.title || `Clause ${i + 1}`}
                </span>
              ))}
            </div>
          </div>
        )}

        {precedents.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-slate-500">Matching Precedents:</p>
            <ul className="text-[11px] text-slate-600 list-disc list-inside space-y-0.5">
              {precedents.slice(0, 2).map((p: any, i: number) => (
                <li key={i} className="truncate">
                  {p.case_id || p.title}: {p.summary || p.outcome}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-center my-2">
      <span className="text-[11px] font-normal text-[#9CA3AF] tracking-tight text-center px-3">
        {started ? `• ${label}` : `✓ ${label}`}
      </span>
    </div>
  );
}

/* ======================================================================
   Agent Conversation Message Component
   ====================================================================== */

function AgentMessage({ conv }: { conv: AgentConversationMessage }) {
  const speaker = conv.speaker || "AGENT";
  const isDriver = speaker.includes("DRIVER");
  const isProsecutor = speaker.includes("PROSECUTOR");

  const alignRight = isDriver;
  const color = getAgentColor(speaker);
  const initials = getAgentInitials(speaker);

  const isQuestion = conv.message_type === "QUESTION";
  const isProsecutorQuestion = isProsecutor && isQuestion;

  const output =
    conv.agent_output && typeof conv.agent_output === "object"
      ? (conv.agent_output as Record<string, unknown>)
      : {};

  const evidenceRefs = Array.isArray(output.evidence_references)
    ? (output.evidence_references as Array<Record<string, string>>)
    : [];

  const requestedAmount =
    typeof output.requested_amount === "number" ? output.requested_amount : undefined;
  const requestedOutcome =
    typeof output.requested_outcome === "string" ? output.requested_outcome : undefined;
  const fraudScore =
    typeof output.fraud_risk_score === "number" ? output.fraud_risk_score : undefined;

  // Multi-level fallback mechanism for content extraction
  const content = conv.content || getFallbackContent(output) || "Awaiting response...";

  /* Prosecutor System Question Bar */
  if (isProsecutorQuestion) {
    return (
      <div className="flex justify-center my-3">
        <div className="max-w-[90%] bg-amber-50/80 rounded-xl p-3 border border-amber-200/40 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <AgentBadge role="PROSECUTOR" />
            <span className="text-[10px] text-amber-700 font-medium">
              → {conv.target?.replace("_ADVOCATE", "") || "ADVOCATE"}
            </span>
          </div>
          <p className="text-[13px] text-[#111827] leading-snug">{content}</p>
        </div>
      </div>
    );
  }

  /* Standard Agent Message Bubble */
  return (
    <div className={`flex items-end gap-2 my-1 ${alignRight ? "flex-row-reverse" : ""}`}>
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mb-0.5"
        style={{
          backgroundColor: `${color}15`,
          color,
        }}
      >
        {initials}
      </div>

      <div className={`max-w-[78%] ${alignRight ? "items-end" : ""}`}>
        <div className={`flex items-center gap-1 mb-1 ${alignRight ? "justify-end" : ""}`}>
          <AgentBadge role={speaker} />
        </div>

        <div
          className={`px-3.5 py-2.5 text-[14px] leading-relaxed rounded-2xl ${
            alignRight
              ? "bg-[#E84360] text-white rounded-br-sm"
              : "bg-white text-[#111827] border border-gray-100/80 rounded-bl-sm"
          }`}
        >
          {content}
        </div>

        {evidenceRefs.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${alignRight ? "justify-end" : ""}`}>
            {evidenceRefs.map((ev, index) => (
              <span
                key={ev.evidence_id || `${index}`}
                className="inline-block rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-[#6B7280]"
              >
                {ev.evidence_id || "Evidence"}
              </span>
            ))}
          </div>
        )}

        {requestedOutcome && (
          <p className={`text-[10px] text-[#6B7280] mt-1 ${alignRight ? "text-right" : ""}`}>
            Requested: {requestedOutcome.replace(/_/g, " ")}
            {requestedAmount !== undefined ? ` · $${requestedAmount.toFixed(2)}` : ""}
          </p>
        )}

        {fraudScore !== undefined && (
          <div className="mt-1 flex items-center gap-1.5 max-w-[120px]">
            <span className="text-[9px] text-[#9CA3AF]">Fraud Risk</span>
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(1, fraudScore)) * 100}%`,
                  backgroundColor:
                    fraudScore >= 0.7 ? "#EF4444" : fraudScore >= 0.4 ? "#F59E0B" : "#10B981",
                }}
              />
            </div>
            <span className="text-[9px] font-medium text-[#6B7280]">
              {Math.round(fraudScore * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Enhanced Fallback Extractor:
 * Comprehensive property checking for Agent outputs
 */
function getFallbackContent(output: Record<string, unknown>): string {
  if (!output || typeof output !== "object") return "";

  const candidates = [
    output.content,
    output.message,
    output.statement_text,
    output.response_text,
    output.response,
    output.question_text,
    output.question,
    output.pleading,
    output.text,
    output.summary,
    output.reasoning,
  ];

  const value = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
  );

  if (value) return value;

  // Fallback for nested details / statement objects
  if (output.statement && typeof output.statement === "object") {
    return getFallbackContent(output.statement as Record<string, unknown>);
  }

  return "";
}