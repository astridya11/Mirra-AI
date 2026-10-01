/**
 * StatusPill — small centered pill for phase transitions.
 * Shows user-friendly, short status messages (no technical data).
 *
 * Example: "Evidence confirmed", "Investigating", "Policy review done", etc.
 */

"use client";

import { memo } from "react";

interface StatusPillProps {
  text: string;
}

function StatusPillImpl({ text }: StatusPillProps) {
  return (
    <div className="flex justify-center my-3 animate-fade-in">
      <div className="flex items-center gap-2 rounded-full bg-[#FDF1F3] px-4 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#E84360] animate-pulse-dot" />
        <span className="text-[12px] font-semibold text-[#E84360]">{text}</span>
      </div>
    </div>
  );
}

export const StatusPill = memo(StatusPillImpl);
