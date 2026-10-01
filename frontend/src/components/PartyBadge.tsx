/**
 * PartyBadge — colored badge identifying an agent party/role.
 */

interface PartyBadgeProps {
  speaker: string;
  className?: string;
}

const partyConfig: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  RIDER_ADVOCATE: { label: "Rider Advocate", bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  DRIVER_ADVOCATE: { label: "Driver Advocate", bg: "bg-teal-50", text: "text-teal-700", ring: "ring-teal-200" },
  RIDER: { label: "Rider", bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  DRIVER: { label: "Driver", bg: "bg-teal-50", text: "text-teal-700", ring: "ring-teal-200" },
  PROSECUTOR: { label: "Prosecutor", bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
  JUDGE: { label: "AI Judge", bg: "bg-slate-100", text: "text-slate-800", ring: "ring-slate-300" },
  POLICY: { label: "Policy Agent", bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  POLICY_AGENT: { label: "Policy Agent", bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  STATE_ENGINE: { label: "State Engine", bg: "bg-slate-100", text: "text-slate-800", ring: "ring-slate-300" },
};

export function PartyBadge({ speaker, className = "" }: PartyBadgeProps) {
  const config = partyConfig[speaker] || {
    label: speaker,
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${config.bg} ${config.text} ${config.ring} ${className}`}
    >
      {config.label}
    </span>
  );
}

export function getPartyColor(speaker: string): string {
  const s = speaker.toUpperCase();
  if (s.includes("RIDER")) return "indigo";
  if (s.includes("DRIVER")) return "teal";
  if (s.includes("PROSECUTOR")) return "amber";
  if (s.includes("JUDGE") || s.includes("STATE")) return "slate";
  return "slate";
}
