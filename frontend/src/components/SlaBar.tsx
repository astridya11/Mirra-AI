"use client";

import { useEffect, useState } from "react";
import { slaState } from "@/src/lib/sla";
import type { SlaStatus } from "@/src/lib/api";

/**
 * Burn-down bar: a thin horizontal bar that drains as SLA time runs out,
 * with the m:ss countdown beside it.
 *
 * - On track = emerald-600, at risk = amber-500, breached = red-600 (bar full,
 *   text "+m:ss overdue").
 * - Resolved → grey full bar, text "Reviewed".
 * - Ticks every 1 s (not when resolved).
 * - Respects prefers-reduced-motion (no width transition).
 */

const FILL_COLORS: Record<SlaStatus, string> = {
  ON_TRACK: "bg-emerald-600",
  AT_RISK: "bg-amber-500",
  BREACHED: "bg-red-600",
  RESOLVED: "bg-gray-300",
};

const TEXT_COLORS: Record<SlaStatus, string> = {
  ON_TRACK: "text-gray-600",
  AT_RISK: "text-amber-600",
  BREACHED: "text-red-600",
  RESOLVED: "text-gray-400",
};

const STATUS_WORDS: Record<SlaStatus, string> = {
  ON_TRACK: "on track",
  AT_RISK: "at risk",
  BREACHED: "breached",
  RESOLVED: "reviewed",
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function formatAria(seconds: number, status: SlaStatus): string {
  if (status === "RESOLVED") return "SLA resolved";
  if (status === "BREACHED") {
    const abs = Math.abs(Math.floor(seconds));
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const parts: string[] = [];
    if (m > 0) parts.push(`${m} minute${m !== 1 ? "s" : ""}`);
    parts.push(`${s} second${s !== 1 ? "s" : ""}`);
    return `SLA ${parts.join(" and ")} overdue, ${STATUS_WORDS[status]}`;
  }
  const abs = Math.abs(Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} minute${m !== 1 ? "s" : ""}`);
  parts.push(`${s} second${s !== 1 ? "s" : ""}`);
  return `SLA ${parts.join(" and ")} left, ${STATUS_WORDS[status]}`;
}

interface Props {
  deadline: string;
  totalSeconds: number;
  resolved?: boolean;
}

export default function SlaBar({ deadline, totalSeconds, resolved }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (resolved) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resolved]);

  const { status, remainingSeconds, fractionLeft, label } = slaState(
    deadline,
    totalSeconds,
    now,
    resolved,
  );

  // Resolved → full grey bar. Breached → full red bar.
  const widthPct =
    status === "RESOLVED" || status === "BREACHED"
      ? 100
      : Math.round(fractionLeft * 100);

  const ariaLabel = formatAria(remainingSeconds, status);

  const transitionStyle = reducedMotion
    ? undefined
    : { transition: "width 1s linear" };

  return (
    <div className="flex items-center gap-2">
      {/* Track */}
      <div
        className="relative h-1.5 w-[120px] max-w-[160px] flex-1 rounded-full bg-[#E5E7EB] md:flex-none md:w-[72px]"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Fill */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${FILL_COLORS[status]}`}
          style={{ width: `${widthPct}%`, ...transitionStyle }}
        />
      </div>
      {/* Countdown text */}
      <span
        className={`shrink-0 whitespace-nowrap text-xs font-medium tabular-nums ${TEXT_COLORS[status]}`}
        style={{ minWidth: "3.5rem" }}
      >
        {label}
      </span>
    </div>
  );
}
