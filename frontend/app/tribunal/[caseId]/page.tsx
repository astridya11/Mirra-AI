"use client";

/**
 * Optimized Tribunal Process Page (User-Facing)
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamPipeline, getCompletedResult } from "@/src/lib/api";
import type { PipelineEvent } from "@/src/types";
import { useParams, useSearchParams } from "next/navigation";
import { VerdictButton } from "@/src/components/tribunal/VerdictButton";
import { ChatBubble, ChatMessage, TypingBubble, TypingConfig } from "@/src/components/tribunal/ChatBubble";
// import { ScrollToLatest } from "@/src/components/tribunal/ScrollToLatest";
import { IOSHeader } from "@/src/components/IOSHeader";
import { DebugProcessView } from "./DebugProcessView";

// ==========================================
// Types & Interfaces
// ==========================================

type FeedEvent = PipelineEvent & {
  sub_phase?: string;
  speaker?: string;
  message_type?: string;
  data?: any;
  payload?: any;
};

type BubbleSide = "left" | "right";

type Rec = Record<string, unknown>;

// ==========================================
// Dashed Progress Stepper Component
// ==========================================

const STEPS = [
  { id: "INIT_CLAIM", name: "Dispute Filed" },
  { id: "ROUND_1_PLEADINGS", name: "Round 1 Pleadings" },
  { id: "ROUND_2_AUDIT", name: "Evidence Audit & Fraud Screening" },
  { id: "ROUND_2_CROSS_EXAM", name: "Cross Examination" },
  { id: "ROUND_2_REPORT", name: "Final Audit Report" },
  { id: "POLICY_CONSULTATION", name: "Policy & Precedent Research" },
  { id: "JUDGE_DELIBERATION", name: "Judge Deliberation" },
  { id: "EXECUTION_ROUTER", name: "Execution Router" },
];

function DashedProgressStepper({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <div className="w-full bg-white px-4 py-3 border-b border-gray-100">
      <div className="max-w-[560px] mx-auto">
        {/* 节点与连接线容器 */}
        <div className="relative flex items-center justify-between w-full px-2">
          {STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            const isFinishedOrCurrent = idx <= currentStepIndex;
            const isLast = idx === STEPS.length - 1;

            return (
              <div key={step.id} className={`flex items-center ${!isLast ? "flex-1" : ""}`}>
                {/* 1. 圆形数字节点 */}
                <div
                  className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-medium transition-all duration-300 z-10 flex-shrink-0 ${
                    isFinishedOrCurrent
                      ? "bg-slate-900 text-white"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {idx + 1}
                </div>

                {/* 2. 节点间的连接线 */}
                {!isLast && (
                  <div
                    className={`h-[1px] w-full transition-all duration-300 ${
                      isCompleted ? "bg-slate-900" : "bg-gray-100"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* 底部阶段文字描述 */}
        <div className="flex justify-center items-center mt-2.5 px-1">
          {/* <span className="text-[11px] font-medium text-slate-400">
            Stage {Math.min(currentStepIndex + 1, STEPS.length)} / {STEPS.length}
          </span> */}
          <span className="text-[11px] font-semibold text-slate-800">
            {STEPS[Math.min(currentStepIndex, STEPS.length - 1)]?.name}
          </span>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Helpers & Data Extraction
// ==========================================

function asRecord(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function firstText(obj: Rec | null, keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function speakerSide(speaker: string): BubbleSide {
  const s = speaker.toUpperCase();
  if (s.includes("DRIVER") || s.includes("POLICY")) return "right";
  return "left";
}

function roleTitle(speaker: string): string {
  const s = speaker.toUpperCase();
  if (s.includes("PROSECUTOR") || speaker.includes("检察官")) return "Prosecutor";
  if (s.includes("RIDER") || speaker.includes("乘客")) return "Rider Advocate";
  if (s.includes("DRIVER") || speaker.includes("司机")) return "Driver Advocate";
  if (s.includes("POLICY") || speaker.includes("政策")) return "Policy Consultant";
  return speaker;
}

function targetName(target: string): string {
  const t = target.toUpperCase();
  if (t.includes("RIDER")) return "Rider Advocate";
  if (t.includes("DRIVER")) return "Driver Advocate";
  if (t.includes("PROSECUTOR")) return "Prosecutor";
  return target;
}

/**
 * Extracts text matching DebugProcessView logic exactly
 */
function extractTextContent(data: Rec | null): string {
  if (!data) return "";
  const out = asRecord(data.agent_output);

  // 1. Direct text field lookup across outer & inner agent_output
  let text =
    firstText(data, [
      "argument_summary",
      "detailed_argument",
      "reasoning_and_statement",
      "statement",
      "content",
      "question_text",
      "response_text",
      "question",
      "answer",
      "message",
      "text",
    ]) ||
    firstText(out, [
      "argument_summary",
      "detailed_argument",
      "reasoning_and_statement",
      "statement",
      "question_text",
      "question",
      "response_text",
      "answer",
      "content",
      "message",
      "reasoning",
    ]);

  // 2. Format raw json objects if pure text is not found
  if (!text && out && Object.keys(out).length > 0) {
    text = JSON.stringify(out, null, 2);
  } else if (!text && data && Object.keys(data).length > 0) {
    const filterKeys = ["speaker", "target", "turn", "message_type", "event_type", "phase", "sub_phase"];
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => !filterKeys.includes(k)));
    if (Object.keys(filtered).length > 0) {
      text = JSON.stringify(filtered, null, 2);
    }
  }

  return text;
}

function extractMessageFromData(speaker: string, rawData: unknown, badge?: string): ChatMessage | null {
  const data = (asRecord(rawData) || {}) as Rec;
  const text = extractTextContent(data);

  if (!text) return null;

  const out = asRecord(data.agent_output);
  const target = String(data.target || out?.target || "");

  return {
    id: Math.random().toString(36).substring(2, 9),
    side: speakerSide(speaker),
    speaker,
    speakerTitle: roleTitle(speaker),
    text,
    badge,
    targetLabel: target ? targetName(target) : undefined,
  };
}

// ==========================================
// Main Page Component
// ==========================================

export default function ProcessPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const caseId = (params?.caseId as string) || "";
  const isDebug = searchParams.get("debug") === "1";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activeTypingConfig, setActiveTypingConfig] = useState<TypingConfig | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const cleanupRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollButton(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowScrollButton(!atBottom);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Static Load for Completed Cases
  useEffect(() => {
    if (isDebug || !caseId) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await getCompletedResult(caseId);
        if (cancelled) return;

        if (result){
          const parsedMsgs: ChatMessage[] = [];

          // 1. Round 1 Statements (Rider & Driver Argument Summary)
          if (result.round_1_statements?.rider_statement) {
            const m = extractMessageFromData("RIDER_ADVOCATE", result.round_1_statements.rider_statement, "Round 1 Pleading");
            if (m) parsedMsgs.push(m);
          }
          if (result.round_1_statements?.driver_statement) {
            const m = extractMessageFromData("DRIVER_ADVOCATE", result.round_1_statements.driver_statement, "Round 1 Pleading");
            if (m) parsedMsgs.push(m);
          }

          // 2. Prosecutor Initial Audit Summary
          if (result.prosecutor_findings?.prosecutor_summary) {
            parsedMsgs.push({
              id: "init-audit",
              side: "left",
              speaker: "PROSECUTOR",
              speakerTitle: "Prosecutor",
              text: result.prosecutor_findings.prosecutor_summary,
              badge: "Initial Audit",
            });
          }

          // 3. Cross Exam QA
          if (result.round_2_cross_exam?.targeted_questions) {
            const qs = result.round_2_cross_exam.targeted_questions;
            const rs = result.round_2_cross_exam.targeted_responses || [];
            qs.forEach((q: any, i: number) => {
              parsedMsgs.push({
                id: `q-${i}`,
                side: "left",
                speaker: "PROSECUTOR",
                speakerTitle: "Prosecutor",
                text: q.question_text,
                badge: "Cross Exam Question",
                targetLabel: targetName(q.directed_to || q.target || ""),
              });
              const r = rs.find((x: any) => x.question_id === q.question_id) || rs[i];
              if (r) {
                const respParty = r.responding_party === "RIDER" ? "RIDER_ADVOCATE" : "DRIVER_ADVOCATE";
                parsedMsgs.push({
                  id: `r-${i}`,
                  side: speakerSide(respParty),
                  speaker: respParty,
                  speakerTitle: roleTitle(respParty),
                  text: r.response_text,
                  badge: "Defense Response",
                  targetLabel: "Prosecutor",
                });
              }
            });
          }

          // 4. Policy Consultation Verdict & Rationale
          if (result.policy_consultation?.suggestion) {
            const s = (result.policy_consultation.suggestion as unknown) as Rec;
            const ruling = firstText(s, ["suggested_ruling_type", "suggested_ruling"]);
            const rationale = firstText(s, ["rationale", "explanation", "reasoning"]);
            if (ruling || rationale) {
              parsedMsgs.push({
                id: "policy-sug",
                side: "right",
                speaker: "POLICY_CONSULTANT",
                speakerTitle: "Policy Consultant",
                text: `Suggested Ruling: ${ruling}\nRationale: ${rationale}`,
                badge: "Policy Recommendation",
              });
            }
          }

          setMessages(parsedMsgs);
          setCurrentStepIndex(STEPS.length - 1);
          setIsFinished(true);
        }
      } catch (e) {
        console.warn("Failed to load completed static result:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [caseId, isDebug]);

  // Handle SSE Realtime Streaming
  useEffect(() => {
    if (isDebug || !caseId || isFinished || isLoading || startedRef.current) return;

    startedRef.current = true;
    setError(null);

    cleanupRef.current = streamPipeline(caseId, {
      onEvent: (event: PipelineEvent) => {
        const e = event as FeedEvent;
        const phase = e.phase || "";
        const subPhase = e.sub_phase || "";
        const getRoleConfig = (speaker: string, side: "left" | "right", title: string): TypingConfig => ({
          speaker,
          side,
          speakerTitle: title,
        });

        if (e.event_type === "PHASE_STARTED") {
          if (phase === "ROUND_1_PLEADINGS") {
            // 一轮辩论首位：Rider Advocate
            setActiveTypingConfig(getRoleConfig("RIDER_ADVOCATE", "left", "Rider Advocate"));
          } else if (subPhase === "INITIAL_AUDIT" || subPhase === "FINAL_REPORT") {
            setActiveTypingConfig(getRoleConfig("PROSECUTOR", "left", "Prosecutor"));
          } else if (subPhase === "CROSS_EXAM") {
            setActiveTypingConfig(getRoleConfig("PROSECUTOR", "left", "Prosecutor"));
          } else if (phase === "POLICY_CONSULTATION") {
            setActiveTypingConfig(getRoleConfig("POLICY_CONSULTANT", "right", "Policy Consultant"));
          }
        }

        // Advance stepper step
        if (phase === "ROUND_1_PLEADINGS") setCurrentStepIndex(1);
        else if (phase.startsWith("ROUND_2") || phase === "ROUND_2_PROSECUTOR_AUDIT") {
          if (subPhase === "INITIAL_AUDIT") setCurrentStepIndex(2);
          else if (subPhase === "CROSS_EXAM") setCurrentStepIndex(3);
          else if (subPhase === "FINAL_REPORT") setCurrentStepIndex(4);
        } else if (phase === "POLICY_CONSULTATION") setCurrentStepIndex(5);
        else if (phase === "JUDGE_DELIBERATION") setCurrentStepIndex(6);
        else if (phase === "EXECUTION_ROUTER") setCurrentStepIndex(7);

        // 1. Live AGENT_CONVERSATION Messages (Handles real-time single-pass display for Round 1 & Cross Exam)
        if (e.event_type === "AGENT_CONVERSATION") {
          const data = asRecord(e.data) || asRecord(e.payload) || {};
          const speaker = String(e.speaker || data.speaker || "Agent");

          const msg = extractMessageFromData(
            speaker,
            data,
            phase === "ROUND_1_PLEADINGS" ? "Round 1 Pleadings" : subPhase === "CROSS_EXAM" ? "Cross Examination" : "Argument"
          );

          if (msg) {
            setMessages((prev) => [...prev, msg]);
          }

          // 预测并接续下一个角色的 Typing 状态
          if (phase === "ROUND_1_PLEADINGS") {
            if (speaker === "RIDER_ADVOCATE") {
              // Rider 完结，接下来 Driver Advocate
              setActiveTypingConfig(getRoleConfig("DRIVER_ADVOCATE", "right", "Driver Advocate"));
            } else {
              setActiveTypingConfig(null);
            }
          } else if (subPhase === "CROSS_EXAM") {
            if (speaker === "PROSECUTOR") {
              // 检察官问完，判断被质询对象 (比如从 target 或默认 Rider/Driver)
              const target = String(data.target || "RIDER_ADVOCATE");
              const isDriver = target.includes("DRIVER");
              setActiveTypingConfig(
                getRoleConfig(
                  isDriver ? "DRIVER_ADVOCATE" : "RIDER_ADVOCATE",
                  isDriver ? "right" : "left",
                  isDriver ? "Driver Advocate" : "Rider Advocate"
                )
              );
            } else {
              // Advocate 刚回答完，等待检察官评估/提下一个问题
              setActiveTypingConfig(getRoleConfig("PROSECUTOR", "left", "Prosecutor"));
            }
          }
        }

        // 2. PHASE_COMPLETED Data Extracts (Excluded ROUND_1_PLEADINGS to prevent duplicate display)
        if (e.event_type === "PHASE_COMPLETED") {
          const data = asRecord(e.data) || {};
          const subPhase = e.sub_phase; // 确保直接读取当前 Event 的 sub_phase

          // Initial Audit / Final Report Prosecutor Summaries
          if (phase === "ROUND_2_PROSECUTOR_AUDIT") {
            const pf = asRecord(data.prosecutor_findings);
            if (pf && typeof pf.prosecutor_summary === "string" && pf.prosecutor_summary) {
              // 根据 sub_phase 区分初始报告与最终报告
              const isInitial = subPhase === "INITIAL_AUDIT";
              const isFinal = subPhase === "FINAL_REPORT";

              if (isInitial || isFinal) {
                const badge = isInitial ? "Initial Evidence Audit Report" : "Final Audit Report";
                const msgId = `prosecutor-report-${subPhase}-${e.timestamp || Math.random()}`;

                setMessages((prev) => {
                  // 检查是否已经存在该 sub_phase 的报告，防止 SSE 重复推送
                  if (prev.some((m) => m.id.startsWith(`prosecutor-report-${subPhase}`))) {
                    return prev;
                  }
                  return [
                    ...prev,
                    {
                      id: msgId,
                      side: "left",
                      speaker: "PROSECUTOR",
                      speakerTitle: "Prosecutor",
                      text: pf.prosecutor_summary as string,
                      badge,
                      subPhase,
                    },
                  ];
                });
              }
            }
          }

          // Policy Consultation Suggestion
          if (phase === "POLICY_CONSULTATION") {
            const suggestion = asRecord(data.suggestion);
            if (suggestion) {
              const ruling = firstText(suggestion, ["suggested_ruling_type", "suggested_ruling"]);
              const rationale = firstText(suggestion, ["rationale", "explanation", "reasoning"]);
              if (ruling || rationale) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: Math.random().toString(36).substring(2, 9),
                    side: "right",
                    speaker: "POLICY_CONSULTANT",
                    speakerTitle: "Policy Consultant",
                    text: `Suggested Ruling: ${ruling}\nRationale: ${rationale}`,
                    badge: "Policy Recommendation",
                  },
                ]);
              }
            }
          }

          // 当整个阶段/子阶段明确完成时，关闭当前 Typing 动画
          setActiveTypingConfig(null);
        }
      },
      onComplete: () => {
        setIsFinished(true);
        setCurrentStepIndex(STEPS.length - 1);
      },
      onError: () => {
        setError("Real-time stream connection interrupted. Please try again.");
      },
    });

    return () => cleanupRef.current?.();
  }, [caseId, isDebug, isFinished, isLoading]);

  if (isDebug) {
    return <DebugProcessView caseId={caseId} />;
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <IOSHeader title="Mirra AI" />

      {/* Dashed Progress Stepper */}
      <DashedProgressStepper currentStepIndex={currentStepIndex} />

      {/* Main Dialogue Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-4 py-4 max-w-[600px] w-full mx-auto relative ${
          isFinished ? "pb-28" : ""
        }`}
      >
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Loading tribunal data...
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-50 text-red-600 text-center text-sm my-4 border border-red-200">
            {error}
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}

        {activeTypingConfig && (
          <TypingBubble config={activeTypingConfig} />
        )}

        <div ref={bottomRef} />

        {/* <ScrollToLatest visible={showScrollButton} onClick={scrollToBottom} /> */}
      </div>

      {/* Bottom Verdict Action Button */}
      {isFinished && <VerdictButton caseId={caseId} />}
    </div>
  );
}