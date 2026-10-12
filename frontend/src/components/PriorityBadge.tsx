"use client";

import type { PriorityTier } from "@/src/lib/api";
import { enumLabel, useI18n } from "@/src/i18n";
import { priorityLabel } from "@/src/lib/reviewFormat";

const CONFIG: Record<PriorityTier, { className: string }> = {
  URGENT: { className: "bg-[#E84360] text-white border-[#E84360]" },
  HIGH_PRIORITY: { className: "bg-amber-100 text-amber-900 border-amber-300" },
  STANDARD: { className: "bg-gray-100 text-gray-600 border-gray-300" },
};

export default function PriorityBadge({ tier }: { tier: PriorityTier }) {
  const c = CONFIG[tier] ?? CONFIG.STANDARD;
  const { t, locale } = useI18n();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.className}`}>
      {locale === "en" ? priorityLabel(tier) : enumLabel(t, tier)}
    </span>
  );
}