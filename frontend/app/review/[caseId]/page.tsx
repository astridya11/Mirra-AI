"use client";

/**
 * Review console — case detail page.
 *
 * Layout (>= 1024px): sticky case bar, then three columns —
 * left phase nav (220px) | centre content | right decision rail (320px).
 * Below 1024px: decision rail, then horizontal nav tabs, then content.
 *
 * Design tokens: page bg #F6F7F9; panels white / 1px #E5E7EB / radius 12px;
 * controls radius 8px; no shadows except dialogs. Ink #1F2937, muted #6B7280,
 * faint #9CA3AF. Brand pink #E84360 for primary action and URGENT badge only.
 * Inter; sizes 12/14/16/20/28; tabular-nums for all numbers.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCase, getCompletedResult } from "@/src/lib/api";
import type { ReviewCase } from "@/src/lib/api";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { CaseResult } from "@/src/types";
import type { DemoId } from "@/src/types/session";
import HumanReviewDecision from "@/src/components/review/HumanReviewDecision";
import DemoReviewScreen from "@/src/components/review/DemoReviewScreen";
import LanguageToggle from "@/src/components/LanguageToggle";
import { isDemoReviewRef } from "@/src/lib/humanReview";
import ReviewSlaPanel from "@/src/components/ReviewSlaPanel";
import PriorityBadge from "@/src/components/PriorityBadge";
import SlaBar from "@/src/components/SlaBar";
import { ConfidenceMeter } from "@/src/components/ConfidenceMeter";
import { useAuth } from "@/src/context/AuthContext";
import {
  formatMoney,
  formatPercent,
  humanizeEnum,
  disputeTypeLabel,
  rulingLabel,
  describeAction,
} from "@/src/lib/reviewFormat";

// ==========================================
// TYPES
// ==========================================

export type StepKey =
  | "CASE_SUMMARY"
  | "INIT_CLAIM"
  | "ROUND_1_STATEMENTS"
  | "ROUND_2_CROSS_EXAM"
  | "ROUND_2_REPORT"
  | "POLICY_CONSULTATION"
  | "JUDGE_DELIBERATION"
  | "EXECUTION_ROUTER";

type Rec = Record<string, any>;

export interface FeedEvent {
  event_type: string;
  phase?: string;
  sub_phase?: string;
  label?: string;
  data?: any;
  payload?: any;
  speaker?: string;
  message_type?: string;
  timestamp?: string;
  [key: string]: any;
}

const STEPS: { id: StepKey; name: string}[] = [
  { id: "CASE_SUMMARY", name: "Case summary" },
  { id: "INIT_CLAIM", name: "Dispute filed" },
  { id: "ROUND_1_STATEMENTS", name: "Round 1 statements"},
  { id: "ROUND_2_CROSS_EXAM", name: "Cross examination" },
  { id: "ROUND_2_REPORT", name: "Final audit report" },
  { id: "POLICY_CONSULTATION", name: "Policy and precedent" },
  { id: "JUDGE_DELIBERATION", name: "Judge deliberation" },
  { id: "EXECUTION_ROUTER", name: "Execution router" },
];

// ==========================================
// HELPERS
// ==========================================

const asRecord = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function pick(obj: Rec | null, keys: string[]): [string, any] | null {
  if (!obj) return null;
  for (const k of keys) {
    if (!isEmpty(obj[k])) return [k, obj[k]];
  }
  return null;
}

function firstText(obj: Rec | null, keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function formatTime(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  dispute_type: "Dispute type",
  rider_id: "Rider ID",
  driver_id: "Driver ID",
  trip_id: "Trip ID",
  frozen_at: "Evidence frozen at",
  prosecutor_summary: "Prosecutor summary",
  verified_facts: "Verified facts",
  disputed_facts: "Disputed facts",
  missing_facts: "Missing facts",
  missing_evidence: "Missing evidence",
  fact_id: "Fact ID",
  description: "Description",
  source: "Source",
  fraud_risk_level: "Fraud risk level",
  fraud_risk_score: "Fraud risk score",
  escalation_protocol: "Escalation protocol",
  safety_threat_detected: "Safety threat detected",
  missing_crucial_evidence: "Missing crucial evidence",
  party_requested_human: "Party requested human review",
  is_escalated: "Is escalated",
  escalation_reasons: "Escalation reasons",
  priority_level: "Priority level",
  request_id: "Request ID",
  verified_fact_ids: "Verified fact IDs",
  requested_at: "Requested at",
  suggested_ruling: "Suggested ruling",
  suggested_ruling_type: "Suggested ruling type",
  ruling_type: "Ruling type",
  recommended_action: "Recommended action",
  suggested_action: "Suggested action",
  refund_amount: "Refund amount",
  cleaning_fee_amount: "Cleaning fee amount",
  account_action: "Account action",
  applicable_clauses: "Applicable clauses",
  clause_id: "Clause ID",
  clause_text: "Clause text",
  matched_precedents: "Matched precedents",
  precedents: "Precedents",
  confidence: "Confidence",
  confidence_score: "Confidence score",
  reasoning: "Reasoning",
  rationale: "Rationale",
  explanation: "Explanation",
  route: "Route",
  requires_human_signoff: "Requires human signoff",
  execution_payload: "Execution payload",
  execution_status: "Execution status",
  transaction_id: "Transaction ID",
  auto_executed_at: "Auto executed at",
  case_final_status: "Case final status",
  resolved_at: "Resolved at",
  question_text: "Question",
  evidence_context: "Evidence context",
  category: "Category",
  directed_to: "Directed to",
};

const label = (k: string) => FIELD_LABELS[k] ?? k;

const PHASE_TO_STEP: Record<string, StepKey> = {
  CASE_SUMMARY: "CASE_SUMMARY",
  INIT_CLAIM: "INIT_CLAIM",
  ROUND_1_STATEMENTS: "ROUND_1_STATEMENTS",
  POLICY_CONSULTATION: "POLICY_CONSULTATION",
  JUDGE_DELIBERATION: "JUDGE_DELIBERATION",
  EXECUTION_ROUTER: "EXECUTION_ROUTER",
};

const SUB_PHASE_TO_STEP: Record<string, StepKey> = {
  CROSS_EXAM: "ROUND_2_CROSS_EXAM",
  FINAL_REPORT: "ROUND_2_REPORT",
};

function isAgentConversation(e: FeedEvent): boolean {
  return (
    e.event_type === "AGENT_CONVERSATION" ||
    Boolean(e.payload) ||
    (Boolean(e.speaker) && Boolean(e.message_type))
  );
}

function classifyEvent(e: FeedEvent): StepKey {
  const phase = e.phase ?? "";
  if (phase === "CASE_SUMMARY") return "CASE_SUMMARY";
  if (phase === "ROUND_2_PROSECUTOR_AUDIT" || phase.startsWith("ROUND_2")) {
    if (e.sub_phase && SUB_PHASE_TO_STEP[e.sub_phase]) {
      return SUB_PHASE_TO_STEP[e.sub_phase];
    }
    if (isAgentConversation(e)) return "ROUND_2_CROSS_EXAM";
    return "ROUND_2_REPORT"; // fallback
  }
  if (PHASE_TO_STEP[phase]) {
    return PHASE_TO_STEP[phase];
  }
  return "INIT_CLAIM"; // fallback
}

interface NormalizedMessage {
  speaker: string;
  messageType: string;
  target: string;
  turn?: number;
  text: string;
  evidenceContext: string;
  category: string;
  raw: any;
}

function normalizeMessage(e: FeedEvent): NormalizedMessage {
  const data = asRecord(e.data) ?? asRecord(e.payload) ?? e;
  const out = asRecord(data.agent_output);

  let text =
    firstText(data, [
      "content",
      "question_text",
      "response_text",
      "statement",
      "question",
      "answer",
      "message",
      "text",
    ]) ||
    firstText(out, [
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

  if (!text && out && Object.keys(out).length > 0) {
    text = JSON.stringify(out, null, 2);
  }

  return {
    speaker: String(e.speaker ?? data.speaker ?? data.agent_role ?? data.agent_type ?? "Agent"),
    messageType: String(e.message_type ?? data.message_type ?? ""),
    target: String(data.target ?? ""),
    turn: typeof data.turn === "number" ? data.turn : undefined,
    text,
    evidenceContext: firstText(out, ["evidence_context"]) || firstText(data, ["evidence_context"]),
    category: firstText(out, ["category"]) || firstText(data, ["category"]),
    raw: out ?? data,
  };
}

const ROLE_STYLE = {
  prosecutor: {
    box: "border-[#E5E7EB] bg-white text-[#1F2937]",
    title: "Prosecutor",
  },
  rider: {
    box: "border-[#E5E7EB] bg-white text-[#1F2937]",
    title: "Rider advocate",
  },
  driver: {
    box: "border-[#E5E7EB] bg-white text-[#1F2937]",
    title: "Driver advocate",
  },
  other: {
    box: "border-[#E5E7EB] bg-white text-[#1F2937]",
    title: "Agent",
  },
};

function roleOf(speaker: string): keyof typeof ROLE_STYLE {
  const s = speaker.toUpperCase();
  if (s.includes("PROSECUTOR") || speaker.includes("检察官")) return "prosecutor";
  if (s.includes("RIDER") || speaker.includes("乘客")) return "rider";
  if (s.includes("DRIVER") || speaker.includes("司机")) return "driver";
  return "other";
}

function roleName(raw: string): string {
  const r = roleOf(raw);
  if (r === "prosecutor") return "Prosecutor";
  if (r === "rider") return "Rider advocate";
  if (r === "driver") return "Driver advocate";
  return raw || "—";
}

// ==========================================
// GENERIC DATA RENDERER
// ==========================================

const Chip: React.FC<{ children: React.ReactNode; tone?: "primary" | "blue" | "amber" | "green" | "red" | "gray" }> = ({
  children,
  tone = "gray",
}) => {
  const tones = {
    primary: "bg-[#E84360]/10 text-[#E84360] border-[#E84360]/20",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-100 text-gray-700 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[12px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

const DataView: React.FC<{ value: any; skip?: string[]; depth?: number }> = ({ value, skip = [], depth = 0 }) => {
  if (value === null || value === undefined || value === "") {
    return <span className="text-[#9CA3AF]">&mdash;</span>;
  }
  if (typeof value === "boolean") {
    return <Chip tone={value ? "primary" : "gray"}>{value ? "Yes" : "No"}</Chip>;
  }
  if (typeof value === "number") {
    return <span className="text-[#1F2937] tabular-nums">{value}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-[#1F2937] whitespace-pre-wrap leading-relaxed">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[#9CA3AF]">(Empty)</span>;
    const allPrimitive = value.every((v) => v === null || typeof v !== "object");
    if (allPrimitive) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <Chip key={i}>{String(v)}</Chip>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="p-3 rounded-lg border border-[#E5E7EB] bg-[#F6F7F9]">
            <DataView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const obj = value as Rec;
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (entries.length === 0) return <span className="text-[#9CA3AF]">(Empty)</span>;
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className={depth === 0 ? "grid grid-cols-[10rem_1fr] gap-x-3" : "grid grid-cols-[8.5rem_1fr] gap-x-2"}>
          <dt className="text-[#6B7280] font-medium">{label(k)}</dt>
          <dd className="min-w-0">
            <DataView value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  return (
    <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-4 text-[14px]">
      <div className="font-semibold text-[#1F2937] border-b border-[#E5E7EB] pb-2">{title}</div>
      <div className="text-[#1F2937] space-y-4">{children}</div>
    </div>
  );
};

const RawJson: React.FC<{ value: any; summary?: string }> = ({ value, summary = "View raw data" }) => (
  <details className="text-[12px] text-[#6B7280] group">
    <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors select-none">
      {summary}
    </summary>
    <pre className="mt-2 p-3 bg-[#F6F7F9] border border-[#E5E7EB] rounded-lg overflow-x-auto text-[#6B7280] font-mono text-[10px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  </details>
);

// ==========================================
// AGENT message card
// ==========================================

const AgentMessageCard: React.FC<{ event: FeedEvent }> = ({ event }) => {
  const msg = normalizeMessage(event);
  const role = roleOf(msg.speaker);
  const style = ROLE_STYLE[role];
  const isQuestion = msg.messageType === "QUESTION";
  const isResponse = msg.messageType === "RESPONSE";
  const inCrossExam = event.sub_phase === "CROSS_EXAM" || isQuestion || isResponse;
  const indent = isResponse ? "ml-6 md:ml-12" : "";

  return (
    <div className={`my-4 ${indent}`}>
      <div className={`p-4 rounded-xl border ${style.box}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-[#E5E7EB]">
          <span className="font-semibold text-[14px] flex flex-wrap items-center gap-2">
            {role === "other" ? msg.speaker : style.title}
            {inCrossExam && msg.messageType && (
              <Chip tone={isQuestion ? "primary" : "green"}>
                {isQuestion ? "Question" : "Response"}
                {msg.turn !== undefined ? ` \u00b7 Round ${msg.turn}` : ""}
              </Chip>
            )}
            {msg.target && (
              <span className="text-[12px] font-normal text-[#6B7280]">
                {isQuestion ? "Directed to: " : "Responding to: "}
                {roleName(msg.target)}
              </span>
            )}
          </span>
          {event.timestamp && <span className="text-[12px] text-[#9CA3AF] tabular-nums">{formatTime(event.timestamp)}</span>}
        </div>

        <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-[#1F2937]">
          {msg.text || <span className="italic text-[#9CA3AF]">(This agent did not return text content)</span>}
        </div>

        {isQuestion && (msg.category || msg.evidenceContext) && (
          <div className="mt-4 pt-3 border-t border-[#E5E7EB] text-[12px] space-y-2 text-[#6B7280] bg-[#F6F7F9] rounded-lg p-3">
            {msg.category && msg.category !== "OTHER" && (
              <div>
                <span className="text-[#6B7280] font-medium mr-2">Category:</span>
                {msg.category}
              </div>
            )}
            {msg.evidenceContext && (
              <div>
                <span className="text-[#6B7280] font-medium mr-2">Evidence context:</span>
                {msg.evidenceContext}
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          <RawJson value={msg.raw} summary="Agent raw output" />
        </div>
      </div>
    </div>
  );
};

const CrossExamTranscript: React.FC<{ questions: Rec[]; responses: Rec[] }> = ({ questions, responses }) => {
  if (questions.length === 0) {
    return (
      <div className="my-4 p-4 rounded-xl border border-[#E5E7EB] bg-[#F6F7F9] text-[14px] text-[#6B7280] text-center">
        The prosecutor did not raise any questions in this round.
      </div>
    );
  }
  return (
    <div className="my-2">
      {questions.map((q, i) => {
        const r = responses.find((x) => x.question_id === q.question_id) ?? responses[i];
        const target = q.directed_to ?? q.target ?? "";
        return (
          <React.Fragment key={q.question_id ?? i}>
            <AgentMessageCard
              event={{
                event_type: "AGENT_CONVERSATION",
                speaker: "PROSECUTOR",
                message_type: "QUESTION",
                timestamp: q.asked_at,
                data: { ...q, target, content: q.question_text, turn: i + 1, agent_output: q },
              }}
            />
            {r && (
              <AgentMessageCard
                event={{
                  event_type: "AGENT_CONVERSATION",
                  speaker: target || r.responding_party,
                  message_type: "RESPONSE",
                  timestamp: r.responded_at,
                  data: { ...r, target: "PROSECUTOR", content: r.response_text, turn: i + 1, agent_output: r },
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ==========================================
// Phase views
// ==========================================

const FactList: React.FC<{ title: string; facts: any[]; tone: "green" | "amber" | "red" }> = ({ title, facts, tone }) => (
  <div className="mt-4">
    <div className="text-[#1F2937] font-medium mb-2 flex items-center gap-2">
      {title} <Chip tone={tone}>{facts.length}</Chip>
    </div>
    <ul className="space-y-2">
      {facts.map((f, i) => {
        const rec = asRecord(f);
        const text = rec ? firstText(rec, ["description", "fact", "text", "content"]) : String(f);
        return (
          <li key={rec?.fact_id ?? i} className="p-3 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] text-[#1F2937]">
            {rec?.fact_id && <span className="text-[#9CA3AF] mr-2 tabular-nums text-[12px]">{rec.fact_id}</span>}
            {text || <DataView value={rec} />}
          </li>
        );
      })}
    </ul>
  </div>
);

const Round1StatementsView: React.FC<{ data: Rec }> = ({ data }) => {
  const statementsObj = data.round_1_statements || data.statements || data;
  const riderStmt = asRecord(statementsObj.rider_statement) || asRecord(statementsObj.RIDER) || asRecord(Array.isArray(statementsObj) ? statementsObj.find((x: any) => x?.party === "RIDER" || x?.agent_role === "RIDER_ADVOCATE") : null);
  const driverStmt = asRecord(statementsObj.driver_statement) || asRecord(statementsObj.DRIVER) || asRecord(Array.isArray(statementsObj) ? statementsObj.find((x: any) => x?.party === "DRIVER" || x?.agent_role === "DRIVER_ADVOCATE") : null);

  const renderStatementCard = (stmt: Rec | null, role: "rider" | "driver") => {
    if (!stmt) return null;
    const style = ROLE_STYLE[role];
    const outcome = stmt.requested_outcome;
    const amount = stmt.requested_amount;
    const evidenceRefs = Array.isArray(stmt.evidence_references) ? stmt.evidence_references : [];

    return (
      <div className={`p-5 rounded-xl border ${style.box} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[16px]">{style.title}</span>
            <Chip tone={role === "rider" ? "primary" : "green"}>
              {role === "rider" ? "Rider advocate" : "Driver advocate"}
            </Chip>
          </div>
          {outcome && (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-[#6B7280] font-medium">Requested:</span>
              <Chip tone="primary">
                {String(outcome)} {amount !== undefined && amount !== null ? `(${formatMoney(amount)})` : ""}
              </Chip>
            </div>
          )}
        </div>

        {stmt.argument_summary && (
          <div>
            <div className="text-[12px] font-medium text-[#6B7280] mb-1.5">Argument summary</div>
            <div className="p-3.5 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] text-[#1F2937] text-[14px] leading-relaxed font-medium">
              {String(stmt.argument_summary)}
            </div>
          </div>
        )}

        {stmt.detailed_argument && (
          <div>
            <div className="text-[12px] font-medium text-[#6B7280] mb-1.5">Detailed argument</div>
            <div className="p-3.5 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] text-[#1F2937] text-[14px] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
              {String(stmt.detailed_argument)}
            </div>
          </div>
        )}

        {evidenceRefs.length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-2">
              <span>Cited evidence references</span>
              <Chip tone="gray">{evidenceRefs.length}</Chip>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {evidenceRefs.map((ev: any, i: number) => {
                const evRec = asRecord(ev);
                const evId = evRec?.evidence_id || `EV-${i}`;
                const sourceType = evRec?.source_type || "EVIDENCE";
                const desc = evRec?.description || String(ev);
                return (
                  <div key={i} className="p-2.5 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] text-[12px] space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[#1F2937] tabular-nums">{evId}</span>
                      <Chip tone="blue">{sourceType}</Chip>
                    </div>
                    <p className="text-[#6B7280] line-clamp-2">{desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stmt.submitted_at && (
          <div className="text-[12px] text-[#9CA3AF] text-right pt-2 border-t border-[#E5E7EB] tabular-nums">
            Submitted at: {new Date(stmt.submitted_at).toLocaleString()}
          </div>
        )}
      </div>
    );
  };

  if (!riderStmt && !driverStmt) {
    return (
      <Panel title="Round 1 statements">
        <div className="text-[#9CA3AF] italic text-center p-6 bg-[#F6F7F9] rounded-lg">
          No round 1 statements data available.
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white flex items-center gap-3">
        <div>
          <span className="font-semibold text-[#1F2937] text-[14px]">Round 1 statements overview</span>
          <p className="text-[12px] text-[#6B7280] mt-0.5">Formal initial statements and evidence citations submitted by the rider and driver advocates.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderStatementCard(riderStmt, "rider")}
        {renderStatementCard(driverStmt, "driver")}
      </div>

      <div className="pt-2">
        <RawJson value={data} summary="Round 1 statements raw data" />
      </div>
    </div>
  );
};

const ProsecutorView: React.FC<{ findings: Rec | null; bonus: Rec | null; title: string }> = ({
  findings,
  bonus,
  title,
}) => {
  const factKeys: [string, string, "green" | "amber" | "red"][] = [
    ["verified_facts", "Verified facts", "green"],
    ["disputed_facts", "Disputed facts", "amber"],
    ["missing_facts", "Missing facts", "red"],
  ];
  const shown = ["prosecutor_summary", ...factKeys.map((f) => f[0])];
  const escalation = asRecord(bonus?.escalation_protocol);
  const fraud = escalation?.fraud_risk_level;

  return (
    <Panel title={title}>
      {findings && !isEmpty(findings) ? (
        <>
          {typeof findings.prosecutor_summary === "string" && findings.prosecutor_summary && (
            <div className="mb-4">
              <div className="text-[#6B7280] font-medium mb-2">Prosecutor summary</div>
              <p className="p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] leading-relaxed text-[#1F2937]">
                {findings.prosecutor_summary}
              </p>
            </div>
          )}
          {factKeys.map(
            ([k, t, tone]) =>
              Array.isArray(findings[k]) && findings[k].length > 0 && <FactList key={k} title={t} facts={findings[k]} tone={tone} />
          )}
          {Object.keys(findings).some((k) => !shown.includes(k) && !isEmpty(findings[k])) && (
            <div className="mt-6 pt-4 border-t border-[#E5E7EB]">
              <DataView value={findings} skip={shown} />
            </div>
          )}
        </>
      ) : (
        <div className="text-[#9CA3AF] italic p-4 text-center bg-[#F6F7F9] rounded-lg">The prosecutor has not returned audit findings yet.</div>
      )}

      {escalation && (
        <div className="mt-6 pt-4 border-t border-[#E5E7EB] flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-[#6B7280]">Risk signals:</span>
          {fraud && <Chip tone={fraud === "HIGH" ? "red" : fraud === "MEDIUM" ? "amber" : "green"}>Fraud risk {humanizeEnum(fraud)}</Chip>}
          {escalation.safety_threat_detected && <Chip tone="red">Safety threat detected</Chip>}
          {escalation.missing_crucial_evidence && <Chip tone="amber">Missing crucial evidence</Chip>}
          {!escalation.safety_threat_detected && !escalation.missing_crucial_evidence && fraud !== "HIGH" && (
            <Chip tone="green">No escalation signals</Chip>
          )}
        </div>
      )}
      {bonus && !isEmpty(bonus) && (
        <div className="mt-4">
          <RawJson value={bonus} summary="Safety and fraud detection module (bonus_modules)" />
        </div>
      )}
    </Panel>
  );
};

const KNOWN_RULING = ["suggested_ruling_type", "suggested_ruling", "ruling_type"];
const KNOWN_ACTION = ["recommended_action", "suggested_action"];
const KNOWN_REASON = ["reasoning", "rationale", "explanation", "summary", "suggestion_summary"];
const KNOWN_CONF = ["confidence_score", "confidence"];
const KNOWN_CLAUSES = ["applicable_clauses", "clauses"];
const KNOWN_PRECEDENTS = ["matched_precedents", "precedents", "similar_precedents", "relevant_precedents"];

const PolicySuggestionView: React.FC<{ suggestion: any }> = ({ suggestion }) => {
  if (typeof suggestion === "string") {
    return <p className="p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] leading-relaxed text-[#1F2937]">{suggestion}</p>;
  }
  const s = asRecord(suggestion);
  if (!s || isEmpty(s)) {
    return <div className="text-[#9CA3AF] italic text-center p-4">The policy advisor did not return available data.</div>;
  }

  const ruling = pick(s, KNOWN_RULING);
  const action = pick(s, KNOWN_ACTION);
  const reason = pick(s, KNOWN_REASON);
  const conf = pick(s, KNOWN_CONF);
  const clauses = pick(s, KNOWN_CLAUSES);
  const precedents = pick(s, KNOWN_PRECEDENTS);

  const used = [ruling, action, reason, conf, clauses, precedents].filter(Boolean).map((x) => (x as [string, any])[0]);

  return (
    <div className="space-y-6">
      {(ruling || conf) && (
        <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white flex flex-wrap items-center gap-3">
          <span className="font-semibold text-[#1F2937]">Suggested policy ruling</span>
          {ruling && <Chip tone="primary">{rulingLabel(ruling[1])}</Chip>}
          {conf && (
            <span className="text-[#6B7280] text-[14px] tabular-nums">
              Confidence <span className="font-medium text-[#1F2937]">{formatPercent(conf[1])}</span>
            </span>
          )}
        </div>
      )}

      {action && (
        <div>
          <div className="text-[#6B7280] font-medium mb-2">Recommended action</div>
          <div className="p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB]">
            <DataView value={action[1]} />
          </div>
        </div>
      )}

      {reason && (
        <div>
          <div className="text-[#6B7280] font-medium mb-2">Reasoning rationale</div>
          <div className="p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB] leading-relaxed text-[#1F2937]">
            {typeof reason[1] === "string" ? reason[1] : <DataView value={reason[1]} />}
          </div>
        </div>
      )}

      {clauses && Array.isArray(clauses[1]) && (
        <div>
          <div className="text-[#6B7280] font-medium mb-2 flex items-center gap-2">
            Applicable policy clauses <Chip tone="blue">{clauses[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {clauses[1].map((c: any, i: number) => {
              const rec = asRecord(c);
              if (!rec) return <div key={i} className="p-3 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB]">{String(c)}</div>;
              const body = firstText(rec, ["clause_text", "content", "text", "description", "summary"]);
              const why = firstText(rec, ["relevance", "relevance_reason", "reason", "rationale"]);
              const shownKeys = ["clause_id", "title", "clause_title", "clause_text", "content", "text", "description", "summary", "relevance", "relevance_reason", "reason", "rationale"];
              return (
                <div key={rec.clause_id ?? i} className="p-4 rounded-lg bg-white border border-[#E5E7EB]">
                  <div className="font-semibold text-[#1F2937]">
                    {rec.clause_id && <span className="text-[#9CA3AF] mr-2 tabular-nums text-[12px]">{rec.clause_id}</span>}
                    {rec.title ?? rec.clause_title ?? (rec.clause_id ? "" : `Clause ${i + 1}`)}
                  </div>
                  {body && <div className="text-[#1F2937] mt-2 leading-relaxed whitespace-pre-wrap">{body}</div>}
                  {why && <div className="text-[#6B7280] mt-3 p-3 bg-[#F6F7F9] rounded text-[14px]">Relevance: {why}</div>}
                  {Object.keys(rec).some((k) => !shownKeys.includes(k) && !isEmpty(rec[k])) && (
                    <div className="mt-3 pt-3 border-t border-[#E5E7EB]">
                      <DataView value={rec} skip={shownKeys} depth={1} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {precedents && Array.isArray(precedents[1]) && (
        <div>
          <div className="text-[#6B7280] font-medium mb-2 flex items-center gap-2">
            Reference historical precedents <Chip tone="gray">{precedents[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {precedents[1].map((p: any, i: number) => (
              <div key={i} className="p-4 rounded-lg bg-white border border-[#E5E7EB] text-[#1F2937]">
                {typeof p === "string" ? p : <DataView value={p} depth={1} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(s).some((k) => !used.includes(k) && !isEmpty(s[k])) && (
        <div className="pt-4 border-t border-[#E5E7EB]">
          <DataView value={s} skip={used} />
        </div>
      )}
    </div>
  );
};

const PolicyView: React.FC<{ data: Rec }> = ({ data }) => {
  const request = asRecord(data.request);
  return (
    <Panel title="Policy clauses and recommendations">
      <PolicySuggestionView suggestion={data.suggestion} />
      {request && (
        <details className="mt-4 text-[12px] text-[#6B7280]">
          <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors">
            Consultation request
          </summary>
          <div className="mt-2 p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB]">
            <DataView value={request} />
          </div>
        </details>
      )}
      <div className="mt-2">
        <RawJson value={data} summary="Policy consultation raw data" />
      </div>
    </Panel>
  );
};

const JudgeView: React.FC<{ data: Rec }> = ({ data }) => {
  const action = asRecord(data.recommended_action);
  return (
    <Panel title="Judge verdict">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.ruling_type && <Chip tone="primary">{rulingLabel(data.ruling_type)}</Chip>}
        {data.confidence_score !== undefined && (
          <Chip tone={Number(data.confidence_score) >= 0.75 ? "green" : "amber"}>
            Confidence {formatPercent(data.confidence_score)}
          </Chip>
        )}
      </div>
      {action && (
        <div className="mb-4 p-4 rounded-lg bg-[#F6F7F9] border border-[#E5E7EB]">
          <DataView value={action} />
        </div>
      )}
      <DataView value={data} skip={["ruling_type", "confidence_score", "recommended_action", "verified_fact_references", "policy_clauses_applied", "precedent_references", "execution_payload"]} />
    </Panel>
  );
};

const ExecutionView: React.FC<{ data: Rec }> = ({ data }) => {
  const escalated = data.route === "ESCALATED_HUMAN_REVIEW";
  return (
    <Panel title="Execution router">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.route && <Chip tone={escalated ? "amber" : "green"}>{humanizeEnum(data.route)}</Chip>}
        {data.confidence_score !== undefined && <Chip>Confidence {formatPercent(data.confidence_score)}</Chip>}
      </div>
      {Array.isArray(data.escalation_reasons) && data.escalation_reasons.length > 0 && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-100">
          <div className="text-amber-800 font-medium mb-2">Escalation reasons:</div>
          <ul className="list-disc list-inside space-y-1 text-amber-700">
            {data.escalation_reasons.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <DataView value={data} skip={["route", "confidence_score", "escalation_reasons"]} />
    </Panel>
  );
};

// ==========================================
// CASE SUMMARY VIEW (decision-first)
// ==========================================

const CaseSummaryView: React.FC<{ data: Rec }> = ({ data }) => {
  const metadata = asRecord(data.case_metadata) || {};
  const claim = asRecord(data.dispute_claim) || {};
  const findings = asRecord(data.prosecutor_findings) || {};
  const bonus = asRecord(data.bonus_modules) || {};
  const escalation = asRecord(bonus.escalation_protocol) || {};
  const verdict = asRecord(data.judge_verdict) || {};
  const action = asRecord(verdict.recommended_action) || {};
  const explanations = asRecord(verdict.explanations) || {};

  const reasons = escalation.escalation_reasons || [];
  const priority = escalation.priority_level || "STANDARD";
  const confidence = verdict.confidence_score ?? findings.confidence_score ?? 0;
  const isUrgent = priority === "URGENT";

  return (
    <div className="space-y-6">
      {/* a. AI recommends */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-[14px] text-[#6B7280]">AI recommends</p>
          <p className="text-[28px] font-semibold text-[#1F2937] leading-tight break-words">
            {describeAction(action)}
          </p>
          <p className="text-[14px] text-[#6B7280]">
            {rulingLabel(verdict.ruling_type || verdict.suggested_ruling_type)}
          </p>
        </div>
        {/* Mobile: 48px meter + caption in a row; Desktop: 64px meter + caption stacked */}
        <div className="flex items-start gap-2 sm:flex-col sm:items-center sm:gap-1 shrink-0">
          <div className="sm:hidden">
            <ConfidenceMeter score={confidence} size={48} showLabel={false} />
          </div>
          <div className="hidden sm:block">
            <ConfidenceMeter score={confidence} size={64} showLabel={false} />
          </div>
          <p className="text-[12px] text-[#6B7280] tabular-nums sm:text-center sm:max-w-[200px]">
            Verdict confidence &middot; 75% needed to act without a human
          </p>
        </div>
      </div>

      {/* b. Why it needs a human */}
      {Array.isArray(reasons) && reasons.length > 0 && (
        <div
          className={`p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-2 ${
            isUrgent ? "border-l-[3px] border-l-red-600" : "border-l-[3px] border-l-amber-500"
          }`}
        >
          <div className="font-semibold text-[#1F2937] text-[14px]">
            Why it needs a human
          </div>
          <ul className="list-disc list-inside space-y-1 text-[14px] text-[#1F2937]">
            {reasons.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* c. Two columns: explanations for rider / driver */}
      {(explanations.explanation_for_rider || explanations.explanation_for_driver) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {explanations.explanation_for_rider && (
            <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-2">
              <div className="font-semibold text-[#1F2937] text-[14px] border-b border-[#E5E7EB] pb-2">
                Explanation for the rider
              </div>
              <p className="text-[14px] text-[#1F2937] leading-relaxed">
                {explanations.explanation_for_rider}
              </p>
            </div>
          )}
          {explanations.explanation_for_driver && (
            <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-2">
              <div className="font-semibold text-[#1F2937] text-[14px] border-b border-[#E5E7EB] pb-2">
                Explanation for the driver
              </div>
              <p className="text-[14px] text-[#1F2937] leading-relaxed">
                {explanations.explanation_for_driver}
              </p>
            </div>
          )}
        </div>
      )}

      {/* d. Judge's reasoning */}
      {verdict.reasoning_summary && (
        <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-2">
          <div className="font-semibold text-[#1F2937] text-[14px] border-b border-[#E5E7EB] pb-2">
            Judge&apos;s reasoning
          </div>
          <p className="text-[14px] text-[#1F2937] leading-relaxed">
            {verdict.reasoning_summary}
          </p>
        </div>
      )}

      {/* e. Case details */}
      <div className="p-4 rounded-xl border border-[#E5E7EB] bg-white space-y-3">
        <div className="font-semibold text-[#1F2937] text-[14px] border-b border-[#E5E7EB] pb-2">
          Case details
        </div>
        <dl className="text-[14px] space-y-2">
          <div className="flex justify-between gap-3">
            <dt className="text-[#6B7280]">Dispute type</dt>
            <dd className="font-medium text-[#1F2937]">{disputeTypeLabel(metadata.dispute_type || claim.dispute_type)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#6B7280]">Rider ID</dt>
            <dd className="font-medium text-[#1F2937] tabular-nums">{metadata.rider_id || claim.rider_id || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#6B7280]">Driver ID</dt>
            <dd className="font-medium text-[#1F2937] tabular-nums">{metadata.driver_id || claim.driver_id || "—"}</dd>
          </div>
          {metadata.trip_id && (
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B7280]">Trip ID</dt>
              <dd className="font-medium text-[#1F2937] tabular-nums">{metadata.trip_id}</dd>
            </div>
          )}
          <div className="pt-2 border-t border-[#E5E7EB]">
            <dt className="text-[#6B7280] block mb-1">Claim description</dt>
            <dd className="text-[#1F2937] bg-[#F6F7F9] p-3 rounded-lg text-[14px] leading-relaxed">
              {claim.description || metadata.description || "No detailed description"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

// ==========================================
// COMPONENT
// ==========================================

export default function CustomerSupportCaseViewPage() {
  const params = useParams();
  const caseId = (params?.caseId as string) || "";
  // DEMO MODE reference: offline, no login, never a backend case.
  if (isDemoReviewRef(caseId)) {
    return <DemoReviewScreen caseRef={caseId} sessionId={caseId.slice("DEMO-REVIEW-".length)} />;
  }
  return <LiveCaseReview caseId={caseId} />;
}

function LiveCaseReview({ caseId }: { caseId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by Guided Demo ("Open Human Review") so the decision reaches both party apps.
  const demoParam = searchParams.get("demo");
  const sessionParam = searchParams.get("session");
  const link =
    (demoParam === "1" || demoParam === "2" || demoParam === "3") && sessionParam
      ? { demoId: demoParam as DemoId, sessionId: sessionParam }
      : undefined;
  const [caseResult, setCaseResult] = useState<CaseResult | null>(null);
  const { user, isLoading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [activeTab, setActiveTab] = useState<StepKey>("CASE_SUMMARY");
  const [reviewCase, setReviewCase] = useState<ReviewCase | null>(null);

  // Redirect non-support users away before any review data is fetched.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.party !== "SUPPORT") {
      router.replace("/help");
    }
  }, [user, authLoading, router]);

  // Only fetch review data once the user is confirmed as SUPPORT.
  const authed = !authLoading && user?.party === "SUPPORT";

  // Fetch the ReviewCase (for the case bar: priority, SLA, confidence).
  useEffect(() => {
    if (!caseId || !authed) return;
    let alive = true;
    const load = () =>
      getCase(caseId)
        .then((d) => alive && setReviewCase(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [caseId, authed]);

  // Fetch the completed result (phase data).
  useEffect(() => {
    if (!caseId || !authed) return;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getCompletedResult(caseId);
        if (!result) throw new Error("API did not return valid data (empty response)");
        setCaseResult(result);

        const synthesizedEvents: FeedEvent[] = [];

        // 0. CASE_SUMMARY
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "CASE_SUMMARY",
          data: result,
        });

        // 1. INIT_CLAIM
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "INIT_CLAIM",
          label: "Dispute filed",
          data: {
            ...result.case_metadata,
            ...result.dispute_claim,
            ...result.data_sources,
          },
        });

        // 2. Round 1 Statements
        const statements = result.agent_conversation?.filter((m: any) => m.message_type === "STATEMENT") || [];
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_1_STATEMENTS",
          data: result.round_1_statements ?? { statements },
        });

        // 3. ROUND 2 CROSS EXAM
        const crossExams = result.agent_conversation?.filter((m: any) => m.message_type !== "STATEMENT") || [];
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_2_PROSECUTOR_AUDIT",
          sub_phase: "CROSS_EXAM",
          data: { round_2_cross_exam: result.round_2_cross_exam },
        });

        // 4. ROUND 2 FINAL REPORT
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_2_PROSECUTOR_AUDIT",
          sub_phase: "FINAL_REPORT",
          data: {
            prosecutor_findings: result.prosecutor_findings,
            bonus_modules: result.bonus_modules,
            round_2_cross_exam: result.round_2_cross_exam,
          },
        });

        // 5. POLICY CONSULTATION
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "POLICY_CONSULTATION",
          data: result.policy_consultation,
        });

        // 6. JUDGE DELIBERATION
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "JUDGE_DELIBERATION",
          data: result.judge_verdict,
        });

        // 7. EXECUTION ROUTER
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "EXECUTION_ROUTER",
          data: {
            route: result.case_metadata?.resolution_channel,
            confidence_score: result.judge_verdict?.confidence_score,
            escalation_reasons: result.bonus_modules?.escalation_protocol?.escalation_reasons,
            ...result.judge_verdict?.execution_payload,
          },
        });

        setEvents(synthesizedEvents);
      } catch (err) {
        setError("Failed to fetch case data, please check network or backend logs.");
        console.error("Fetch complete result error:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [caseId, authed]);

  // Group events by step
  const eventsByStep = useMemo(() => {
    const map: Record<StepKey, FeedEvent[]> = {
      CASE_SUMMARY: [],
      INIT_CLAIM: [],
      ROUND_1_STATEMENTS: [],
      ROUND_2_CROSS_EXAM: [],
      ROUND_2_REPORT: [],
      POLICY_CONSULTATION: [],
      JUDGE_DELIBERATION: [],
      EXECUTION_ROUTER: [],
    };
    events.forEach((e) => {
      const step = classifyEvent(e);
      if (map[step]) map[step].push(e);
    });
    return map;
  }, [events]);

  // While auth is loading, render nothing to avoid a flash of content.
  if (authLoading || !authed) return null;

  const activeEvents = eventsByStep[activeTab] || [];
  const resolved = reviewCase?.status === "RESOLVED";
  const isCleaningCase = caseResult?.case_metadata?.dispute_type === "CLEANING_FEE";

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#1F2937] font-sans flex flex-col">
      {/* Sticky case bar */}
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          {/* Row 1 (mobile) / Left (desktop): back button, case_id, dispute type */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/review"
              aria-label="Back to queue"
              className="text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E84360]/40 inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold text-[#1F2937] truncate">{caseId}</h1>
              <p className="text-[12px] text-[#6B7280] truncate">
                {reviewCase ? disputeTypeLabel(reviewCase.dispute_type) : "Loading\u2026"}
              </p>
            </div>
            {isLoading && (
              <svg className="animate-spin h-4 w-4 text-[#E84360] shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
          </div>

          {/* Row 2 (mobile) / Right (desktop): priority, SLA, confidence */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {reviewCase && <PriorityBadge tier={reviewCase.priority_level} />}
            {reviewCase && !resolved && (
              <SlaBar
                deadline={reviewCase.sla_deadline}
                totalSeconds={reviewCase.sla_total_seconds}
                resolved={resolved}
              />
            )}
            {reviewCase && (
              <ConfidenceMeter score={reviewCase.confidence_score} size={32} />
            )}
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Three-column layout at >= 1024px; stacked below */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <div className="lg:grid lg:grid-cols-[220px_1fr_320px] lg:gap-6">
          {/* Decision rail — right on desktop, first on mobile */}
          <aside className="lg:col-start-3 lg:row-start-1 mb-4 lg:mb-0">
            <div className="lg:sticky lg:top-20">
              <ReviewSlaPanel caseId={caseId} hideDecision={isCleaningCase} />
            </div>
          </aside>

          {/* Phase nav — left on desktop, horizontal scroll tabs on mobile */}
          <aside className="lg:col-start-1 lg:row-start-1 mb-4 lg:mb-0">
            {/* Desktop: vertical nav */}
            <nav className="hidden lg:block">
              <ul className="space-y-0.5">
                {STEPS.map((step, i) => {
                  const isActive = activeTab === step.id;
                  const hasData = eventsByStep[step.id]?.length > 0;
                  return (
                    <li key={step.id}>
                      <button
                        onClick={() => setActiveTab(step.id)}
                        disabled={isLoading || !hasData}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[14px] font-medium rounded-lg transition-colors border-l-2 ${
                          isActive
                            ? "border-l-[#E84360] text-[#1F2937] bg-white"
                            : hasData
                            ? "border-l-transparent text-[#6B7280] hover:bg-white hover:text-[#1F2937]"
                            : "border-l-transparent text-[#9CA3AF] cursor-not-allowed"
                        }`}
                      >
                        <span className="text-[12px] tabular-nums w-4 shrink-0">{i + 1}</span>
                        <span className="truncate">{step.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Mobile: horizontal scrollable tab row */}
            <nav className="lg:hidden">
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
                {STEPS.map((step, i) => {
                  const isActive = activeTab === step.id;
                  const hasData = eventsByStep[step.id]?.length > 0;
                  return (
                    <button
                      key={step.id}
                      onClick={() => setActiveTab(step.id)}
                      disabled={isLoading || !hasData}
                      className={`flex items-center gap-1.5 px-3 py-2 text-[14px] font-medium rounded-lg whitespace-nowrap shrink-0 border-b-2 ${
                        isActive
                          ? "border-b-[#E84360] text-[#1F2937] bg-white"
                          : hasData
                          ? "border-b-transparent text-[#6B7280] bg-white/50 hover:bg-white"
                          : "border-b-transparent text-[#9CA3AF] cursor-not-allowed"
                      }`}
                    >
                      <span className="text-[12px] tabular-nums">{i + 1}</span>
                      <span>{step.name}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </aside>

          {/* Centre content */}
          <section className="lg:col-start-2 lg:row-start-1 min-w-0">
            <div className="lg:max-w-[75ch]">
              {isCleaningCase && caseResult && (
                <div className="mb-6">
                  <HumanReviewDecision
                    caseRef={caseId}
                    mode="live"
                    claimAmount={
                      caseResult.data_sources?.payment_fare_data?.disputed_amount ??
                      caseResult.judge_verdict?.recommended_action?.cleaning_fee_amount ??
                      0
                    }
                    recommendedAction={caseResult.judge_verdict?.recommended_action ?? null}
                    reviewer={
                      reviewCase?.support ?? (user ? { id: user.party_id, name: user.name } : null)
                    }
                    riderId={caseResult.case_metadata?.rider_id}
                    driverId={caseResult.case_metadata?.driver_id}
                    link={link}
                  />
                </div>
              )}
              {error ? (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[14px]">
                  {error}
                </div>
              ) : isLoading ? (
                <div className="flex flex-col items-center justify-center text-[#9CA3AF] py-16">
                  <span className="loading-spinner mb-4"></span>
                  Fetching case data&hellip;
                </div>
              ) : activeEvents.length === 0 ? (
                <div className="flex items-center justify-center text-[#9CA3AF] text-[14px] py-16">
                  No data available for this phase
                </div>
              ) : (
                <div className="space-y-6">
                  {activeEvents.map((event, idx) => {
                    const data = asRecord(event.data);
                    if (isAgentConversation(event)) {
                      return <AgentMessageCard key={idx} event={event} />;
                    }

                    if (event.event_type === "PHASE_COMPLETED" && data) {
                      switch (activeTab) {
                        case "CASE_SUMMARY":
                          return <CaseSummaryView key={idx} data={data} />;
                        case "INIT_CLAIM":
                          return (
                            <Panel key={idx} title="Case basic information">
                              <DataView value={data} skip={["status"]} />
                            </Panel>
                          );
                        case "ROUND_1_STATEMENTS":
                          return <Round1StatementsView key={idx} data={data} />;
                        case "ROUND_2_CROSS_EXAM": {
                          const crossSource = asRecord(data?.round_2_cross_exam) ?? data;
                          const fbQuestions = Array.isArray(crossSource?.targeted_questions) ? crossSource!.targeted_questions : [];
                          const fbResponses = Array.isArray(crossSource?.targeted_responses) ? crossSource!.targeted_responses : [];
                          return <CrossExamTranscript key={idx} questions={fbQuestions} responses={fbResponses} />;
                        }
                        case "ROUND_2_REPORT":
                          return (
                            <ProsecutorView
                              key={idx}
                              title="Prosecutor final report"
                              findings={asRecord(data.prosecutor_findings)}
                              bonus={asRecord(data.bonus_modules)}
                            />
                          );
                        case "POLICY_CONSULTATION":
                          return <PolicyView key={idx} data={data} />;
                        case "JUDGE_DELIBERATION":
                          return <JudgeView key={idx} data={data} />;
                        case "EXECUTION_ROUTER":
                          return <ExecutionView key={idx} data={data} />;
                        default:
                          return null;
                      }
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
