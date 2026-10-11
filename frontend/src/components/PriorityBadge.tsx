import type { PriorityTier } from "@/src/lib/api";

const CONFIG: Record<PriorityTier, { text: string; className: string }> = {
  URGENT: { text: "Urgent · fast-track", className: "bg-[#E84360] text-white border-[#E84360]" },
  HIGH_PRIORITY: { text: "High priority", className: "bg-amber-100 text-amber-900 border-amber-300" },
  STANDARD: { text: "Standard", className: "bg-gray-100 text-gray-600 border-gray-300" },
};

export default function PriorityBadge({ tier }: { tier: PriorityTier }) {
  const c = CONFIG[tier] ?? CONFIG.STANDARD;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.className}`}>
      {c.text}
    </span>
  );
}