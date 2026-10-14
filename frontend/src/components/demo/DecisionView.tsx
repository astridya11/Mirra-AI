"use client";

import type { DecisionStatus, Party } from "@/src/types/session";
import { useTranslation } from "@/src/hooks/useTranslation";
import { useI18n } from "@/src/context/I18nContext";

interface DecisionViewProps {
  status: DecisionStatus;
  amount?: string;
  party: Party;
  executionRoute: "automated" | "human_review";
}

export default function DecisionView({ status, amount, party, executionRoute }: DecisionViewProps) {
  const t = useTranslation();
  const { locale } = useI18n();

  const isPassenger = party === "passenger";

  const config: Record<DecisionStatus, { titleEn: string; titleZh: string; descEn: string; descZh: string; color: string }> = {
    pending: {
      titleEn: "Decision Pending",
      titleZh: "裁决待定",
      descEn: "The tribunal is reviewing your case.",
      descZh: "法庭正在审查您的案件。",
      color: "text-[#6B7280]",
    },
    partial_refund: {
      titleEn: isPassenger ? `${amount} refund` : `${amount} refund issued to rider`,
      titleZh: isPassenger ? `退款 ${amount}` : `已向乘客退款 ${amount}`,
      descEn: isPassenger
        ? "A partial refund has been approved based on verified GPS evidence."
        : "A partial refund has been issued to the rider based on verified GPS evidence.",
      descZh: isPassenger
        ? "基于已核实的 GPS 证据，部分退款已获批准。"
        : "基于已核实的 GPS 证据，已向乘客发放部分退款。",
      color: "text-[#0D9488]",
    },
    no_refund: {
      titleEn: "No refund",
      titleZh: "不予退款",
      descEn: isPassenger
        ? "No refund was approved. The evidence supports the charge."
        : "No refund was issued. The evidence supports the charge.",
      descZh: isPassenger
        ? "未批准退款。证据支持该费用。"
        : "未发放退款。证据支持该费用。",
      color: "text-[#111827]",
    },
    human_review: {
      titleEn: "Under human review",
      titleZh: "正在人工审查中",
      descEn: isPassenger
        ? "No fee charged while review is pending."
        : "No payout while review is pending.",
      descZh: isPassenger
        ? "审查期间不收取费用。"
        : "审查期间不发放款项。",
      color: "text-[#B45309]",
    },
  };

  const cfg = config[status];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center space-y-4">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#F9FAFB]">
        <svg className="h-8 w-8 text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      </div>

      <h3 className={`text-xl font-bold ${cfg.color}`}>{locale === "zh" ? cfg.titleZh : cfg.titleEn}</h3>
      <p className="text-sm text-[#6B7280]">{locale === "zh" ? cfg.descZh : cfg.descEn}</p>

      {executionRoute === "automated" && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#F0FDFA] px-3 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[#0D9488]" />
          <span className="text-[10px] font-bold text-[#0D9488] uppercase">{t("decision.automated")}</span>
        </div>
      )}

      {executionRoute === "human_review" && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF3C7] px-3 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[#B45309]" />
          <span className="text-[10px] font-bold text-[#B45309] uppercase">{t("decision.humanReview")}</span>
        </div>
      )}

      {(status === "partial_refund" || status === "no_refund") && (
        <button className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-medium text-[#6B7280] hover:bg-gray-50 transition-colors">
          {t("decision.requestHumanReview")}
        </button>
      )}

      {status === "human_review" && (
        <button className="block w-full rounded-xl bg-[#111827] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#374151] transition-colors">
          {t("decision.openHumanReview")}
        </button>
      )}
    </div>
  );
}
