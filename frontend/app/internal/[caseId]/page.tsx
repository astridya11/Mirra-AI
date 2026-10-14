"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@/src/hooks/useTranslation";
import { useI18n } from "@/src/context/I18nContext";
import { getTribunalFixture } from "@/src/lib/tribunalFixtures";
import { getCaseResult } from "@/src/lib/api";
import type { CaseResult } from "@/src/types";
import {
  buildEvidenceFromCaseResult,
  buildFraudSignalsFromCaseResult,
} from "@/src/lib/liveTribunalAdapter";

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
  const [liveResult, setLiveResult] = useState<CaseResult | null>(null);
  const [liveLoading, setLiveLoading] = useState(() => !getTribunalFixture(caseId));

  const fixture = getTribunalFixture(caseId);

  useEffect(() => {
    if (!fixture && liveLoading) {
      let cancelled = false;
      getCaseResult(caseId)
        .then((result) => {
          if (!cancelled) setLiveResult(result);
        })
        .catch(() => {
          if (!cancelled) setLiveResult(null);
        })
        .finally(() => {
          if (!cancelled) setLiveLoading(false);
        });
      return () => { cancelled = true; };
    }
  }, [caseId, fixture, liveLoading]);

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
        {!fixture && !liveResult && liveLoading && (
          <div className="rounded-lg border border-gray-800 bg-[#111827] p-8 text-center">
            <p className="text-sm text-gray-500">Loading live case data...</p>
          </div>
        )}
        {!fixture && !liveResult && !liveLoading && (
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

        {liveResult && activeTab === "overview" && (
          <OverviewLiveTab result={liveResult} />
        )}
        {liveResult && activeTab === "evidence" && (
          <EvidenceLiveTab result={liveResult} />
        )}
        {liveResult && activeTab === "policy" && (
          <PolicyLiveTab result={liveResult} />
        )}
        {liveResult && activeTab === "decision" && (
          <DecisionLiveTab result={liveResult} />
        )}
        {(fixture || liveResult) && activeTab === "learnings" && (
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

function OverviewLiveTab({ result }: { result: CaseResult }) {
  const meta = result.case_metadata;
  const verdict = result.judge_verdict;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Case ID" value={meta.case_id} />
      <StatCard label="Dispute Type" value={meta.dispute_type} />
      <StatCard label="Current State" value={meta.current_state} />
      <StatCard label="Resolution Channel" value={meta.resolution_channel} highlight={meta.resolution_channel === "ESCALATED_HUMAN_REVIEW"} />
      <StatCard label="Judge Confidence" value={verdict ? `${(verdict.confidence_score * 100).toFixed(0)}%` : "N/A"} />
      <StatCard label="Ruling" value={verdict?.ruling_type || "N/A"} />
    </div>
  );
}

function EvidenceLiveTab({ result }: { result: CaseResult }) {
  const evidence = buildEvidenceFromCaseResult(result);
  const fraud = buildFraudSignalsFromCaseResult(result);
  const images = result.dispute_claim?.image_evidence ?? [];
  const receipts = result.dispute_claim?.receipt_evidence ?? [];
  const prosecutor = result.prosecutor_findings;
  const fraudAssessment = result.bonus_modules?.fraud_assessment;

  return (
    <div className="space-y-6">
      {/* Photo Evidence */}
      {images.length > 0 && (
        <div className="space-y-3">
          <SectionTitle title="Photo Evidence" />
          {images.map((img, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{img.image_id || `IMG-${i + 1}`}</span>
                {img.provider_result?.stain_damage_classification && (
                  <span className="text-[10px] font-bold uppercase text-[#0D9488]">
                    {img.provider_result.stain_damage_classification}
                  </span>
                )}
              </div>
              {img.provider_result?.damage_severity && (
                <p className="text-xs text-gray-500">Severity: {img.provider_result.damage_severity}</p>
              )}
              {img.exif_timestamp && <p className="text-xs text-gray-500">EXIF: {img.exif_timestamp}</p>}
              {img.exif_gps_location && (
                <p className="text-xs text-gray-500">
                  GPS: {img.exif_gps_location.latitude}, {img.exif_gps_location.longitude}
                </p>
              )}
              {img.known_matches && Object.keys(img.known_matches).length > 0 && (
                <p className="text-xs text-amber-400">
                  Recycled image match: {String(Object.values(img.known_matches)[0])}
                </p>
              )}
              {img.provider_result?.is_ai_generated !== undefined && (
                <p className="text-xs text-gray-500">
                  AI-generated: {img.provider_result.is_ai_generated ? "Yes" : "No"} (
                  {Math.round((img.provider_result.ai_generated_confidence ?? 0) * 100)}%)
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Receipt Evidence */}
      {receipts.length > 0 && (
        <div className="space-y-3">
          <SectionTitle title="Receipt Evidence" />
          {receipts.map((rcp, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{rcp.receipt_id || `RCP-${i + 1}`}</span>
                {rcp.ocr_result?.ocr_confidence !== undefined && (
                  <span className="text-[10px] font-bold uppercase text-[#0D9488]">
                    OCR {Math.round(rcp.ocr_result.ocr_confidence * 100)}%
                  </span>
                )}
              </div>
              {rcp.ocr_result?.merchant_name && (
                <p className="text-xs text-gray-500">Merchant: {rcp.ocr_result.merchant_name}</p>
              )}
              {rcp.ocr_result?.amount !== undefined && (
                <p className="text-xs text-gray-500">
                  Amount: {rcp.ocr_result.currency} {rcp.ocr_result.amount}
                </p>
              )}
              {rcp.ocr_result?.receipt_date && (
                <p className="text-xs text-gray-500">Date: {rcp.ocr_result.receipt_date}</p>
              )}
              {rcp.recycled_receipt_detected && (
                <p className="text-xs text-amber-400">Recycled receipt detected</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Prosecutor Findings */}
      {prosecutor && (
        <div className="space-y-3">
          <SectionTitle title="Prosecutor Findings" />
          {prosecutor.verified_facts && prosecutor.verified_facts.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Verified</p>
              {prosecutor.verified_facts.map((f, i) => (
                <p key={i} className="text-xs text-[#0D9488]">{f.description}</p>
              ))}
            </div>
          )}
          {prosecutor.disputed_facts && prosecutor.disputed_facts.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Disputed</p>
              {prosecutor.disputed_facts.map((f, i) => (
                <p key={i} className="text-xs text-[#B45309]">{f.description}</p>
              ))}
            </div>
          )}
          {prosecutor.missing_facts && prosecutor.missing_facts.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Missing</p>
              {prosecutor.missing_facts.map((f, i) => (
                <p key={i} className="text-xs text-gray-500">{f.description}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fraud Assessment */}
      {fraudAssessment && (
        <div className="space-y-3">
          <SectionTitle title="Fraud Assessment" />
          <div className="rounded-lg border border-gray-800 bg-[#111827] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Risk Score</span>
              <span className="text-[10px] font-bold uppercase text-gray-400">
                {Math.round((fraudAssessment.fraud_risk_score ?? 0) * 100)}%
              </span>
            </div>
            {fraudAssessment.risk_factors && fraudAssessment.risk_factors.length > 0 && (
              <ul className="list-disc list-inside text-xs text-gray-500 space-y-0.5">
                {fraudAssessment.risk_factors.map((rf, i) => (
                  <li key={i}>{rf}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Legacy evidence rows */}
      <div className="space-y-4">
        <SectionTitle title="Verified" />
        {evidence.filter((e) => e.category === "verified").map((item) => (
          <EvidenceRow key={item.id} item={item} color="text-[#0D9488]" />
        ))}
        <SectionTitle title="Disputed" />
        {evidence.filter((e) => e.category === "disputed").map((item) => (
          <EvidenceRow key={item.id} item={item} color="text-[#B45309]" />
        ))}
        <SectionTitle title="Missing" />
        {evidence.filter((e) => e.category === "missing").map((item) => (
          <EvidenceRow key={item.id} item={item} color="text-gray-500" />
        ))}
        {fraud.length > 0 && (
          <>
            <SectionTitle title="Fraud Signals" />
            {fraud.map((signal) => (
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
    </div>
  );
}

function PolicyLiveTab({ result }: { result: CaseResult }) {
  const policy = result.policy_consultation?.suggestion;
  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] p-6 space-y-4">
      <h3 className="text-sm font-bold text-white">Applicable Policy</h3>
      <p className="text-sm text-gray-300 leading-relaxed">
        {policy?.rationale || "Policy consultation completed."}
      </p>
      {policy?.applicable_clauses?.map((c) => (
        <div key={c.clause_id} className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
          <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">{c.clause_id}</p>
          <p className="text-xs text-gray-400">{c.clause_text_summary}</p>
        </div>
      ))}
    </div>
  );
}

function DecisionLiveTab({ result }: { result: CaseResult }) {
  const verdict = result.judge_verdict;
  const meta = result.case_metadata;
  const isEscalated = meta.resolution_channel === "ESCALATED_HUMAN_REVIEW";
  const confidence = verdict?.confidence_score ?? 0;
  const hasValidConfidence = verdict !== undefined && verdict.confidence_score !== undefined;
  const hasVerdict = verdict !== undefined && verdict.ruling_type !== undefined;

  return (
    <div className="rounded-lg border border-gray-800 bg-[#111827] p-6 space-y-4">
      <h3 className="text-sm font-bold text-white">Judge Result</h3>
      {!hasVerdict && (
        <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
          <p className="text-[10px] font-bold uppercase text-[#E84360] mb-1">Status</p>
          <p className="text-xs text-gray-400">Judge result incomplete / unavailable. No financial verdict has been determined.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Confidence"
          value={hasValidConfidence ? `${(confidence * 100).toFixed(0)}%` : "Incomplete"}
          highlight={!hasValidConfidence}
        />
        <StatCard
          label="Execution"
          value={isEscalated ? "Human Review Required" : "Automated"}
          highlight={isEscalated}
        />
      </div>
      <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Execution Router</p>
        <p className="text-xs text-gray-400">
          {isEscalated
            ? "Route to human review queue. No payout until review complete."
            : "Route to automated payout system."}
        </p>
      </div>
      {verdict?.reasoning_summary && (
        <div className="rounded bg-[#0B0F19] border border-gray-800 px-4 py-3">
          <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Reasoning</p>
          <p className="text-xs text-gray-400">{verdict.reasoning_summary}</p>
        </div>
      )}
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
