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

// ==========================================
// TYPES
// ==========================================

export type StepKey =
  | "INIT_CLAIM"
  | "ROUND_1_PLEADINGS"
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
  { id: "INIT_CLAIM", name: "Dispute Filed" },
  { id: "ROUND_1_PLEADINGS", name: "Round 1 Pleadings"},
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
    box: "bg-blue-50/50 border-blue-200 text-blue-900",
    title: "🔍 检察官 Prosecutor",
  },
  rider: {
    box: "bg-purple-50/50 border-purple-200 text-purple-900",
    title: "🛵 乘客代理 Rider Advocate",
  },
  driver: {
    box: "bg-emerald-50/50 border-emerald-200 text-emerald-900",
    title: "🚗 司机代理 Driver Advocate",
  },
  other: {
    box: "bg-gray-50 border-gray-200 text-gray-900",
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
  if (value === null || value === undefined || value === "") {
    return <span className="text-gray-400">—</span>;
  }
  if (typeof value === "boolean") {
    return <Chip tone={value ? "primary" : "gray"}>{value ? "是" : "否"}</Chip>;
  }
  if (typeof value === "number") {
    return <span className="text-gray-900 font-mono">{value}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-gray-800 whitespace-pre-wrap leading-relaxed">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-400">（空）</span>;
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
          <div key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50/50">
            <DataView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const obj = value as Rec;
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (entries.length === 0) return <span className="text-gray-400">（空）</span>;
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className={depth === 0 ? "grid grid-cols-[8.5rem_1fr] gap-x-3" : "grid grid-cols-[7rem_1fr] gap-x-2"}>
          <dt className="text-gray-500 font-medium">{label(k)}</dt>
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
    <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-4 text-sm">
      <div className="font-semibold text-gray-900 border-b border-gray-100 pb-2">{title}</div>
      <div className="text-gray-700 space-y-4">{children}</div>
    </div>
  );
};

const RawJson: React.FC<{ value: any; summary?: string }> = ({ value, summary = "查看原始数据" }) => (
  <details className="text-[11px] text-gray-500 group">
    <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors select-none">
      {summary}
    </summary>
    <pre className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-lg overflow-x-auto text-gray-600 font-mono text-[10px]">
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
  const indent = isResponse ? "ml-6 md:ml-12" : "";

  return (
    <div className={`my-4 ${indent}`}>
      <div className={`p-4 rounded-xl border ${style.box}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-black/5">
          <span className="font-semibold text-sm flex flex-wrap items-center gap-2">
            {role === "other" ? `🤖 ${msg.speaker}` : style.title}
            {inCrossExam && msg.messageType && (
              <Chip tone={isQuestion ? "primary" : "green"}>
                {isQuestion ? "质询问题" : "答辩回应"}
                {msg.turn !== undefined ? ` · 第 ${msg.turn} 轮` : ""}
              </Chip>
            )}
            {msg.target && (
              <span className="text-xs font-normal text-gray-500">
                {isQuestion ? "质询对象：" : "回应对象："}
                {roleName(msg.target)}
              </span>
            )}
          </span>
          {event.timestamp && <span className="text-xs text-gray-400">{formatTime(event.timestamp)}</span>}
        </div>

        <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
          {msg.text || <span className="italic text-gray-400">（该 Agent 未返回文本内容）</span>}
        </div>

        {isQuestion && (msg.category || msg.evidenceContext) && (
          <div className="mt-4 pt-3 border-t border-black/5 text-xs space-y-2 text-gray-600 bg-white/50 rounded-lg p-3">
            {msg.category && msg.category !== "OTHER" && (
              <div>
                <span className="text-gray-500 font-medium mr-2">类别：</span>
                {msg.category}
              </div>
            )}
            {msg.evidenceContext && (
              <div>
                <span className="text-gray-500 font-medium mr-2">相关证据：</span>
                {msg.evidenceContext}
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          <RawJson value={msg.raw} summary="Agent 原始输出" />
        </div>
      </div>
    </div>
  );
};

const CrossExamTranscript: React.FC<{ questions: Rec[]; responses: Rec[] }> = ({ questions, responses }) => {
  if (questions.length === 0) {
    return (
      <div className="my-4 p-4 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500 text-center">
        检察官本轮没有提出质询问题。
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
    <Panel title={title}>
      {findings && !isEmpty(findings) ? (
        <>
          {typeof findings.prosecutor_summary === "string" && findings.prosecutor_summary && (
            <div className="mb-4">
              <div className="text-gray-500 font-medium mb-2">检察官总结</div>
              <p className="p-4 rounded-lg bg-blue-50/50 border border-blue-100 leading-relaxed text-gray-800">
                {findings.prosecutor_summary}
              </p>
            </div>
          )}
          {factKeys.map(
            ([k, t, tone]) =>
              Array.isArray(findings[k]) && findings[k].length > 0 && <FactList key={k} title={t} facts={findings[k]} tone={tone} />
          )}
          {Object.keys(findings).some((k) => !shown.includes(k) && !isEmpty(findings[k])) && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <DataView value={findings} skip={shown} />
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-400 italic p-4 text-center bg-gray-50 rounded-lg">检察官尚未返回审计发现。</div>
      )}

      {escalation && (
        <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <span className="text-gray-600 font-medium">风险信号：</span>
          {fraud && <Chip tone={fraud === "HIGH" ? "red" : fraud === "MEDIUM" ? "amber" : "green"}>欺诈风险 {fraud}</Chip>}
          {escalation.safety_threat_detected && <Chip tone="red">检测到安全威胁</Chip>}
          {escalation.missing_crucial_evidence && <Chip tone="amber">缺少关键证据</Chip>}
          {!escalation.safety_threat_detected && !escalation.missing_crucial_evidence && fraud !== "HIGH" && (
            <Chip tone="green">无升级信号</Chip>
          )}
        </div>
      )}
      {bonus && !isEmpty(bonus) && (
        <div className="mt-4">
          <RawJson value={bonus} summary="安全与欺诈检测模块（bonus_modules）" />
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
    return <p className="p-4 rounded-lg bg-gray-50 border border-gray-100 leading-relaxed text-gray-800">{suggestion}</p>;
  }
  const s = asRecord(suggestion);
  if (!s || isEmpty(s)) {
    return <div className="text-gray-400 italic text-center p-4">政策顾问没有返回可用数据。</div>;
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
          <span className="font-semibold text-[#E84360]">💡 政策建议裁决</span>
          {ruling && <Chip tone="primary">{String(ruling[1])}</Chip>}
          {conf && (
            <span className="text-gray-600 text-sm">
              置信度 <span className="font-mono text-gray-900 font-medium">{String(conf[1])}</span>
            </span>
          )}
        </div>
      )}

      {action && (
        <div>
          <div className="text-gray-500 font-medium mb-2">建议措施</div>
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <DataView value={action[1]} />
          </div>
        </div>
      )}

      {reason && (
        <div>
          <div className="text-gray-500 font-medium mb-2">建议依据</div>
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100 leading-relaxed text-gray-800">
            {typeof reason[1] === "string" ? reason[1] : <DataView value={reason[1]} />}
          </div>
        </div>
      )}

      {clauses && Array.isArray(clauses[1]) && (
        <div>
          <div className="text-gray-500 font-medium mb-2 flex items-center gap-2">
            适用政策条款 <Chip tone="blue">{clauses[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {clauses[1].map((c: any, i: number) => {
              const rec = asRecord(c);
              if (!rec) return <div key={i} className="p-3 rounded-lg bg-gray-50 border border-gray-100">{String(c)}</div>;
              const body = firstText(rec, ["clause_text", "content", "text", "description", "summary"]);
              const why = firstText(rec, ["relevance", "relevance_reason", "reason", "rationale"]);
              const shownKeys = ["clause_id", "title", "clause_title", "clause_text", "content", "text", "description", "summary", "relevance", "relevance_reason", "reason", "rationale"];
              return (
                <div key={rec.clause_id ?? i} className="p-4 rounded-lg bg-white border border-gray-200 shadow-sm">
                  <div className="font-semibold text-gray-900">
                    {rec.clause_id && <span className="font-mono text-gray-400 mr-2 text-xs">{rec.clause_id}</span>}
                    {rec.title ?? rec.clause_title ?? (rec.clause_id ? "" : `条款 ${i + 1}`)}
                  </div>
                  {body && <div className="text-gray-700 mt-2 leading-relaxed whitespace-pre-wrap">{body}</div>}
                  {why && <div className="text-gray-600 mt-3 p-3 bg-gray-50 rounded text-sm">适用理由：{why}</div>}
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
            参考历史判例 <Chip tone="gray">{precedents[1].length}</Chip>
          </div>
          <div className="space-y-3">
            {precedents[1].map((p: any, i: number) => (
              <div key={i} className="p-4 rounded-lg bg-white border border-gray-200 shadow-sm text-gray-700">
                {typeof p === "string" ? p : <DataView value={p} depth={1} />}
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
  return (
    <Panel title="⚖️ 政策条款与建议 (Policy Consultation)">
      <PolicySuggestionView suggestion={data.suggestion} />
      {request && (
        <details className="mt-4 text-[11px] text-gray-500">
          <summary className="cursor-pointer hover:text-[#E84360] font-medium transition-colors">
            咨询请求（Policy Consultation Request）
          </summary>
          <div className="mt-2 p-4 rounded-lg bg-gray-50 border border-gray-100">
            <DataView value={request} />
          </div>
        </details>
      )}
      <div className="mt-2">
        <RawJson value={data} summary="政策咨询原始数据" />
      </div>
    </Panel>
  );
};

const JudgeView: React.FC<{ data: Rec }> = ({ data }) => {
  const action = asRecord(data.recommended_action);
  return (
    <Panel title="🧑‍⚖️ 法官裁决 (Judge Verdict)">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.ruling_type && <Chip tone="primary">{String(data.ruling_type)}</Chip>}
        {data.confidence_score !== undefined && (
          <Chip tone={Number(data.confidence_score) >= 0.75 ? "green" : "amber"}>
            置信度 {Number(data.confidence_score).toFixed(2)}
          </Chip>
        )}
      </div>
      {action && (
        <div className="mb-4 p-4 rounded-lg bg-gray-50 border border-gray-100">
          <DataView value={action} />
        </div>
      )}
      <DataView value={data} skip={["ruling_type", "confidence_score", "recommended_action"]} />
    </Panel>
  );
};

const ExecutionView: React.FC<{ data: Rec }> = ({ data }) => {
  const escalated = data.route === "ESCALATED_HUMAN_REVIEW";
  return (
    <Panel title="🚦 执行路由 (Execution Router)">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {data.route && <Chip tone={escalated ? "amber" : "green"}>{String(data.route)}</Chip>}
        {data.confidence_score !== undefined && <Chip>置信度 {Number(data.confidence_score).toFixed(2)}</Chip>}
      </div>
      {Array.isArray(data.escalation_reasons) && data.escalation_reasons.length > 0 && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-100">
          <div className="text-amber-800 font-medium mb-2">升级原因：</div>
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
// COMPONENT
// ==========================================

export default function CustomerSupportCaseViewPage() {
  const params = useParams();
  const caseId = (params?.caseId as string) || "";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [activeTab, setActiveTab] = useState<StepKey>("INIT_CLAIM");

  useEffect(() => {
    if (!caseId) return;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getCompletedResult(caseId);
        if (!result) throw new Error("API 未返回有效数据 (Empty Response)");

        const synthesizedEvents: FeedEvent[] = [];

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

        // 2. ROUND 1 PLEADINGS
        const statements = result.agent_conversation?.filter((m: any) => m.message_type === "STATEMENT") || [];
        statements.forEach((msg: any) => {
          synthesizedEvents.push({
            event_type: "AGENT_CONVERSATION",
            phase: "ROUND_1_PLEADINGS",
            speaker: msg.speaker,
            message_type: msg.message_type,
            timestamp: msg.timestamp,
            data: msg,
          });
        });
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_1_PLEADINGS",
        });

        // 3. ROUND 2 INITIAL AUDIT
        synthesizedEvents.push({
          event_type: "PHASE_COMPLETED",
          phase: "ROUND_2_PROSECUTOR_AUDIT",
          sub_phase: "INITIAL_AUDIT",
          data: {
            prosecutor_findings: result.prosecutor_findings,
            bonus_modules: result.bonus_modules,
          },
        });

        // 4. ROUND 2 CROSS EXAM
        const crossExams = result.agent_conversation?.filter((m: any) => m.message_type !== "STATEMENT") || [];
        crossExams.forEach((msg: any) => {
          synthesizedEvents.push({
            event_type: "AGENT_CONVERSATION",
            phase: "ROUND_2_PROSECUTOR_AUDIT",
            sub_phase: "CROSS_EXAM",
            speaker: msg.speaker,
            message_type: msg.message_type,
            timestamp: msg.timestamp,
            data: msg,
          });
        });
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
            confidence_score: result.judge_verdict?.confidence_score,
            escalation_reasons: result.bonus_modules?.escalation_protocol?.escalation_reasons,
            ...result.judge_verdict?.execution_payload,
          },
        });

        setEvents(synthesizedEvents);
      } catch (err) {
        setError("无法获取案件数据，请检查网络或后端日志。");
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
      INIT_CLAIM: [],
      ROUND_1_PLEADINGS: [],
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
              Mirra AI Tribunal <span className="text-gray-400 font-normal">|</span> Customer Support
            </h1>
            <p className="text-sm text-gray-500 mt-1 ml-4">案件编号: {caseId}</p>
          </div>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="animate-spin h-4 w-4 text-[#E84360]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              数据加载中...
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col md:flex-row gap-8">
        
        {/* 左侧 Tabs 导航 */}
        <aside className="md:w-64 flex-shrink-0">
          <nav className="space-y-1 sticky top-24">
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
                  <span className="truncate">{step.name}</span>
                  {hasData && isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#E84360]"></span>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧内容区 */}
        <section className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8 min-h-[600px]">
          {error ? (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          ) : isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="loading-spinner mb-4"></span>
              正在拉取仲裁数据...
            </div>
          ) : activeEvents.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              该阶段暂无数据
            </div>
          ) : (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-4 mb-6">
                {STEPS.find(s => s.id === activeTab)?.name}
              </h2>
              {activeEvents.map((event, idx) => {
                const data = asRecord(event.data);
                if (isAgentConversation(event)) {
                  return <AgentMessageCard key={idx} event={event} />;
                }
                
                // 处理 PHASE_COMPLETED 的具体渲染逻辑
                if (event.event_type === "PHASE_COMPLETED" && data) {
                  switch (activeTab) {
                    case "INIT_CLAIM":
                      return (
                        <Panel key={idx} title="📁 案件基础信息">
                          <DataView value={data} skip={["status"]} />
                        </Panel>
                      );
                    case "ROUND_2_CROSS_EXAM":
                      const crossSource = asRecord(data?.round_2_cross_exam) ?? data;
                      const fbQuestions = Array.isArray(crossSource?.targeted_questions) ? crossSource!.targeted_questions : [];
                      const fbResponses = Array.isArray(crossSource?.targeted_responses) ? crossSource!.targeted_responses : [];
                      return <CrossExamTranscript key={idx} questions={fbQuestions} responses={fbResponses} />;
                    case "ROUND_2_REPORT":
                      return (
                        <ProsecutorView
                          key={idx}
                          title="📜 检察官最终报告 (Prosecutor Report)"
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
    </div>
  );
}