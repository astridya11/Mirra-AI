"use client";

import { useTranslation } from "@/src/hooks/useTranslation";
import type { TribunalEvent, EvidenceItem, FraudSignal } from "@/src/types/tribunal";

interface TribunalBoardProps {
  events: TribunalEvent[];
  evidence: EvidenceItem[];
  fraudSignals?: FraudSignal[];
  locale: "en" | "zh";
  isLive?: boolean;
}

const AGENT_ORDER: TribunalEvent["role"][] = [
  "rider_advocate",
  "driver_advocate",
  "initial_prosecutor",
  "cross_examination",
  "final_prosecutor",
  "policy_consultant",
  "ai_judge",
  "execution_router",
];

const ROLES: Record<TribunalEvent["role"], { en: string; zh: string; color: string; glyph: string }> = {
  rider_advocate: { en: "Rider Advocate", zh: "乘客代理", color: "#E84360", glyph: "R" },
  driver_advocate: { en: "Driver Advocate", zh: "司机代理", color: "#0D9488", glyph: "D" },
  initial_prosecutor: { en: "Initial Prosecutor", zh: "初步检察官", color: "#7C3AED", glyph: "P" },
  cross_examination: { en: "Cross-examination", zh: "交叉质询", color: "#7C3AED", glyph: "Q" },
  final_prosecutor: { en: "Final Prosecutor", zh: "最终检察官", color: "#6D28D9", glyph: "F" },
  policy_consultant: { en: "Policy Consultant", zh: "政策顾问", color: "#2563EB", glyph: "§" },
  ai_judge: { en: "AI Judge", zh: "AI 法官", color: "#111827", glyph: "J" },
  execution_router: { en: "Execution Router", zh: "执行路由", color: "#B45309", glyph: "→" },
};

const TYPE_LABELS: Record<TribunalEvent["type"], { en: string; zh: string }> = {
  statement: { en: "Statement", zh: "陈述" },
  evidence_audit: { en: "Evidence Audit", zh: "证据审查" },
  targeted_question: { en: "Targeted Question", zh: "针对性提问" },
  claim_response: { en: "CLAIM · not verified", zh: "CLAIM · 未经核实" },
  verified_summary: { en: "Verified Summary", zh: "核实摘要" },
  policy_application: { en: "Applicable Policy", zh: "适用政策" },
  decision: { en: "Decision", zh: "裁决" },
  execution_route: { en: "Execution Route", zh: "执行路径" },
};

/** Judge after the debate, Execution Router always last; the rest keep arrival order. */
function ordered(events: TribunalEvent[]): TribunalEvent[] {
  const rank = (e: TribunalEvent) => (e.role === "execution_router" ? 2 : e.role === "ai_judge" ? 1 : 0);
  return events.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
}

export default function TribunalBoard({ events, evidence, fraudSignals, locale, isLive }: TribunalBoardProps) {
  const t = useTranslation();
  const feed = ordered(events);

  const roleStatus = (role: TribunalEvent["role"]): "pending" | "active" | "complete" => {
    const forRole = events.filter((e) => e.role === role);
    if (forRole.length === 0) return "pending";
    if (forRole.some((e) => e.status === "active")) return "active";
    return forRole.every((e) => e.status === "complete") ? "complete" : "pending";
  };
  const done = AGENT_ORDER.filter((r) => roleStatus(r) === "complete").length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Agent timeline */}
      <div className="lg:col-span-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{t("tribunal.agentTimeline")}</p>
          <span className="text-[10px] font-semibold tabular-nums text-[#6B7280]">
            {done}/{AGENT_ORDER.length}
          </span>
        </div>
        <ol className="relative space-y-1">
          {AGENT_ORDER.map((role) => {
            const status = roleStatus(role);
            const r = ROLES[role];
            return (
              <li
                key={role}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors ${
                  status === "active" ? "bg-[#FDF1F3]" : status === "complete" ? "bg-white" : "bg-transparent"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white transition-opacity"
                  style={{ backgroundColor: r.color, opacity: status === "pending" ? 0.25 : 1 }}
                  aria-hidden
                >
                  {r.glyph}
                </span>
                <span className={`flex-1 font-medium ${status === "pending" ? "text-[#9CA3AF]" : "text-[#111827]"}`}>
                  {locale === "zh" ? r.zh : r.en}
                </span>
                {status === "complete" && (
                  <svg className="h-3.5 w-3.5 text-[#0D9488]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                  </svg>
                )}
                {status === "active" && <span className="h-2 w-2 rounded-full bg-[#E84360] animate-pulse" />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Event feed */}
      <div className="lg:col-span-6 space-y-3 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{t("tribunal.eventFeed")}</p>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F0FDFA] px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0D9488] animate-pulse" />
              <span className="text-[9px] font-bold text-[#0D9488] uppercase">LIVE</span>
            </span>
          )}
        </div>
        {feed.length === 0 && <p className="text-xs text-[#9CA3AF] italic">{t("tribunal.waitingForEvents")}</p>}
        <div className="space-y-2.5">
          {feed.map((event) => (
            <EventCard key={event.id} event={event} locale={locale} />
          ))}
        </div>
      </div>

      {/* Evidence */}
      <div className="lg:col-span-3 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{t("tribunal.evidencePanel")}</p>
        <div className="space-y-2">
          {evidence.map((item) => (
            <EvidenceBadge key={item.id} item={item} locale={locale} />
          ))}
        </div>
        {fraudSignals && fraudSignals.length > 0 && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF] pt-2">{t("tribunal.fraudRisk")}</p>
            <div className="space-y-2">
              {fraudSignals.map((signal) => (
                <FraudBadge key={signal.id} signal={signal} locale={locale} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EventCard({ event, locale }: { event: TribunalEvent; locale: "en" | "zh" }) {
  const r = ROLES[event.role];
  const type = TYPE_LABELS[event.type];
  const isClaim = event.type === "claim_response";
  const zh = locale === "zh";
  // Fixtures carry Chinese copy; live backend text is shown as the original English.
  const content = zh && event.contentZh ? event.contentZh : event.content;
  const untranslated = zh && !event.contentZh;

  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        isClaim ? "border-dashed border-[#E84360]/40" : "border-gray-100"
      }`}
      style={{ borderLeft: `3px solid ${r.color}` }}
      data-event-role={event.role}
      data-event-type={event.type}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: r.color }}>
          {zh ? r.zh : r.en}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
            isClaim ? "bg-[#FDF1F3] text-[#E84360]" : "bg-gray-50 text-[#6B7280]"
          }`}
        >
          {zh ? type.zh : type.en}
        </span>
      </div>
      <p className="text-[13px] text-[#111827] leading-relaxed break-words">{content}</p>
      {untranslated && <p className="mt-1 text-[10px] text-[#9CA3AF]">原始系统文本（English）</p>}
    </div>
  );
}

function EvidenceBadge({ item, locale }: { item: EvidenceItem; locale: "en" | "zh" }) {
  const cfg = {
    verified: { en: "VERIFIED", zh: "已核实", color: "bg-[#F0FDFA] text-[#0D9488] border-[#0D9488]/20" },
    disputed: { en: "DISPUTED", zh: "有争议", color: "bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/25" },
    missing: { en: "MISSING", zh: "缺失", color: "bg-gray-50 text-[#6B7280] border-gray-200" },
  }[item.category];
  const zh = locale === "zh";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cfg.color}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium break-words">{zh ? item.labelZh ?? item.label : item.label}</p>
        <span className="shrink-0 text-[10px] font-bold">{zh ? cfg.zh : cfg.en}</span>
      </div>
      {item.detail && <p className="text-[10px] mt-0.5 opacity-80 break-words">{zh ? item.detailZh ?? item.detail : item.detail}</p>}
    </div>
  );
}

function FraudBadge({ signal, locale }: { signal: FraudSignal; locale: "en" | "zh" }) {
  const color =
    signal.risk === "high"
      ? "bg-[#FDF1F3] text-[#E84360] border-[#E84360]/20"
      : signal.risk === "medium"
      ? "bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/25"
      : "bg-gray-50 text-[#6B7280] border-gray-200";
  const zh = locale === "zh";
  return (
    <div className={`rounded-lg border px-3 py-2 ${color}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium break-words">{zh ? signal.labelZh ?? signal.label : signal.label}</p>
        <span className="shrink-0 text-[10px] font-bold uppercase">
          {zh ? { high: "高", medium: "中", low: "低" }[signal.risk] : signal.risk}
        </span>
      </div>
      {signal.detail && (
        <p className="text-[10px] mt-0.5 opacity-80 break-words">{zh ? signal.detailZh ?? signal.detail : signal.detail}</p>
      )}
    </div>
  );
}
