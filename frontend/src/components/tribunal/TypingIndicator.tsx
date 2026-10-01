/**
 * TypingIndicator — "typing..." animation for tribunal chat.
 * Shows when waiting for the next agent message.
 *
 * Reuses the TypingDots animation pattern from the project.
 */

"use client";

import { memo } from "react";

interface TypingIndicatorProps {
  side: "left" | "right" | "center";
}

function TypingIndicatorImpl({ side }: TypingIndicatorProps) {
  const justify =
    side === "left" ? "justify-start" : side === "right" ? "justify-end" : "justify-center";
  const avatarBg = side === "left" ? "bg-[#FDF1F3]" : side === "right" ? "bg-[#F0FDFA]" : "bg-[#FFFBEB]";
  const avatarColor = side === "left" ? "text-[#E84360]" : side === "right" ? "text-[#0D9488]" : "text-[#D97706]";
  const initials = side === "left" ? "RA" : side === "right" ? "DA" : "PA";

  return (
    <div className={`flex items-end gap-2 ${justify} animate-fade-in`}>
      {side !== "right" && (
        <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center flex-shrink-0`}>
          <span className={`text-[11px] font-bold ${avatarColor}`}>{initials}</span>
        </div>
      )}
      <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]"
              style={{
                animation: "typing-bounce 1.4s ease-in-out infinite",
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
      {side === "right" && (
        <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center flex-shrink-0`}>
          <span className={`text-[11px] font-bold ${avatarColor}`}>{initials}</span>
        </div>
      )}
    </div>
  );
}

export const TypingIndicator = memo(TypingIndicatorImpl);
