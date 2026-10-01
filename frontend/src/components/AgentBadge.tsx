/**
 * AgentBadge — minimal colored badge for agent identification.
 */

interface AgentBadgeProps {
  role: string;
  className?: string;
}

const config: Record<string, { label: string; color: string; bg: string }> = {
  PROSECUTOR: { label: "Prosecutor", color: "text-[#D97706]", bg: "bg-[#FFFBEB]" },
  RIDER_ADVOCATE: { label: "Rider Advocate", color: "text-[#E84360]", bg: "bg-[#FDF1F3]" },
  DRIVER_ADVOCATE: { label: "Driver Advocate", color: "text-[#0D9488]", bg: "bg-[#F0FDFA]" },
  JUDGE: { label: "AI Judge", color: "text-[#1E293B]", bg: "bg-[#F1F5F9]" },
  POLICY_AGENT: { label: "Policy Agent", color: "text-[#6366F1]", bg: "bg-[#EEF2FF]" },
  STATE_ENGINE: { label: "System", color: "text-[#6B7280]", bg: "bg-[#F3F4F6]" },
};

export function AgentBadge({ role, className = "" }: AgentBadgeProps) {
  const c = config[role] || { label: role, color: "text-[#6B7280]", bg: "bg-[#F3F4F6]" };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${c.color} ${c.bg} ${className}`}>
      {c.label}
    </span>
  );
}

export function getAgentColor(role: string): string {
  const r = role.toUpperCase();
  if (r.includes("RIDER")) return "#E84360";
  if (r.includes("DRIVER")) return "#0D9488";
  if (r.includes("PROSECUTOR")) return "#D97706";
  if (r.includes("JUDGE")) return "#1E293B";
  if (r.includes("POLICY")) return "#6366F1";
  return "#6B7280";
}

export function getAgentInitials(role: string): string {
  const map: Record<string, string> = {
    PROSECUTOR: "PA",
    RIDER_ADVOCATE: "RA",
    DRIVER_ADVOCATE: "DA",
    JUDGE: "JD",
    POLICY_AGENT: "PL",
    STATE_ENGINE: "SE",
  };
  return map[role] || role.slice(0, 2).toUpperCase();
}
