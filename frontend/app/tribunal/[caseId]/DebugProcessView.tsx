"use client";

/**
 * DebugProcessView — the original detailed tribunal debug panel.
 *
 * Preserved under ?debug=1 for development and testing.
 * Shows raw JSON, prosecutor findings, policy suggestions, judge details, etc.
 *
 * This is NOT the user-facing view — see page.tsx for the new minimal UI.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamPipeline } from "@/src/lib/api";
import type { PipelineEvent } from "@/src/types";
import { useParams } from "next/navigation";

// ==========================================
// TYPES
// ==========================================

export type StepKey =
  | "INIT_CLAIM"
  | "ROUND_1_PLEADINGS"
  | "ROUND_2_AUDIT"
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

const STEPS: { id: StepKey; name: string; short: string }[] = [
  { id: "INIT_CLAIM", name: "1. 初始立案申诉", short: "初始立案" },
  { id: "ROUND_1_PLEADINGS", name: "2. 第一轮辩论", short: "第一轮辩论" },
  { id: "ROUND_2_AUDIT", name: "3a. 初始证据审计与欺诈筛查", short: "初始证据审计与欺诈筛查" },
  { id: "ROUND_2_CROSS_EXAM", name: "3b. 交叉质询", short: "交叉质询" },
  { id: "ROUND_2_REPORT", name: "3c. 第二轮调查与检察官报告", short: "第二轮调查与检察官报告" },
  { id: "POLICY_CONSULTATION", name: "4. 政策条款检索", short: "政策条款检索" },
  { id: "JUDGE_DELIBERATION", name: "5. 法官裁决审理", short: "法官裁决审理" },
  { id: "EXECUTION_ROUTER", name: "6. 执行路由分配", short: "执行路由分配" },
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
  status: "状态",
  dispute_type: "纠纷类型",
  rider_id: "乘客 ID",
  driver_id: "司机 ID",
  frozen_at: "证据冻结时间",
  prosecutor_summary: "检察官总结",
  verified_facts: "已核实事实",
  disputed_facts: "存在争议的事实",
  missing_facts: "缺失的事实",
  missing_evidence: "缺失的证据",
  fact_id: "事实编号",
  description: "描述",
  source: "来源",
  fraud_risk_level: "欺诈风险等级",
  fraud_risk_score: "欺诈风险评分",
  escalation_protocol: "升级协议",
  safety_threat_detected: "检测到安全威胁",
  missing_crucial_evidence: "缺少关键证据",
  party_requested_human: "当事人请求人工审核",
  is_escalated: "是否升级",
  escalation_reasons: "升级原因",
  priority_level: "优先级",
  request_id: "请求编号",
  verified_fact_ids: "已核实事实编号",
  requested_at: "请求时间",
  suggested_ruling: "建议裁决",
  suggested_ruling_type: "建议裁决",
  ruling_type: "裁决类型",
  recommended_action: "建议措施",
  suggested_action: "建议措施",
  refund_amount: "退款金额",
  cleaning_fee_amount: "清洁费金额",
  account_action: "账户处理",
  applicable_clauses: "适用条款",
  clause_id: "条款编号",
  clause_text: "条款内容",
  matched_precedents: "匹配判例",
  precedents: "历史判例",
  confidence: "置信度",
  confidence_score: "置信度",
  reasoning: "推理依据",
  rationale: "理由",
  explanation: "裁决说明",
  route: "路由结果",
  requires_human_signoff: "需要人工签核",
  execution_payload: "执行载荷",
  execution_status: "执行状态",
  transaction_id: "交易编号",
  auto_executed_at: "自动执行时间",
  case_final_status: "案件最终状态",
  resolved_at: "结案时间",
  question_text: "问题",
  evidence_context: "相关证据",
  category: "类别",
  directed_to: "质询对象",
};

const label = (k: string) => FIELD_LABELS[k] ?? k;

const PHASE_TO_STEP: Record<string, StepKey> = {
  INIT_CLAIM: "INIT_CLAIM",
  ROUND_1_PLEADINGS: "ROUND_1_PLEADINGS",
  POLICY_CONSULTATION: "POLICY_CONSULTATION",
  JUDGE_DELIBERATION: "JUDGE_DELIBERATION",
  EXECUTION_ROUTER: "EXECUTION_ROUTER",
};

const SUB_PHASE_TO_STEP: Record<string, StepKey> = {
  INITIAL_AUDIT: "ROUND_2_AUDIT",
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

function classifyEvents(events: FeedEvent[]): StepKey[] {
  let stage: "AUDIT" | "CROSS" | "REPORT" = "AUDIT";
  let last: StepKey = "INIT_CLAIM";

  return events.map((e) => {
    const phase = e.phase ?? "";

    if (phase === "ROUND_2_PROSECUTOR_AUDIT" || phase.startsWith("ROUND_2")) {
      if (e.sub_phase && SUB_PHASE_TO_STEP[e.sub_phase]) {
        stage =
          e.sub_phase === "INITIAL_AUDIT" ? "AUDIT" : e.sub_phase === "CROSS_EXAM" ? "CROSS" : "REPORT";
        last = SUB_PHASE_TO_STEP[e.sub_phase];
        return last;
      }
      if (isAgentConversation(e)) stage = "CROSS";
      else if (e.event_type === "PHASE_STARTED" && stage === "CROSS") stage = "REPORT";
      last = stage === "AUDIT" ? "ROUND_2_AUDIT" : stage === "CROSS" ? "ROUND_2_CROSS_EXAM" : "ROUND_2_REPORT";
      return last;
    }

    if (PHASE_TO_STEP[phase]) {
      last = PHASE_TO_STEP[phase];
      return last;
    }

    return last;
  });
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
    box: "bg-amber-950/20 border-amber-500/30 text-amber-100",
    title: "🔍 检察官 Prosecutor",
  },
  rider: {
    box: "bg-blue-950/20 border-blue-500/30 text-blue-100",
    title: "🛵 乘客代理 Rider Advocate",
  },
  driver: {
    box: "bg-emerald-950/20 border-emerald-500/30 text-emerald-100",
    title: "🚗 司机代理 Driver Advocate",
  },
  other: {
    box: "bg-slate-900 border-slate-700 text-slate-200",
    title: "🤖 Agent",
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
  if (r === "prosecutor") return "检察官";
  if (r === "rider") return "乘客代理";
  if (r === "driver") return "司机代理";
  return raw || "—";
}

// ==========================================
// GENERIC DATA RENDERER
// ==========================================

const Chip: React.FC<{ children: React.ReactNode; tone?: "blue" | "amber" | "green" | "red" | "slate" }> = ({
  children,
  tone = "slate",
}) => {
  const tones = {
    blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    red: "bg-red-500/15 text-red-300 border-red-500/30",
    slate: "bg-slate-800 text-slate-300 border-slate-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

const DataView: React.FC<{ value: any; skip?: string[]; depth?: number }> = ({ value, skip = [], depth = 0 }) => {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-500">—</span>;
  }
  if (typeof value === "boolean") {
    return <Chip tone={value ? "amber" : "slate"}>{value ? "是" : "否"}</Chip>;
  }
  if (typeof value === "number") {
    return <span className="text-slate-100 font-mono">{value}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-slate-200 whitespace-pre-wrap leading-5">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">（空）</span>;
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
      <div className="space-y-1.5">
        {value.map((v, i) => (
          <div key={i} className="p-2 rounded border border-slate-700/60 bg-slate-950/50">
            <DataView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const obj = value as Rec;
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (entries.length === 0) return <span className="text-slate-500">（空）</span>;
  return (
    <dl className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className={depth === 0 ? "grid grid-cols-[8.5rem_1fr] gap-x-3" : "grid grid-cols-[7rem_1fr] gap-x-2"}>
          <dt className="text-slate-400">{label(k)}</dt>
          <dd className="min-w-0">
            <DataView value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const Panel: React.FC<{ title: string; tone?: "amber" | "blue" | "slate" | "green"; children: React.ReactNode }> = ({
  title,
  tone = "slate",
  children,
}) => {
  const tones = {
    amber: "bg-amber-950/20 border-amber-500/30 text-amber-300",
    blue: "bg-blue-950/20 border-blue-500/30 text-blue-300",
    green: "bg-emerald-950/20 border-emerald-500/30 text-emerald-300",
    slate: "bg-slate-950/60 border-slate-700/60 text-slate-300",
  };
  return (
    <div className={`p-3 rounded-lg border space-y-2.5 text-xs ${tones[tone]}`}>
      <div className="font-bold text-sm">{title}</div>
      <div className="text-slate-200 space-y-2.5">{children}</div>
    </div>
  );
};

const RawJson: React.FC<{ value: any; summary?: string }> = ({ value, summary = "查看原始数据" }) => (
  <details className="text-[11px] text-slate-500">
    <summary className="cursor-pointer hover:text-slate-300">{summary}</summary>
    <pre className="mt-1 p-2 bg-slate-950/80 rounded overflow-x-auto text-slate-400">
      {JSON.stringify(value, null, 2)}
    </pre>
  </details>
);

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
  const indent = isResponse ? "ml-6 md:ml-10" : "";

  return (
    <div className={`my-3 ${indent}`}>
      <div className={`p-4 rounded-xl border ${style.box}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-white/10">
          <span className="font-semibold text-sm flex flex-wrap items-center gap-2">
            {role === "other" ? `🤖 ${msg.speaker}` : style.title}
            {inCrossExam && msg.messageType && (
              <Chip tone={isQuestion ? "amber" : "green"}>
                {isQuestion ? "质询问题" : "答辩回应"}
                {msg.turn !== undefined ? ` · 第 ${msg.turn} 轮` : ""}
              </Chip>
            )}
            {msg.target && (
              <span className="text-xs font-normal text-slate-400">
                {isQuestion ? "质询对象：" : "回应对象："}
                {roleName(msg.target)}
              </span>
            )}
          </span>
          {event.timestamp && <span className="text-xs text-slate-400">{formatTime(event.timestamp)}</span>}
        </div>

        <div className="text-sm leading-5 whitespace-pre-wrap">
          {msg.text || <span className="italic text-slate-500">（该 Agent 未返回文本内容）</span>}
        </div>

        {isQuestion && (msg.category || msg.evidenceContext) && (
          <div className="mt-3 pt-2 border-t border-white/10 text-xs space-y-1 text-slate-300">
            {msg.category && msg.category !== "OTHER" && (
              <div>
                <span className="text-slate-400">类别：</span>
                {msg.category}
              </div>
            )}
            {msg.evidenceContext && (
              <div>
                <span className="text-slate-400">相关证据：</span>
                {msg.evidenceContext}
              </div>
            )}
          </div>
        )}

        <div className="mt-2">
          <RawJson value={msg.raw} summary="Agent 原始输出" />
        </div>
      </div>
    </div>
  );
};

const CrossExamTranscript: React.FC<{ questions: Rec[]; responses: Rec[] }> = ({ questions, responses }) => {
  if (questions.length === 0) {
    return (
      <div className="my-3 p-3 rounded-lg border border-slate-700 bg-slate-900/60 text-xs text-slate-400">
        检察官本轮没有提出质询问题（generateQuestion 在第 1 轮就返回了 done）。
      </div>
    );
  }
  return (
    <div className="my-2">
      <div className="text-[11px] text-slate-500 mb-1">以下为根据交叉质询记录还原的 Q&amp;A</div>
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
  <div>
    <div className="text-slate-400 mb-1">
      {title} <Chip tone={tone}>{facts.length}</Chip>
    </div>
    <ul className="space-y-1">
      {facts.map((f, i) => {
        const rec = asRecord(f);
        const text = rec ? firstText(rec, ["description", "fact", "text", "content"]) : String(f);
        return (
          <li key={rec?.fact_id ?? i} className="p-2 rounded bg-slate-900/80 border border-slate-700/50 text-slate-300">
            {rec?.fact_id && <span className="text-slate-500 mr-2 font-mono">{rec.fact_id}</span>}
            {text || <DataView value={rec} />}
          </li>
        );
      })}
    </ul>
  </div>
);

const ProsecutorView: React.FC<{ findings: Rec | null; bonus: Rec | null; title: string }> = ({
  findings,
  bonus,
  title,
}) => {
  const factKeys: [string, string, "green" | "amber" | "red"][] = [
    ["verified_facts", "已核实事实", "green"],
    ["disputed_facts", "存在争议的事实", "amber"],
    ["missing_facts", "缺失的事实", "red"],
  ];
  const shown = ["prosecutor_summary", ...factKeys.map((f) => f[0])];
  const escalation = asRecord(bonus?.escalation_protocol);
  const fraud = escalation?.fraud_risk_level;

  return (
    <Panel title={title} tone="amber">
      {findings && !isEmpty(findings) ? (
        <>
          {typeof findings.prosecutor_summary === "string" && findings.prosecutor_summary && (
            <div>
              <div className="text-slate-400 mb-1">检察官总结</div>
              <p className="p-2.5 rounded bg-slate-900/80 leading-5 whitespace-pre-wrap text-slate-200">
                {findings.prosecutor_summary}
              </p>
            </div>
          )}
          {factKeys.map(
            ([k, t, tone]) =>
              Array.isArray(findings[k]) && findings[k].length > 0 && <FactList key={k} title={t} facts={findings[k]} tone={tone} />
          )}
          {Object.keys(findings).some((k) => !shown.includes(k) && !isEmpty(findings[k])) && (
            <DataView value={findings} skip={shown} />
          )}
        </>
      ) : (
        <div className="text-slate-500 italic">检察官尚未返回审计发现。</div>
      )}

      {escalation && (
        <div className="pt-2 border-t border-amber-500/15 flex flex-wrap items-center gap-2">
          <span className="text-slate-400">风险信号：</span>
          {fraud && <Chip tone={fraud === "HIGH" ? "red" : fraud === "MEDIUM" ? "amber" : "green"}>欺诈风险 {fraud}</Chip>}
          {escalation.safety_threat_detected && <Chip tone="red">检测到安全威胁</Chip>}
          {escalation.missing_crucial_evidence && <Chip tone="amber">缺少关键证据</Chip>}
          {!escalation.safety_threat_detected && !escalation.missing_crucial_evidence && fraud !== "HIGH" && (
            <Chip tone="green">无升级信号</Chip>
          )}
        </div>
      )}
      {bonus && !isEmpty(bonus) && <RawJson value={bonus} summary="安全与欺诈检测模块（bonus_modules）" />}
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
    return <p className="p-2.5 rounded bg-slate-900/80 leading-5 whitespace-pre-wrap">{suggestion}</p>;
  }
  const s = asRecord(suggestion);
  if (!s || isEmpty(s)) {
    return <div className="text-slate-500 italic">政策顾问没有返回 suggestion（policy_consultation.suggestion 为空）。</div>;
  }

  const ruling = pick(s, KNOWN_RULING);
  const action = pick(s, KNOWN_ACTION);
  const reason = pick(s, KNOWN_REASON);
  const conf = pick(s, KNOWN_CONF);
  const clauses = pick(s, KNOWN_CLAUSES);
  const precedents = pick(s, KNOWN_PRECEDENTS);

  const used = [ruling, action, reason, conf, clauses, precedents].filter(Boolean).map((x) => (x as [string, any])[0]);

  return (
    <div className="space-y-3">
      {(ruling || conf) && (
        <div className="p-2.5 rounded border border-blue-400/30 bg-blue-900/30 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-blue-200">💡 政策建议裁决</span>
          {ruling && <Chip tone="blue">{String(ruling[1])}</Chip>}
          {conf && (
            <span className="text-slate-300">
              置信度 <span className="font-mono text-blue-200">{String(conf[1])}</span>
            </span>
          )}
        </div>
      )}

      {action && (
        <div>
          <div className="text-slate-400 mb-1">建议措施</div>
          <div className="p-2.5 rounded bg-slate-900/80 border border-slate-700/50">
            <DataView value={action[1]} />
          </div>
        </div>
      )}

      {reason && (
        <div>
          <div className="text-slate-400 mb-1">建议依据</div>
          <p className="p-2.5 rounded bg-slate-900/80 leading-5 whitespace-pre-wrap">
            {typeof reason[1] === "string" ? reason[1] : <DataView value={reason[1]} />}
          </p>
        </div>
      )}

      {clauses && Array.isArray(clauses[1]) && (
        <div>
          <div className="text-slate-400 mb-1">
            适用政策条款 <Chip tone="blue">{clauses[1].length}</Chip>
          </div>
          <div className="space-y-1.5">
            {clauses[1].map((c: any, i: number) => {
              const rec = asRecord(c);
              if (!rec) return <div key={i} className="p-2 rounded bg-slate-900/80">{String(c)}</div>;
              const body = firstText(rec, ["clause_text", "content", "text", "description", "summary"]);
              const why = firstText(rec, ["relevance", "relevance_reason", "reason", "rationale"]);
              const shownKeys = ["clause_id", "title", "clause_title", "clause_text", "content", "text", "description", "summary", "relevance", "relevance_reason", "reason", "rationale"];
              return (
                <div key={rec.clause_id ?? i} className="p-2.5 rounded bg-slate-900/80 border border-slate-700/50">
                  <div className="font-semibold text-blue-300">
                    {rec.clause_id && <span className="font-mono mr-2">{rec.clause_id}</span>}
                    {rec.title ?? rec.clause_title ?? (rec.clause_id ? "" : `条款 ${i + 1}`)}
                  </div>
                  {body && <div className="text-slate-300 mt-1 leading-5 whitespace-pre-wrap">{body}</div>}
                  {why && <div className="text-slate-400 mt-1">适用理由：{why}</div>}
                  {Object.keys(rec).some((k) => !shownKeys.includes(k) && !isEmpty(rec[k])) && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-700/50">
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
          <div className="text-slate-400 mb-1">
            参考历史判例 <Chip tone="blue">{precedents[1].length}</Chip>
          </div>
          <div className="space-y-1.5">
            {precedents[1].map((p: any, i: number) => (
              <div key={i} className="p-2.5 rounded bg-slate-900/80 border border-slate-700/50 text-slate-300">
                {typeof p === "string" ? p : <DataView value={p} depth={1} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(s).some((k) => !used.includes(k) && !isEmpty(s[k])) && (
        <div className="pt-2 border-t border-blue-500/15">
          <DataView value={s} skip={used} />
        </div>
      )}
    </div>
  );
};

const PolicyView: React.FC<{ data: Rec }> = ({ data }) => {
  const request = asRecord(data.request);
  return (
    <Panel title="⚖️ 政策条款与建议 (Policy Consultation)" tone="blue">
      <PolicySuggestionView suggestion={data.suggestion} />
      {request && (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer hover:text-slate-200">咨询请求（Policy Consultation Request）</summary>
          <div className="mt-2 p-2 rounded bg-slate-950/70 space-y-1.5">
            <DataView value={request} />
          </div>
        </details>
      )}
      <RawJson value={data} summary="政策咨询原始数据" />
    </Panel>
  );
};

const JudgeView: React.FC<{ data: Rec }> = ({ data }) => {
  const action = asRecord(data.recommended_action);
  return (
    <Panel title="🧑‍⚖️ 法官裁决 (Judge Verdict)" tone="slate">
      <div className="flex flex-wrap items-center gap-2">
        {data.ruling_type && <Chip tone="blue">{String(data.ruling_type)}</Chip>}
        {data.confidence_score !== undefined && (
          <Chip tone={Number(data.confidence_score) >= 0.75 ? "green" : "amber"}>
            置信度 {Number(data.confidence_score).toFixed(2)}
          </Chip>
        )}
      </div>
      {action && <DataView value={action} />}
      <DataView value={data} skip={["ruling_type", "confidence_score", "recommended_action"]} />
    </Panel>
  );
};

const ExecutionView: React.FC<{ data: Rec }> = ({ data }) => {
  const escalated = data.route === "ESCALATED_HUMAN_REVIEW";
  return (
    <Panel title="🚦 执行路由 (Execution Router)" tone={escalated ? "amber" : "green"}>
      <div className="flex flex-wrap items-center gap-2">
        {data.route && <Chip tone={escalated ? "amber" : "green"}>{String(data.route)}</Chip>}
        {data.confidence_score !== undefined && <Chip>置信度 {Number(data.confidence_score).toFixed(2)}</Chip>}
      </div>
      {Array.isArray(data.escalation_reasons) && data.escalation_reasons.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 text-slate-300">
          {data.escalation_reasons.map((r: string, i: number) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <DataView value={data} skip={["route", "confidence_score", "escalation_reasons"]} />
    </Panel>
  );
};

// ==========================================
// 阶段事件卡片
// ==========================================

const PhaseFeedItem: React.FC<{
  event: FeedEvent;
  step: StepKey;
  isLive: boolean;
  showTranscriptFallback: boolean;
}> = ({ event, step, isLive, showTranscriptFallback }) => {
  const isCompleted = event.event_type === "PHASE_COMPLETED";
  const data = asRecord(event.data);

  const crossSource = asRecord(data?.round_2_cross_exam) ?? data;
  const fbQuestions: Rec[] = Array.isArray(crossSource?.targeted_questions) ? crossSource!.targeted_questions : [];
  const fbResponses: Rec[] = Array.isArray(crossSource?.targeted_responses) ? crossSource!.targeted_responses : [];

  let details: React.ReactNode = null;
  if (isCompleted && data) {
    switch (step) {
      case "INIT_CLAIM":
        details = (
          <Panel title="📁 案件信息" tone="slate">
            <DataView value={data} skip={["status"]} />
          </Panel>
        );
        break;
      case "ROUND_2_AUDIT":
        details = (
          <ProsecutorView
            title="📋 检察官初始证据审计与欺诈筛查报告"
            findings={asRecord(data.prosecutor_findings)}
            bonus={asRecord(data.bonus_modules)}
          />
        );
        break;
      case "ROUND_2_CROSS_EXAM":
        details = showTranscriptFallback ? (
          <CrossExamTranscript questions={fbQuestions} responses={fbResponses} />
        ) : typeof data.questions_asked === "number" && data.questions_asked === 0 ? (
          <div className="p-3 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400">
            检察官本轮没有提出质询问题。
          </div>
        ) : null;
        break;
      case "ROUND_2_REPORT":
        details = (
          <>
            {showTranscriptFallback && <CrossExamTranscript questions={fbQuestions} responses={fbResponses} />}
            <ProsecutorView
              title="📜 检察官最终报告 (Prosecutor Report)"
              findings={asRecord(data.prosecutor_findings)}
              bonus={asRecord(data.bonus_modules)}
            />
          </>
        );
        break;
      case "POLICY_CONSULTATION":
        details = <PolicyView data={data} />;
        break;
      case "JUDGE_DELIBERATION":
        details = <JudgeView data={data} />;
        break;
      case "EXECUTION_ROUTER":
        details = <ExecutionView data={data} />;
        break;
      default:
        details = null;
    }
  }

  if (!isCompleted) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-slate-400">
        <span className={`w-2 h-2 rounded-full ${isLive ? "bg-blue-400 animate-pulse" : "bg-slate-600"}`} />
        <span>{event.label || event.phase}</span>
        {event.timestamp && <span className="text-slate-600">{formatTime(event.timestamp)}</span>}
      </div>
    );
  }

  return (
    <div className="my-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span>{event.label || event.phase}</span>
        {event.timestamp && <span className="ml-auto text-xs text-slate-500">{formatTime(event.timestamp)}</span>}
      </div>
      {details && <div className="mt-3 space-y-3">{details}</div>}
    </div>
  );
};

const StepHeader: React.FC<{ step: StepKey }> = ({ step }) => {
  const meta = STEPS.find((s) => s.id === step);
  return (
    <div className="mt-6 mb-1 flex items-center gap-3 text-xs font-semibold text-slate-400">
      <span className="h-px flex-1 bg-slate-800" />
      <span>{meta?.name ?? step}</span>
      <span className="h-px flex-1 bg-slate-800" />
    </div>
  );
};

// ==========================================
// COMPONENT
// ==========================================

export function DebugProcessView({ caseId }: { caseId: string }) {
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleStartPipeline = useCallback(() => {
    cleanupRef.current?.();
    setIsRunning(true);
    setIsFinished(false);
    setError(null);
    setEvents([]);

    cleanupRef.current = streamPipeline(caseId, {
      onEvent: (event: PipelineEvent) => {
        setEvents((prev) => [...prev, event as unknown as FeedEvent]);
      },
      onComplete: (result) => {
        setIsRunning(false);
        setIsFinished(true);
        console.log("Pipeline processing complete, result:", result);
      },
      onError: (err) => {
        setIsRunning(false);
        setError("实时连接中断，请检查后端日志（某个 Agent 调用可能抛出了异常）后重试。");
        console.error("Pipeline SSE stream error:", err);
      },
    });
  }, [caseId]);

  const stepKeys = useMemo(() => classifyEvents(events), [events]);

  const activeStep: StepKey | null = events.length > 0 ? stepKeys[stepKeys.length - 1] : null;

  const messageCount = useMemo(() => {
    const counts: Partial<Record<StepKey, number>> = {};
    events.forEach((e, i) => {
      if (isAgentConversation(e)) counts[stepKeys[i]] = (counts[stepKeys[i]] ?? 0) + 1;
    });
    return counts;
  }, [events, stepKeys]);

  const hasLiveCrossExam = (messageCount.ROUND_2_CROSS_EXAM ?? 0) > 0;
  const fallbackHostIndex = useMemo(() => {
    if (hasLiveCrossExam) return -1;
    const idx = events.findIndex((e, i) => {
      if (e.event_type !== "PHASE_COMPLETED") return false;
      if (stepKeys[i] !== "ROUND_2_CROSS_EXAM" && stepKeys[i] !== "ROUND_2_REPORT") return false;
      const d = asRecord(e.data);
      const src = asRecord(d?.round_2_cross_exam) ?? d;
      return Array.isArray(src?.targeted_questions) || Array.isArray(src?.targeted_responses);
    });
    return idx;
  }, [events, stepKeys, hasLiveCrossExam]);

  const activeIndex = activeStep ? STEPS.findIndex((s) => s.id === activeStep) : -1;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <header className="max-w-6xl mx-auto mb-8 flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-amber-400 bg-clip-text text-transparent">
            Mirra AI Dispute Tribunal Process (DEBUG)
          </h1>
          <p className="text-xs text-slate-400 mt-1">智能仲裁庭实时推理、审计与质询监控</p>
        </div>
        <button
          onClick={handleStartPipeline}
          disabled={isRunning}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
            isRunning
              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30"
          }`}
        >
          {isRunning ? "流程运行中..." : isFinished ? "重新运行仲裁流程" : "启动仲裁流程 (Start Stream)"}
        </button>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 bg-slate-900/50 p-4 rounded-xl border border-slate-800 h-fit md:sticky md:top-6">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">流程节点</h2>
          <nav className="space-y-2">
            {STEPS.map((step, i) => {
              const isActive = activeStep === step.id && !isFinished;
              const isDone = isFinished || (activeIndex > i && events.length > 0);
              const count = messageCount[step.id];
              return (
                <div
                  key={step.id}
                  className={`p-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between gap-2 ${
                    isActive
                      ? "bg-blue-600/20 text-blue-300 border border-blue-500/40"
                      : isDone
                      ? "text-emerald-300/90 bg-emerald-950/20 border border-emerald-500/20"
                      : "text-slate-400 bg-slate-900/30 border border-transparent"
                  }`}
                >
                  <span>
                    {isDone && !isActive ? "✓ " : ""}
                    {step.name}
                  </span>
                  {count ? <Chip tone={isActive ? "blue" : "slate"}>{count}</Chip> : null}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="md:col-span-3 bg-slate-900/30 p-4 rounded-xl border border-slate-800 min-h-[600px] flex flex-col">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
            实时事件与 Agent 质询对话流
          </h2>

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-500/40 bg-red-950/30 text-red-200 text-xs">{error}</div>
          )}

          <div className="flex-1 overflow-y-auto max-h-[75vh] pr-2">
            {events.length === 0 ? (
              <div className="text-center text-slate-500 my-20 text-sm">
                点击上方"启动仲裁流程"按钮开始接收 SSE 实时推送
              </div>
            ) : (
              events.map((event, idx) => {
                const step = stepKeys[idx];
                const showHeader = idx === 0 || stepKeys[idx - 1] !== step;
                return (
                  <React.Fragment key={idx}>
                    {showHeader && <StepHeader step={step} />}
                    {isAgentConversation(event) ? (
                      <AgentMessageCard event={event} />
                    ) : (
                      <PhaseFeedItem
                        event={event}
                        step={step}
                        isLive={isRunning && idx === events.length - 1}
                        showTranscriptFallback={idx === fallbackHostIndex}
                      />
                    )}
                  </React.Fragment>
                );
              })
            )}
            <div ref={feedEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
