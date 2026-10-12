/**
 * Shared SLA state logic — single source of truth for SlaBadge and SlaBar.
 *
 * Extracted from the original SlaBadge component so both the badge and the
 * burn-down bar compute status, remaining seconds and labels identically.
 */

import type { SlaStatus } from "@/src/lib/api";

export interface SlaState {
  status: SlaStatus;
  /** Seconds left until the deadline. Negative when breached. */
  remainingSeconds: number;
  /** 0–1 fraction of total SLA time still remaining (clamped). */
  fractionLeft: number;
  /** Human label, e.g. "3:12", "+0:45 overdue", "2 h 26 min left", "Reviewed". */
  label: string;
}

/** AT_RISK threshold: when ≤ 30% of total SLA time remains. */
const AT_RISK_FRACTION = 0.3;

/**
 * Format seconds as m:ss (under 60 minutes) or "X h Y min" (60 minutes or more).
 * Works with negative values (absolute value used).
 */
function formatClock(seconds: number): string {
  const abs = Math.abs(Math.floor(seconds));
  if (abs >= 3600) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    return `${h} h ${m} min`;
  }
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Build the human-readable SLA label.
 *
 * - remaining >= 0, |remaining| >= 60 min: "X h Y min left"
 * - remaining >= 0, |remaining| < 60 min: "m:ss" (e.g. "3:12")
 * - remaining < 0, |remaining| >= 60 min: "+X h Y min overdue"
 * - remaining < 0, |remaining| < 60 min: "+m:ss overdue"
 */
function formatSlaLabel(remaining: number): string {
  const abs = Math.abs(Math.floor(remaining));
  if (abs >= 3600) {
    return remaining >= 0
      ? `${formatClock(remaining)} left`
      : `+${formatClock(remaining)} overdue`;
  }
  return remaining >= 0
    ? formatClock(remaining)
    : `+${formatClock(remaining)} overdue`;
}

/**
 * Compute SLA state from a deadline ISO string and total SLA seconds.
 *
 * - `resolved` → status RESOLVED, label "Reviewed".
 * - `remaining <= 0` → status BREACHED, label "+m:ss overdue" or "+X h Y min overdue".
 * - `remaining / total <= 0.3` → status AT_RISK.
 * - otherwise → ON_TRACK.
 *
 * `nowMs` is injectable for testing; defaults to Date.now().
 */
export function slaState(
  deadline: string,
  totalSeconds: number,
  nowMs: number = Date.now(),
  resolved: boolean = false,
): SlaState {
  if (resolved) {
    return {
      status: "RESOLVED",
      remainingSeconds: 0,
      fractionLeft: 0,
      label: "Reviewed",
    };
  }

  const remaining = (new Date(deadline).getTime() - nowMs) / 1000;
  const safeTotal = Math.max(totalSeconds, 1);
  const fractionLeft = Math.max(0, Math.min(1, remaining / safeTotal));

  let status: SlaStatus;
  if (remaining <= 0) {
    status = "BREACHED";
  } else if (fractionLeft <= AT_RISK_FRACTION) {
    status = "AT_RISK";
  } else {
    status = "ON_TRACK";
  }

  const label = formatSlaLabel(remaining);

  return { status, remainingSeconds: remaining, fractionLeft, label };
}
