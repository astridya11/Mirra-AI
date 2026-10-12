"use client";

/**
 * DebugProcessView — Modern Enterprise SaaS Dashboard UI
 * 
 * Auto-loads case data on mount and displays it in a clean, tabbed dashboard.
 * Primary accent color: #E84360. 
 * Light theme, shadowless cards, clean borders.
 */

import React, { useEffect, useMemo, useState } from "react";
import { getCompletedResult } from "@/src/lib/api"; 
import { useParams } from "next/navigation";
import ReviewSlaPanel from "@/src/components/ReviewSlaPanel";
import { HumanDecision } from "@/src/components/review/HumanDecision";
import { ImageEvidence } from "@/src/components/review/ImageEvidence";
import { confidenceLabel, judgeConfidence, reasonLabel } from "@/src/components/review/reviewModel";
import { enumLabel, useI18n, type Translator } from "@/src/i18n";
import { en } from "@/src/i18n/en";
import { RawText } from "@/src/i18n/RawText";
import type { MessageKey } from "@/src/i18n/en";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";

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
  { id: "CASE_SUMMARY", name: "Case Summary" },
  { id: "INIT_CLAIM", name: "Dispute Filed" },
  { id: "ROUND_1_STATEMENTS", name: "Round 1 Statements"},
  { id: "ROUND_2_CROSS_EXAM", name: "Cross Examination" },
  { id: "ROUND_2_REPORT", name: "Final Audit Report" },
  { id: "POLICY_CONSULTATION", name: "Policy & Precedent Research" },
  { id: "JUDGE_DELIBERATION", name: "Judge Deliberation" },
  { id: "EXECUTION_ROUTER", name: "Execution Router" },
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

/** Field labels come from the i18n dictionary (rf.<field>); unknown keys show as-is. */
const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b(id|ids|url|ocr|gps|ai|kmh)\b/gi, (w) => w.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
const label = (k: string, t: Translator) => (`rf.${k}` in en ? t(`rf.${k}` as MessageKey) : humanize(k));
/** ISO timestamps from the backend, shown in local time (raw value in the tooltip). */
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const isNested = (v: unknown) =>
  !!v && typeof v === "object" && (Array.isArray(v) ? v.some((x) => x !== null && typeof x === "object") : Object.keys(v as object).length > 0);
/** Enum-looking backend tokens get a display label; the raw value stays in the tooltip. */
const EnumText: React.FC<{ value: unknown }> = ({ value }) => {
  const { t } = useI18n();
  const v = String(value ?? "");
  return <span title={v}>{/^[A-Z][A-Z0-9_]+$/.test(v) ? enumLabel(t, v) : v}</span>;
};
/** Backend free text: long sentences go through RawText (AI translation in the Chinese UI). */
const isProse = (v: string) => v.length > 40 && /\s/.test(v) && !v.trim().startsWith("{");

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

const ROLE_STYLE: Record<"prosecutor" | "rider" | "driver" | "other", { box: string; title: MessageKey }> = {
  prosecutor: {
    box: "bg-blue-50/50 border-blue-200 text-blue-900",
    title: "rd.role.prosecutor",
  },
  rider: {
    box: "bg-purple-50/50 border-purple-200 text-purple-900",
    title: "rd.role.rider",
  },
  driver: {
    box: "bg-emerald-50/50 border-emerald-200 text-emerald-900",
    title: "rd.role.driver",
  },
  other: {
    box: "bg-gray-50 border-gray-200 text-gray-900",
    title: "rd.role.other",
  },
};

function roleOf(speaker: string): keyof typeof ROLE_STYLE {
  const s = speaker.toUpperCase();
  if (s.includes("PROSECUTOR") || speaker.includes("检察官")) return "prosecutor";
  if (s.includes("RIDER") || speaker.includes("乘客")) return "rider";
  if (s.includes("DRIVER") || speaker.includes("司机")) return "driver";
  return "other";
}

function roleName(raw: string, t: Translator): string {
  const r = roleOf(raw);
  if (r === "prosecutor") return t("agent.prosecutor.name");
  if (r === "rider") return t("agent.rider.name");
  if (r === "driver") return t("agent.driver.name");
  return raw || "—";
}

// ==========================================
// GENERIC DATA RENDERER (Light Theme)
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

const DataView: React.FC<{ value: any; skip?: string[]; depth?: number }> = ({ value, skip = [], depth = 0 }) => {
  const { t } = useI18n();
  if (value === null || value === undefined || value === "") {
    return <span className="text-gray-400">—</span>;
  }
  if (typeof value === "boolean") {
    return <Chip tone={value ? "primary" : "gray"}>{t(value ? "common.yes" : "common.no")}</Chip>;
  }
  if (typeof value === "number") {
    return <span className="text-gray-900 font-mono">{value}</span>;
  }
  if (typeof value === "string") {
    if (ISO_TS.test(value) && !Number.isNaN(Date.parse(value)))
      return (
        <span className="text-gray-800 tabular-nums" title={value}>
          {new Date(value).toLocaleString()}
        </span>
      );
    if (isProse(value)) return <RawText as="span" text={value} className="text-gray-800 whitespace-pre-wrap leading-relaxed" />;
    return (
      <span className="text-gray-800 whitespace-pre-wrap leading-relaxed">
        <EnumText value={value} />
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-400">{t("rd.empty")}</span>;
    const allPrimitive = value.every((v) => v === null || typeof v !== "object");
    if (allPrimitive) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <Chip key={i}>
              <EnumText value={v} />
            </Chip>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50/50">
            <DataView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const obj = value as Rec;
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (entries.length === 0) return <span className="text-gray-400">{t("rd.empty")}</span>;
  return (
    <dl className="space-y-2.5">
      {entries.map(([k, v]) =>
        isNested(v) ? (
          <div key={k} className="space-y-1.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-500" title={k}>
              {label(k, t)}
            </dt>
            <dd className="min-w-0 border-l-2 border-gray-100 pl-3">
              <DataView value={v} depth={depth + 1} />
            </dd>
          </div>
        ) : (
          <div key={k} className="grid grid-cols-[minmax(7rem,30%)_minmax(0,1fr)] gap-x-4 items-baseline">
            <dt className="text-gray-500 font-medium [overflow-wrap:anywhere]" title={k}>
              {label(k, t)}
            </dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              <DataView value={v} depth={depth + 1} />
            </dd>
          </div>
        ),
      )}
    </dl>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  return (
    <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-4 text-sm">
      <div className="font-semibold text-gray-900 border-b border-gray-100 pb-2">{title}</div>
      <div className="text-gray-700 space-y-4">{children}</div>
    </div>
  );
};

const RawJson: React.FC<{ value: any; summary?: string }> = ({ value, summary }) => (
  <details className="text-[11px] text-gray-500 group">
    <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors select-none">
      {summary ?? <RawJsonLabel />}
    </summary>
    <pre className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-lg overflow-x-auto text-gray-600 font-mono text-[10px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  </details>
);

function RawJsonLabel() {
  const { t } = useI18n();
  return <>{t("rd.viewRaw")}</>;
}

// ==========================================
// AGENT 对话卡片
// ==========================================

const AgentMessageCard: React.FC<{ event: FeedEvent }> = ({ event }) => {
  const msg = normalizeMessage(event);
  const role = roleOf(msg.speaker);
  const style = ROLE_STYLE[role];
  const isQuestion = msg.messageType === "QUESTION";
  const isResponse = msg.messageType === "RESPONSE";
  const inCrossExam = event.sub_phase === "CROSS_EXAM" || isQuestion || isResponse;
  const indent = isResponse ? "ml-6 md:ml-12" : "";
  const { t } = useI18n();

  return (
    <div className={`my-4 ${indent}`}>
      <div className={`p-4 rounded-xl border ${style.box}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-black/5">
          <span className="font-semibold text-sm flex flex-wrap items-center gap-2">
            {role === "other" ? `🤖 ${msg.speaker}` : t(style.title)}
            {inCrossExam && msg.messageType && (
              <Chip tone={isQuestion ? "primary" : "green"}>
                {t(isQuestion ? "rd.question" : "rd.response")}
                {msg.turn !== undefined ? t("rd.round", { n: msg.turn }) : ""}
              </Chip>
            )}
            {msg.target && (
              <span className="text-xs font-normal text-gray-500">
                {t(isQuestion ? "rd.directedTo" : "rd.respondingTo")}
                {roleName(msg.target, t)}
              </span>
            )}
          </span>
          {event.timestamp && <span className="text-xs text-gray-400">{formatTime(event.timestamp)}</span>}
        </div>

        <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
          {msg.text ? (
            isProse(msg.text) ? <RawText as="div" text={msg.text} /> : msg.text
          ) : (
            <span className="italic text-gray-400">{t("rd.noText")}</span>
          )}
        </div>

        {isQuestion && (msg.category || msg.evidenceContext) && (
          <div className="mt-4 pt-3 border-t border-black/5 text-xs space-y-2 text-gray-600 bg-white/50 rounded-lg p-3">
            {msg.category && msg.category !== "OTHER" && (
              <div>
                <span className="text-gray-500 font-medium mr-2">{t("rd.category")}</span>
                <EnumText value={msg.category} />
              </div>
            )}
            {msg.evidenceContext && (
              <div>
                <span className="text-gray-500 font-medium mr-2">{t("rd.evidenceContext")}</span>
                <RawText as="span" text={msg.evidenceContext} raw={isProse(msg.evidenceContext)} />
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          <RawJson value={msg.raw} summary={t("rd.agentRaw")} />
        </div>
      </div>
    </div>
  );
};

const CrossExamTranscript: React.FC<{ questions: Rec[]; responses: Rec[] }> = ({ questions, responses }) => {
  const { t } = useI18n();
  if (questions.length === 0) {
    return (
      <div className="my-4 p-4 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500 text-center">
        {t("rd.noQuestions")}
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
// 各阶段结果视图
// ==========================================

const FactList: React.FC<{ title: string; facts: any[]; tone: "green" | "amber" | "red" }> = ({ title, facts, tone }) => (
  <div className="mt-4">
    <div className="text-gray-700 font-medium mb-2 flex items-center gap-2">
      {title} <Chip tone={tone}>{facts.length}</Chip>
    </div>
    <ul className="space-y-2">
      {facts.map((f, i) => {
        const rec = asRecord(f);
        const text = rec ? firstText(rec, ["description", "fact", "text", "content"]) : String(f);
        return (
          <li key={rec?.fact_id ?? i} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-gray-700">
            {rec?.fact_id && <span className="text-gray-400 mr-2 font-mono text-xs">{rec.fact_id}</span>}
            {text ? <RawText as="span" text={text} raw={isProse(text)} /> : <DataView value={rec} />}
          </li>
        );
      })}
    </ul>
  </div>
);

const Round1StatementsView: React.FC<{ data: Rec }> = ({ data }) => {
  const statementsObj = data.round_1_statements || data.statements || data;
  const riderStmt = asRecord(statementsObj.rider_statement) || asRecord(statementsObj.RIDER) || asRecord(Array.isArray(statementsObj) ? statementsObj.find((x: any) => x?.party === "RIDER" || x?.agent_role === "RIDER_ADVOCATE") : null);
  const { t } = useI18n();
  const driverStmt = asRecord(statementsObj.driver_statement) || asRecord(statementsObj.DRIVER) || asRecord(Array.isArray(statementsObj) ? statementsObj.find((x: any) => x?.party === "DRIVER" || x?.agent_role === "DRIVER_ADVOCATE") : null);

  const renderStatementCard = (stmt: Rec | null, role: "rider" | "driver") => {
    if (!stmt) return null;
    const style = ROLE_STYLE[role];
    const outcome = stmt.requested_outcome;
    const amount = stmt.requested_amount;
    const currency = stmt.currency || "SGD";
    const evidenceRefs = Array.isArray(stmt.evidence_references) ? stmt.evidence_references : [];

    return (
      <div className={`p-5 rounded-xl border ${style.box} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-base">{t(style.title)}</span>
            <Chip tone={role === "rider" ? "primary" : "green"}>{t(role === "rider" ? "agent.rider.name" : "agent.driver.name")}</Chip>
          </div>
          {outcome && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">{t("rd.requested")}</span>
              <Chip tone="primary">
                <EnumText value={outcome} /> {amount !== undefined && amount !== null ? `($${amount} ${currency})` : ""}
              </Chip>
            </div>
          )}
        </div>

        {stmt.argument_summary && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{t("rd.argSummary")}</div>
            <RawText as="div" text={String(stmt.argument_summary)} className="p-3.5 rounded-lg bg-white/80 border border-black/5 text-gray-800 text-sm leading-relaxed font-medium" />
          </div>
        )}

        {stmt.detailed_argument && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{t("rd.detailedArg")}</div>
            <RawText
              as="div"
              text={String(stmt.detailed_argument)}
              className="p-3.5 rounded-lg bg-white/60 border border-black/5 text-gray-700 text-sm leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto"
            />
          </div>
        )}

        {evidenceRefs.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
              <span>{t("rd.citedEvidence")}</span>
              <Chip tone="gray">{evidenceRefs.length}</Chip>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {evidenceRefs.map((ev: any, i: number) => {
                const evRec = asRecord(ev);
                const evId = evRec?.evidence_id || `EV-${i}`;
                const sourceType = evRec?.source_type || "EVIDENCE";
                const desc = evRec?.description || String(ev);
                return (
                  <div key={i} className="p-2.5 rounded-lg bg-white/70 border border-black/5 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-semibold text-gray-900">{evId}</span>
                      <Chip tone="blue">
                        <EnumText value={sourceType} />
                      </Chip>
                    </div>
                    <RawText text={desc} raw={isProse(desc)} className="text-gray-600 line-clamp-3" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stmt.submitted_at && (
          <div className="text-[11px] text-gray-400 text-right pt-2 border-t border-black/5">
            {t("rd.submittedAt", { time: new Date(stmt.submitted_at).toLocaleString() })}
          </div>
        )}
      </div>
    );
  };

  if (!riderStmt && !driverStmt) {
    return (
      <Panel title={t("rd.r1Title")}>
        <div className="text-gray-400 italic text-center p-6 bg-gray-50 rounded-lg">{t("rd.noR1")}</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 flex items-center gap-3">
        <span className="text-blue-600 text-lg">⚖️</span>
        <div>
          <span className="font-bold text-blue-900 text-sm">{t("rd.r1Overview")}</span>
          <p className="text-xs text-blue-700 mt-0.5">{t("rd.r1OverviewSub")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderStatementCard(riderStmt, "rider")}
        {renderStatementCard(driverStmt, "driver")}
      </div>

      <div className="pt-2">
        <RawJson value={data} summary={t("rd.r1Raw")} />
      </div>
    </div>
  );
};

const ProsecutorView: React.FC<{ findings: Rec | null; bonus: Rec | null; title: string }> = ({
  findings,
  bonus,
  title,
}) => {
  const { t } = useI18n();
  const factKeys: [string, "green" | "amber" | "red"][] = [
    ["verified_facts", "green"],
    ["disputed_facts", "amber"],
    ["missing_facts", "red"],
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
              <div className="text-gray-500 font-medium mb-2">{label("prosecutor_summary", t)}</div>
              <RawText text={findings.prosecutor_summary} className="p-4 rounded-lg bg-blue-50/50 border border-blue-100 leading-relaxed text-gray-800" />
            </div>
          )}
          {factKeys.map(
            ([k, tone]) =>
              Array.isArray(findings[k]) && findings[k].length > 0 && <FactList key={k} title={label(k, t)} facts={findings[k]} tone={tone} />
          )}
          {Object.keys(findings).some((k) => !shown.includes(k) && !isEmpty(findings[k])) && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <DataView value={findings} skip={shown} />
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-400 italic p-4 text-center bg-gray-50 rounded-lg">{t("rd.noFindings")}</div>
      )}

      {escalation && (
        <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <span className="text-gray-600 font-medium">{t("rd.riskSignals")}</span>
          {fraud && <Chip tone={fraud === "HIGH" ? "red" : fraud === "MEDIUM" ? "amber" : "green"}>{t("rd.fraudRisk", { level: enumLabel(t, fraud) })}</Chip>}
          {escalation.safety_threat_detected && <Chip tone="red">{label("safety_threat_detected", t)}</Chip>}
          {escalation.missing_crucial_evidence && <Chip tone="amber">{label("missing_crucial_evidence", t)}</Chip>}
          {!escalation.safety_threat_detected && !escalation.missing_crucial_evidence && fraud !== "HIGH" && (
            <Chip tone="green">{t("rd.noEscalation")}</Chip>
          )}
        </div>
      )}
      {bonus && !isEmpty(bonus) && (
        <div className="mt-4">
          <RawJson value={bonus} summary={t("rd.bonusRaw")} />
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
  const { t } = useI18n();
  if (typeof suggestion === "string") {
    return <RawText text={suggestion} className="p-4 rounded-lg bg-gray-50 border border-gray-100 leading-relaxed text-gray-800" />;
  }
  const s = asRecord(suggestion);
  if (!s || isEmpty(s)) {
    return <div className="text-gray-400 italic text-center p-4">{t("rd.noPolicy")}</div>;
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
        <div className="p-4 rounded-xl border border-[#E84360]/20 bg-[#E84360]/5 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-[#E84360]">{t("rd.suggestedRuling")}</span>
          {ruling && (
            <Chip tone="primary">
              <EnumText value={ruling[1]} />
            </Chip>
          )}
          {conf && (
            <span className="text-gray-600 text-sm">
              {t("rd.confidence")} <span className="font-mono text-gray-900 font-medium">{String(conf[1])}</span>
            </span>
          )}
        </div>
      )}

      {action && (
        <div>
          <div className="text-gray-500 font-medium mb-2">{label("recommended_action", t)}</div>
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <DataView value={action[1]} />
          </div>
        </div>
      )}

      {reason && (
        <div>
          <div className="text-gray-500 font-medium mb-2">{t("rd.rationale")}</div>
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100 leading-relaxed text-gray-800">
            {typeof reason[1] === "string" ? <RawText as="div" text={reason[1]} /> : <DataView value={reason[1]} />}
          </div>
        </div>
      )}

      {clauses && Array.isArray(clauses[1]) && (
        <div>
          <div className="text-gray-500 font-medium mb-2 flex items-center gap-2">
            {t("rd.clauses")} <Chip tone="blue">{clauses[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {clauses[1].map((c: any, i: number) => {
              const rec = asRecord(c);
              if (!rec) return <div key={i} className="p-3 rounded-lg bg-gray-50 border border-gray-100">{String(c)}</div>;
              const body = firstText(rec, ["clause_text", "clause_text_summary", "content", "text", "description", "summary"]);
              const why = firstText(rec, ["relevance", "relevance_summary", "relevance_reason", "reason", "rationale"]);
              const shownKeys = ["clause_id", "title", "clause_title", "clause_text", "clause_text_summary", "content", "text", "description", "summary", "relevance", "relevance_summary", "relevance_reason", "reason", "rationale"];
              return (
                <div key={rec.clause_id ?? i} className="p-4 rounded-lg bg-white border border-gray-200 shadow-sm">
                  <div className="font-semibold text-gray-900">
                    {rec.clause_id && <span className="font-mono text-gray-400 mr-2 text-xs">{rec.clause_id}</span>}
                    {rec.title ?? rec.clause_title ?? (rec.clause_id ? "" : t("rd.clauseN", { n: i + 1 }))}
                  </div>
                  {body && <RawText as="div" text={body} raw={isProse(body)} className="text-gray-700 mt-2 leading-relaxed whitespace-pre-wrap" />}
                  {why && (
                    <div className="text-gray-600 mt-3 p-3 bg-gray-50 rounded text-sm">
                      {t("rd.relevance")}
                      <RawText as="span" text={why} raw={isProse(why)} />
                    </div>
                  )}
                  {Object.keys(rec).some((k) => !shownKeys.includes(k) && !isEmpty(rec[k])) && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
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
          <div className="text-gray-500 font-medium mb-2 flex items-center gap-2">
            {t("rd.precedents")} <Chip tone="gray">{precedents[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {precedents[1].map((p: any, i: number) => (
              <div key={i} className="p-4 rounded-lg bg-white border border-gray-200 shadow-sm text-gray-700">
                {typeof p === "string" ? <RawText as="div" text={p} raw={isProse(p)} /> : <DataView value={p} depth={1} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(s).some((k) => !used.includes(k) && !isEmpty(s[k])) && (
        <div className="pt-4 border-t border-gray-100">
          <DataView value={s} skip={used} />
        </div>
      )}
    </div>
  );
};

const PolicyView: React.FC<{ data: Rec }> = ({ data }) => {
  const request = asRecord(data.request);
  const { t } = useI18n();
  return (
    <Panel title={t("rd.policyTitle")}>
      <PolicySuggestionView suggestion={data.suggestion} />
      {request && (
        <details className="mt-4 text-[11px] text-gray-500">
          <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors">
            {t("rd.policyRequest")}
          </summary>
          <div className="mt-2 p-4 rounded-lg bg-gray-50 border border-gray-100">
            <DataView value={request} />
          </div>
        </details>
      )}
      <div className="mt-2">
        <RawJson value={data} summary={t("rd.policyRaw")} />
      </div>
    </Panel>
  );
};

const JudgeView: React.FC<{ data: Rec }> = ({ data }) => {
  const action = asRecord(data.recommended_action);
  const { t } = useI18n();
  return (
    <Panel title={t("rd.judgeTitle")}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.ruling_type && (
          <Chip tone="primary">
            <EnumText value={data.ruling_type} />
          </Chip>
        )}
        {data.confidence_score !== undefined && (
          <Chip tone={(judgeConfidence(data) ?? 0) >= 0.75 ? "green" : "amber"}>
            {t("rd.confidenceN", { c: confidenceLabel(judgeConfidence(data), t) })}
          </Chip>
        )}
      </div>
      {action && (
        <div className="mb-4 p-4 rounded-lg bg-gray-50 border border-gray-100">
          <DataView value={action} />
        </div>
      )}
      {typeof data.reasoning_summary === "string" && data.reasoning_summary && (
        <div>
          <div className="text-gray-500 font-medium mb-2">{label("reasoning_summary", t)}</div>
          <RawText text={data.reasoning_summary} className="p-4 rounded-lg bg-blue-50/50 border border-blue-100 leading-relaxed text-gray-800" />
        </div>
      )}
      {asRecord(data.explanations) && (
        <div className="grid gap-3 md:grid-cols-2">
          {(["explanation_for_rider", "explanation_for_driver"] as const).map(
            (k) =>
              typeof data.explanations[k] === "string" &&
              data.explanations[k] && (
                <div key={k} className="rounded-lg border border-gray-200 p-4">
                  <div className="text-gray-500 font-medium mb-2">{label(k, t)}</div>
                  <RawText text={data.explanations[k]} className="leading-relaxed text-gray-800" />
                </div>
              ),
          )}
        </div>
      )}
      <DataView
        value={data}
        skip={["ruling_type", "confidence_score", "recommended_action", "reasoning_summary", "explanations", "verified_fact_references", "policy_clauses_applied", "precedent_references", "execution_payload"]}
      />
    </Panel>
  );
};

const ExecutionView: React.FC<{ data: Rec }> = ({ data }) => {
  const escalated = data.route === "ESCALATED_HUMAN_REVIEW";
  const { t } = useI18n();
  return (
    <Panel title={t("rd.execTitle")}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.route && (
          <Chip tone={escalated ? "amber" : "green"}>
            <EnumText value={data.route} />
          </Chip>
        )}
        {data.confidence_score !== undefined && <Chip>{t("rd.confidenceN", { c: confidenceLabel(data.confidence_score, t) })}</Chip>}
      </div>
      {Array.isArray(data.escalation_reasons) && data.escalation_reasons.length > 0 && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-100">
          <div className="text-amber-800 font-medium mb-2">{t("rd.escReasons")}</div>
          <ul className="list-disc list-inside space-y-1 text-amber-700">
            {data.escalation_reasons.map((r: string, i: number) => (
              <li key={i}>
                <RawText as="span" text={reasonLabel(r, t)} raw={reasonLabel(r, t) === r} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <DataView value={data} skip={["route", "confidence_score", "escalation_reasons"]} />
    </Panel>
  );
};

// ==========================================
// CASE SUMMARY VIEW (Added for Human Support at first glance)
// ==========================================

const CaseSummaryView: React.FC<{ data: Rec }> = ({ data }) => {
  const metadata = asRecord(data.case_metadata) || {};
  const claim = asRecord(data.dispute_claim) || {};
  const bonus = asRecord(data.bonus_modules) || {};
  const escalation = asRecord(bonus.escalation_protocol) || {};
  const verdict = asRecord(data.judge_verdict) || {};
  const action = asRecord(verdict.recommended_action) || {};

  const reasons = escalation.escalation_reasons || [];
  const priority = escalation.priority_level || "STANDARD";
  const confidence = judgeConfidence(verdict);
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-[#E84360]/20 bg-[#E84360]/5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-[#E84360] animate-pulse"></span>
          <div>
            <span className="font-bold text-gray-900 text-base">{t("rd.sumTitle")}</span>
            <p className="text-xs text-gray-500 mt-0.5">{t("rd.sumSub")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={priority === "URGENT" ? "red" : priority === "HIGH_PRIORITY" ? "amber" : "primary"}>
            {t("rd.priority", { p: enumLabel(t, priority) })}
          </Chip>
          <Chip tone={(confidence ?? 0) >= 0.75 ? "green" : "amber"}>
            {t("rd.confidenceColon", { c: confidenceLabel(confidence, t) })}
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
          <div className="font-semibold text-gray-900 border-b border-gray-100 pb-2">
            {t("rd.basicInfo")}
          </div>
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.disputeType")}</span>
              <span className="font-medium text-gray-800">
                <EnumText value={metadata.dispute_type || claim.dispute_type || "—"} />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.riderId")}</span>
              <span className="font-mono text-gray-800">{metadata.rider_id || claim.rider_id || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.driverId")}</span>
              <span className="font-mono text-gray-800">{metadata.driver_id || claim.driver_id || "—"}</span>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <span className="text-gray-500 block mb-1">{t("rd.description")}</span>
              {claim.description || metadata.description ? (
                <RawText
                  text={String(claim.description || metadata.description)}
                  className="text-gray-700 bg-gray-50 p-3 rounded-lg text-xs leading-relaxed max-h-32 overflow-y-auto"
                />
              ) : (
                <p className="text-gray-700 bg-gray-50 p-3 rounded-lg text-xs leading-relaxed">{t("rd.noDescription")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
          <div className="font-semibold text-gray-900 border-b border-gray-100 pb-2">
            {t("rd.verdictActions")}
          </div>
          <div className="text-sm space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">{t("rd.suggestedRulingType")}</span>
              <Chip tone="primary">
                <EnumText value={verdict.ruling_type || verdict.suggested_ruling_type || "—"} />
              </Chip>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.refundAmount")}</span>
              <span className="font-mono font-medium text-gray-900">${action.refund_amount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.cleaningAmount")}</span>
              <span className="font-mono font-medium text-gray-900">${action.cleaning_fee_amount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t("rd.accountAction")}</span>
              <span className="font-medium text-gray-900">
                <EnumText value={action.account_action || "NONE"} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {Array.isArray(reasons) && reasons.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2">
          <div className="font-semibold text-amber-900">
            {t("rd.escTitle")}
          </div>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-800">
            {reasons.map((r: string, i: number) => (
              <li key={i}>
                <RawText as="span" text={reasonLabel(r, t)} raw={reasonLabel(r, t) === r} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* {findings.prosecutor_summary && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-2">
          <div className="font-semibold text-blue-900">
            🔍 Prosecutor Core Audit Summary
          </div>
          <p className="text-sm text-blue-900 leading-relaxed">
            {findings.prosecutor_summary}
          </p>
        </div>
      )} */}

      {verdict.reasoning_summary && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-2">
          <div className="font-semibold text-blue-900">
            {t("rd.judgeSummary")}
          </div>
          <RawText text={String(verdict.reasoning_summary)} className="text-sm text-blue-900 leading-relaxed" />
        </div>
      )}
    </div>
  );
};

// ==========================================
// COMPONENT
// ==========================================

export default function CustomerSupportCaseViewPage() {
  const params = useParams();
  const caseId = (params?.caseId as string) || "";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [activeTab, setActiveTab] = useState<StepKey>("CASE_SUMMARY");
  const { t } = useI18n();
  const stepLabel = (id: StepKey) => t(`rstep.${id}` as MessageKey);

  useEffect(() => {
    if (!caseId) return;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getCompletedResult(caseId);
        if (!result) throw new Error("API did not return valid data (Empty Response)");

        const synthesizedEvents: FeedEvent[] = [];

        // 0. CASE_SUMMARY (Added for executive overview at first glance)
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "CASE_SUMMARY",
          data: result,
        });

        // 1. INIT_CLAIM
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "INIT_CLAIM",
          label: "Dispute Filed",
          data: {
            ...result.case_metadata,
            ...result.dispute_claim,
            ...result.data_sources,
          },
        });

        // 2. Round 1 Statements
        const statements = result.agent_conversation?.filter((m: any) => m.message_type === "STATEMENT") || [];
        // statements.forEach((msg: any) => {
        //   synthesizedEvents.push({
        //     event_type: "AGENT_CONVERSATION",
        //     phase: "ROUND_1_STATEMENTS",
        //     speaker: msg.speaker,
        //     message_type: msg.message_type,
        //     timestamp: msg.timestamp,
        //     data: msg,
        //   });
        // });
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_1_STATEMENTS",
          data: result.round_1_statements ?? { statements },
        });

        // 3. ROUND 2 INITIAL AUDIT, commented because case metadata only keep the final report
        // synthesizedEvents.push({
        //   event_type: "PHASE_COMPLETED",
        //   phase: "ROUND_2_PROSECUTOR_AUDIT",
        //   sub_phase: "INITIAL_AUDIT",
        //   data: {
        //     prosecutor_findings: result.prosecutor_findings,
        //     bonus_modules: result.bonus_modules,
        //   },
        // });

        // 4. ROUND 2 CROSS EXAM
        const crossExams = result.agent_conversation?.filter((m: any) => m.message_type !== "STATEMENT") || [];
        // crossExams.forEach((msg: any) => {
        //   synthesizedEvents.push({
        //     event_type: "AGENT_CONVERSATION",
        //     phase: "ROUND_2_PROSECUTOR_AUDIT",
        //     sub_phase: "CROSS_EXAM",
        //     speaker: msg.speaker,
        //     message_type: msg.message_type,
        //     timestamp: msg.timestamp,
        //     data: msg,
        //   });
        // });
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_2_PROSECUTOR_AUDIT",
          sub_phase: "CROSS_EXAM",
          data: { round_2_cross_exam: result.round_2_cross_exam },
        });

        // 5. ROUND 2 FINAL REPORT
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

        // 6. POLICY CONSULTATION
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "POLICY_CONSULTATION",
          data: result.policy_consultation,
        });

        // 7. JUDGE DELIBERATION
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "JUDGE_DELIBERATION",
          data: result.judge_verdict,
        });

        // 8. EXECUTION ROUTER
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "EXECUTION_ROUTER",
          data: {
            route: result.case_metadata?.resolution_channel,
            confidence_score: judgeConfidence(result.judge_verdict),
            escalation_reasons: result.bonus_modules?.escalation_protocol?.escalation_reasons,
            ...result.judge_verdict?.execution_payload,
          },
        });

        setEvents(synthesizedEvents);
      } catch (err) {
        setError("rd.fetchError");
        console.error("Fetch complete result error:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [caseId]);

  // 区分事件到对应的 Step
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

  const activeEvents = eventsByStep[activeTab] || [];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="w-2 h-6 bg-[#E84360] rounded-sm inline-block"></span>
              MIRRA AI <span className="text-gray-400 font-normal">|</span> {t("review.title")}
            </h1>
            <p className="text-sm text-gray-500 mt-1 ml-4">{t("review.caseIdLine", { caseId })}</p>
          </div>
          <LanguageSwitch compact />
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="animate-spin h-4 w-4 text-[#E84360]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t("review.loadingData")}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col md:flex-row gap-8">
        
        {/* 左侧 Tabs 导航 */}
        <aside className="md:w-64 flex-shrink-0">
          <div className="sticky top-24 space-y-4">
            <ReviewSlaPanel caseId={caseId} />
          <nav className="space-y-1">
            {STEPS.map((step) => {
              const isActive = activeTab === step.id;
              const hasData = eventsByStep[step.id]?.length > 0;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveTab(step.id)}
                  disabled={isLoading || !hasData}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                    isActive
                      ? "bg-[#E84360]/10 text-[#E84360] border border-[#E84360]/20"
                      : hasData
                      ? "text-gray-600 hover:bg-gray-100 border border-transparent"
                      : "text-gray-400 cursor-not-allowed border border-transparent"
                  }`}
                >
                  <span className="truncate">{stepLabel(step.id)}</span>
                  {hasData && isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#E84360]"></span>}
                </button>
              );
            })}
          </nav>
          </div>
        </aside>

        {/* 右侧内容区 */}
        <section className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8 min-h-[600px]">
          {error ? (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {t("rd.fetchError")}
            </div>
          ) : isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="loading-spinner mb-4"></span>
              {t("review.fetching")}
            </div>
          ) : activeEvents.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              {t("review.noPhaseData")}
            </div>
          ) : (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-4 mb-6">
                {stepLabel(activeTab)}
              </h2>
              {activeEvents.map((event, idx) => {
                const data = asRecord(event.data);
                if (isAgentConversation(event)) {
                  return <AgentMessageCard key={idx} event={event} />;
                }
                
                // 处理 PHASE_COMPLETED 的具体渲染逻辑
                if (event.event_type === "PHASE_COMPLETED" && data) {
                  switch (activeTab) {
                    case "CASE_SUMMARY":
                      return <CaseSummaryView key={idx} data={data} />;
                    case "INIT_CLAIM":
                      return (
                        <Panel key={idx} title={t("rd.caseBasic")}>
                          <DataView value={data} skip={["status"]} />
                        </Panel>
                      );
                    case "ROUND_1_STATEMENTS":
                      return <Round1StatementsView key={idx} data={data} />;
                    case "ROUND_2_CROSS_EXAM":
                      const crossSource = asRecord(data?.round_2_cross_exam) ?? data;
                      const fbQuestions = Array.isArray(crossSource?.targeted_questions) ? crossSource!.targeted_questions : [];
                      const fbResponses = Array.isArray(crossSource?.targeted_responses) ? crossSource!.targeted_responses : [];
                      return <CrossExamTranscript key={idx} questions={fbQuestions} responses={fbResponses} />;
                    case "ROUND_2_REPORT":
                      return (
                        <ProsecutorView
                          key={idx}
                          title={t("rd.prosFinal")}
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
        </section>
      </main>
      <div className="max-w-7xl w-full mx-auto px-6 pb-12">
        <ImageEvidence caseId={caseId} />
        <HumanDecision caseId={caseId} />
      </div>
    </div>
  );
}