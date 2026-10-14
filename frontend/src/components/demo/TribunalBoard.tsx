"use client";

import { useTranslation } from "@/src/hooks/useTranslation";
import type { TribunalFixture, TribunalEvent, EvidenceItem, FraudSignal } from "@/src/types/tribunal";

interface TribunalBoardProps {
  fixture: TribunalFixture;
  locale: "en" | "zh";
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

const ROLE_LABELS: Record<string, { en: string; zh: string }> = {
  rider_advocate: { en: "Rider Advocate", zh: "乘客代理" },
  driver_advocate: { en: "Driver Advocate", zh: "司机代理" },
  initial_prosecutor: { en: "Initial Prosecutor", zh: "初步检察官" },
  cross_examination: { en: "Cross-examination", zh: "交叉质询" },
  final_prosecutor: { en: "Final Prosecutor", zh: "最终检察官" },
  policy_consultant: { en: "Policy Consultant", zh: "政策顾问" },
  ai_judge: { en: "AI Judge", zh: "AI 法官" },
  execution_router: { en: "Execution Router", zh: "执行路由" },
};

const TYPE_LABELS: Record<string, { en: string; zh: string }> = {
  statement: { en: "Statement", zh: "陈述" },
  evidence_audit: { en: "Evidence Audit", zh: "证据审查" },
  targeted_question: { en: "Targeted Question", zh: "针对性提问" },
  claim_response: { en: "CLAIM Response", zh: "CLAIM 回应" },
  verified_summary: { en: "Verified Summary", zh: "核实摘要" },
  policy_application: { en: "Applicable Policy", zh: "适用政策" },
  decision: { en: "Decision", zh: "裁决" },
  execution_route: { en: "Execution Route", zh: "执行路径" },
};

export default function TribunalBoard({ fixture, locale }: TribunalBoardProps) {
  const t = useTranslation();

  const roleStatus = (role: TribunalEvent["role"]): "pending" | "active" | "complete" => {
    const eventsForRole = fixture.events.filter((e) => e.role === role);
    if (eventsForRole.length === 0) return "pending";
    if (eventsForRole.every((e) => e.status === "complete")) return "complete";
    if (eventsForRole.some((e) => e.status === "active")) return "active";
    return "pending";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
      {/* Agent Timeline */}
      <div className="lg:col-span-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
          {t("tribunal.agentTimeline")}
        </p>
        <div className="space-y-1">
          {AGENT_ORDER.map((role) => {
            const status = roleStatus(role);
            const label = ROLE_LABELS[role];
            return (
              <div
                key={role}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  status === "complete"
                    ? "bg-[#F0FDFA] text-[#0D9488]"
                    : status === "active"
                    ? "bg-[#FDF1F3] text-[#E84360]"
                    : "bg-gray-50 text-[#9CA3AF]"
                }`}
              >
                <StatusDot status={status} />
                <span className="font-medium">{locale === "zh" ? label.zh : label.en}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Feed */}
      <div className="lg:col-span-6 space-y-3 overflow-y-auto">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
          {t("tribunal.eventFeed")}
        </p>
        <div className="space-y-3">
          {fixture.events.map((event) => (
            <EventCard key={event.id} event={event} locale={locale} />
          ))}
        </div>
      </div>

      {/* Evidence Panel */}
      <div className="lg:col-span-3 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
          {t("tribunal.evidencePanel")}
        </p>
        <div className="space-y-2">
          {fixture.evidence.map((item) => (
            <EvidenceBadge key={item.id} item={item} locale={locale} />
          ))}
        </div>

        {fixture.fraudSignals && fixture.fraudSignals.length > 0 && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF] pt-2">
              {t("tribunal.fraudRisk")}
            </p>
            <div className="space-y-2">
              {fixture.fraudSignals.map((signal) => (
                <FraudBadge key={signal.id} signal={signal} locale={locale} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "pending" | "active" | "complete" }) {
  const color =
    status === "complete" ? "bg-[#0D9488]" : status === "active" ? "bg-[#E84360] animate-pulse" : "bg-[#D1D5DB]";
  return <div className={`h-2 w-2 rounded-full ${color}`} />;
}

function EventCard({ event, locale }: { event: TribunalEvent; locale: "en" | "zh" }) {
  const typeLabel = TYPE_LABELS[event.type];
  const roleLabel = ROLE_LABELS[event.role];
  const isClaim = event.type === "claim_response";

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
          {locale === "zh" ? roleLabel.zh : roleLabel.en}
        </span>
        <span className="text-[10px] text-[#D1D5DB]">•</span>
        <span className={`text-[10px] font-semibold ${isClaim ? "text-[#E84360]" : "text-[#0D9488]"}`}>
          {locale === "zh" ? typeLabel.zh : typeLabel.en}
        </span>
      </div>
      <p className="text-xs text-[#111827] leading-relaxed">{event.content}</p>
    </div>
  );
}

function EvidenceBadge({ item, locale }: { item: EvidenceItem; locale: "en" | "zh" }) {
  const labels = {
    verified: { en: "VERIFIED", zh: "已核实", color: "bg-[#F0FDFA] text-[#0D9488] border-[#0D9488]/20" },
    disputed: { en: "DISPUTED", zh: "有争议", color: "bg-[#FEF3C7] text-[#B45309] border-[#F59E0B]/20" },
    missing: { en: "MISSING", zh: "缺失", color: "bg-gray-50 text-[#6B7280] border-gray-200" },
  };
  const cfg = labels[item.category];

  return (
    <div className={`rounded-lg border px-3 py-2 ${cfg.color}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{item.label}</p>
        <span className="text-[10px] font-bold">{locale === "zh" ? cfg.zh : cfg.en}</span>
      </div>
      {item.detail && <p className="text-[10px] mt-0.5 opacity-80">{item.detail}</p>}
    </div>
  );
}

function FraudBadge({ signal }: { signal: FraudSignal; locale: "en" | "zh" }) {
  const color =
    signal.risk === "high"
      ? "bg-[#FDF1F3] text-[#E84360] border-[#E84360]/20"
      : signal.risk === "medium"
      ? "bg-[#FEF3C7] text-[#B45309] border-[#F59E0B]/20"
      : "bg-gray-50 text-[#6B7280] border-gray-200";

  return (
    <div className={`rounded-lg border px-3 py-2 ${color}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{signal.label}</p>
        <span className="text-[10px] font-bold uppercase">{signal.risk}</span>
      </div>
      {signal.detail && <p className="text-[10px] mt-0.5 opacity-80">{signal.detail}</p>}
    </div>
  );
}
