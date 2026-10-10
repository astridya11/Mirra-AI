"use client";

import { useEffect, useState } from "react";
import type { SlaStatus } from "@/src/lib/api";

const STYLES: Record<SlaStatus, string> = {
  ON_TRACK: "bg-emerald-100 text-emerald-800 border-emerald-300",
  AT_RISK: "bg-amber-100 text-amber-900 border-amber-300",
  BREACHED: "bg-red-100 text-red-800 border-red-300",
  RESOLVED: "bg-slate-100 text-slate-600 border-slate-300",
};

const LABELS: Record<SlaStatus, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BREACHED: "Breached",
  RESOLVED: "Resolved",
};

function format(seconds: number) {
  const abs = Math.abs(Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  deadline: string;          // ISO string
  totalSeconds: number;
  resolved?: boolean;
}

export default function SlaBadge({ deadline, totalSeconds, resolved }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resolved) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resolved]);

  const remaining = (new Date(deadline).getTime() - now) / 1000;
  const status: SlaStatus = resolved
    ? "RESOLVED"
    : remaining <= 0
    ? "BREACHED"
    : remaining / Math.max(totalSeconds, 1) <= 0.3
    ? "AT_RISK"
    : "ON_TRACK";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
      {!resolved && (
        <span className="tabular-nums">
          {remaining >= 0 ? format(remaining) : `+${format(remaining)} overdue`}
        </span>
      )}
    </span>
  );
}