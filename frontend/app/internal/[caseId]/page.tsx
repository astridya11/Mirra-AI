"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@/src/hooks/useTranslation";
import { useI18n } from "@/src/context/I18nContext";
import { getTribunalFixture } from "@/src/lib/tribunalFixtures";

type Tab = "overview" | "evidence" | "agentLogs" | "policy" | "decision" | "learnings";

const TABS: { key: Tab; labelEn: string; labelZh: string }[] = [
  { key: "overview", labelEn: "Overview", labelZh: "概览" },
  { key: "evidence", labelEn: "Evidence", labelZh: "证据" },
  { key: "agentLogs", labelEn: "Agent Logs", labelZh: "代理日志" },
  { key: "policy", labelEn: "Policy", labelZh: "政策" },
  { key: "decision", labelEn: "Decision", labelZh: "裁决" },
  { key: "learnings", labelEn: "Learnings", labelZh: "学习" },
];

export default function InternalConsolePage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const { locale } = useI18n();
  const t = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const fixture = getTribunalFixture(caseId);

  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#111827] px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-white">MIRRA Internal Console</h1>
              <p className="text-xs text-gray-500">
                {t("internal.subtitle")} — {caseId}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1F2937] px-3 py-1 text-[10px] font-bold text-gray-400 uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-[#E84360]" />
                {t("internal.observer")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800 bg-[#111827]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-[#E84360] text-[#E84360]"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {locale === "zh" ? tab.labelZh : tab.labelEn}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {!fixture && (
          <div className="rounded-lg border border-gray-800 bg-[#111827] p-8 text-center">
            <p className="text-sm text-gray-500">{t("internal.noFixture")}</p>
          </div>
        )}

        {fixture && activeTab === "overview" && (
          <OverviewTab fixture={fixture} locale={locale} />
        )}
        {fixture && activeTab === "evidence" && (
          <EvidenceTab fixture={fixture} locale={locale} />
        )}
        {fixture && activeTab === "agentLogs" && (
          <AgentLogsTab fixture={fixture} locale={locale} />
        )}
        {fixture && activeTab === "policy" && (
          <PolicyTab fixture={fixture} locale={locale} />
        )}
        {fixture && activeTab === "decision" && (
          <DecisionTab fixture={fixture} locale={locale} />
        )}
        {fixture && activeTab === "learnings" && (
          <LearningsTab locale={locale} />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ fixture, locale }: { fixture: NonNullable<ReturnType<typeof getTribunalFixture>>; locale: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Case ID" value={fixture.caseId} />
      <StatCard label="Demo" value={fixture.demoId} />
      <StatCard label="Title" value={locale === "zh" ? fixture.titleZh : fixture.titleEn} />
      <StatCard label="Events" value={String(fixture.events.length)} />
      <StatCard label="Evidence Items" value={String(fixture.evidence.length)} />
      <StatCard label="Judge Confidence" value={`${(fixture.judgeConfidence * 100).toFixed(0)}%`} />
      <StatCard
        label="Execution Route"
        value={fixture.executionRoute === "automated" ? "Automated" : "Human Review"}
        highlight={fixture.executionRoute === "human_review"}
      />
    </div>
  );
}

function EvidenceTab({ fixture }: { fixture: NonNullable<ReturnType<typeof getTribunalFixture>>; locale: string }) {
  return (
    <div className="space-y-4">
      <SectionTitle title="Verified" />
      {fixture.evidence.filter((e) => e.category === "verified").map((item) => (
        <EvidenceRow key={item.id} item={item} color="text-[#0D9488]" />
      ))}
      <SectionTitle title="Disputed" />
      {fixture.evidence.filter((e) => e.category === "disputed").map((item) => (
        <EvidenceRow key={item.id} item={item} color="text-[#B45309]" />
      ))}
      <SectionTitle title="Missing" />
      {fixture.evidence.filter((e) => e.category === "missing").map((item) => (
        <EvidenceRow key={item.id} item={item} color="text-gray-500" />
      ))}
      {fixture.fraudSignals && fixture.fraudSignals.length > 0 && (
        <>
          <SectionTitle title="Fraud Signals" />
          {fixture.fraudSignals.map((signal) => (
            <div key={signal.id} className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">{signal.label}</span>
                <span className={`text-xs font-bold uppercase ${signal.risk === "high" ? "text-[#E84360]" : "text-[#B45309]"}`}>
                  {signal.risk}
                </span>
              </div>
              {signal.detail && <p className="text-xs text-gray-500 mt-1">{signal.detail}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AgentLogsTab({ fixture }: { fixture: NonNullable<ReturnType<typeof getTribunalFixture>>; locale: string }) {
  return (
    <div className="space-y-2">
      {fixture.events.map((event) => (
        <div key={event.id} className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase text-[#E84360]">{event.role.replace(/_/g, " ")}</span>
            <span className="text-[10px] text-gray-600">•</span>
            <span className="text-[10px] text-gray-500">{event.type.replace(/_/g, " ")}</span>
            <span className="ml-auto text-[10px] text-gray-600">{event.status}</span>
          </div>
          <p className="text-sm text-gray-300">{event.content}</p>
        </div>
      ))}
    </div>
  );
}

function PolicyTab({ fixture, locale }: { fixture: NonNullable<ReturnType<typeof getTribunalFixture>>; locale: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] p-6 space-y-4">
      <h3 className="text-sm font-bold text-white">{locale === "zh" ? "适用政策" : "Applicable Policy"}</h3>
      <p className="text-sm text-gray-300 leading-relaxed">
        {locale === "zh" ? fixture.policyClauseZh : fixture.policyClause}
      </p>
      <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Policy-Grounded Outcome</p>
        <p className="text-xs text-gray-400">
          {fixture.executionRoute === "automated"
            ? "Policy supports automated execution."
            : "Policy requires human review due to insufficient evidence linkage."}
        </p>
      </div>
    </div>
  );
}

function DecisionTab({ fixture }: { fixture: NonNullable<ReturnType<typeof getTribunalFixture>>; locale: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] p-6 space-y-4">
      <h3 className="text-sm font-bold text-white">Judge Result</h3>
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Confidence" value={`${(fixture.judgeConfidence * 100).toFixed(0)}%`} />
        <StatCard
          label="Execution"
          value={fixture.executionRoute === "automated" ? "Automated" : "Human Review Required"}
          highlight={fixture.executionRoute === "human_review"}
        />
      </div>
      <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Execution Router</p>
        <p className="text-xs text-gray-400">
          {fixture.executionRoute === "automated"
            ? "Route to automated payout system."
            : "Route to human review queue. No payout until review complete."}
        </p>
      </div>
    </div>
  );
}

function LearningsTab({ locale }: { locale: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] p-6 space-y-4">
      <h3 className="text-sm font-bold text-white">{locale === "zh" ? "持续学习" : "Continuous Learning"}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">
        {locale === "zh"
          ? "已审查的案件可作为未来政策咨询的先例。人类审查的结果将反馈到系统中，以改进未来的裁决。"
          : "Reviewed cases can later be used as precedents for future policy consultation. Human-reviewed outcomes feed back into the system to improve future decisions."}
      </p>
      <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Status</p>
        <p className="text-xs text-gray-400">Placeholder — learning pipeline not yet active.</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3">
      <p className="text-[10px] font-bold uppercase text-gray-500">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${highlight ? "text-[#E84360]" : "text-white"}`}>{value}</p>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 pt-2">{title}</p>;
}

function EvidenceRow({ item, color }: { item: NonNullable<ReturnType<typeof getTribunalFixture>>["evidence"][0]; color: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">{item.label}</span>
        <span className={`text-[10px] font-bold uppercase ${color}`}>{item.category}</span>
      </div>
      {item.detail && <p className="text-xs text-gray-500 mt-1">{item.detail}</p>}
    </div>
  );
}
