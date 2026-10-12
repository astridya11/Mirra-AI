"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PriorityBadge from "@/src/components/PriorityBadge";
import SlaBadge from "@/src/components/SlaBadge";
import { getCase, type ReviewCase } from "@/src/lib/api";
import { useI18n } from "@/src/i18n";

/**
 * Sidebar card for frontend/app/review/[caseId]/page.tsx: priority, SLA countdown and value.
 * The decision itself lives in the HUMAN REVIEW DECISION section at the end of the page.
 */
export default function ReviewSlaPanel({ caseId }: { caseId: string }) {
  const [c, setC] = useState<ReviewCase | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    const load = () =>
      getCase(caseId)
        .then((d) => alive && setC(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [caseId]);

  if (!c) return null;
  const resolved = c.status === "RESOLVED";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge tier={c.priority_level} />
        <SlaBadge deadline={c.sla_deadline} totalSeconds={c.sla_total_seconds} resolved={resolved} />
      </div>

      <dl className="text-sm space-y-1">
        <div className="flex justify-between">
          <dt className="text-gray-500">{t("sla.disputeValue")}</dt>
          <dd className="font-medium text-gray-900">
            S${c.dispute_value.toFixed(2)}
            {c.value_source === "mock" ? ` ${t("review.est")}` : ""}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">{t("sla.queueScore")}</dt>
          <dd className="font-medium text-gray-900 tabular-nums">{c.priority_score}</dd>
        </div>
      </dl>

      {resolved ? (
        <p className="text-sm text-gray-500">{t("review.reviewedBy", { name: c.resolved_by ?? "support" })}</p>
      ) : (
        <a href="#human-decision" className="block w-full rounded-lg bg-[#E84360] px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90">
          {t("sla.goToDecision")}
        </a>
      )}
      <Link href="/review" className="block text-center text-sm text-gray-500 hover:text-gray-800">
        {t("sla.backToQueue")}
      </Link>
    </div>
  );
}
