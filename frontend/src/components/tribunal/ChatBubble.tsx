/**
 * ChatBubble — conversation bubble for tribunal agent messages.
 *
 * Rider advocate → left (pink), Driver advocate → right (teal),
 * Prosecutor → center (neutral, with directional indicator).
 *
 * Features:
 *   - Avatar (initials circle, party-colored)
 *   - Markdown-stripped content from data.content
 *   - Expand/collapse for long messages (3–4 line clamp)
 *   - No raw JSON, no IDs, no timestamps, no evidence context
 *   - Spring-like fade-in animation
 */

"use client";

import { memo, useState } from "react";

export type BubbleSide = "left" | "right" | "center";

interface ChatBubbleProps {
  side: BubbleSide;
  speaker: string;
  /** The text to display (already cleaned of markdown). */
  text: string;
  /** Optional label for the prosecutor's target direction. */
  targetLabel?: string;
}

// --- Helpers ---

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .trim();
}

// --- Avatar ---

function Avatar({
  side,
  speaker,
}: {
  side: BubbleSide;
  speaker: string;
}) {
  if (side === "center") {
    // Prosecutor: small neutral avatar
    return (
      <div className="w-7 h-7 rounded-full bg-[#FFFBEB] flex items-center justify-center flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
      </div>
    );
  }

  const isRider = side === "left";
  const bg = isRider ? "bg-[#FDF1F3]" : "bg-[#F0FDFA]";
  const color = isRider ? "text-[#E84360]" : "text-[#0D9488]";
  const initials = isRider ? "RA" : "DA";

  return (
    <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center flex-shrink-0`}>
      <span className={`text-[11px] font-bold ${color}`}>{initials}</span>
    </div>
  );
}

// --- Bubble ---

function ChatBubbleImpl({ side, speaker, text, targetLabel }: ChatBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const cleaned = stripMarkdown(text || "");

  // Prosecutor center bubble
  if (side === "center") {
    return (
      <div className="flex items-start gap-2 justify-center my-2 animate-slide-up">
        <Avatar side={side} speaker={speaker} />
        <div className="max-w-[70%]">
          <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[15px] leading-relaxed text-[#111827]">
            <span
              className={`block ${expanded ? "" : "line-clamp-4"}`}
            >
              {cleaned || "…"}
            </span>
            {cleaned.length > 160 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[13px] text-[#E84360] font-medium mt-1"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
          {targetLabel && (
            <div className="flex items-center gap-1 mt-1 ml-2">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span className="text-[11px] text-[#9CA3AF]">{targetLabel}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isLeft = side === "left";

  return (
    <div
      className={`flex items-end gap-2 ${isLeft ? "justify-start" : "justify-end"} animate-slide-up`}
    >
      {isLeft && <Avatar side={side} speaker={speaker} />}
      <div className={`max-w-[75%] ${isLeft ? "" : "items-end"}`}>
        <div
          className={`px-4 py-2.5 text-[15px] leading-relaxed rounded-2xl ${
            isLeft
              ? "bg-[#F3F4F6] text-[#111827] rounded-tl-sm"
              : "bg-[#0D9488] text-white rounded-tr-sm"
          }`}
        >
          <span className={`block ${expanded ? "" : "line-clamp-4"}`}>
            {cleaned || "…"}
          </span>
          {cleaned.length > 160 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`text-[13px] font-medium mt-1 ${
                isLeft ? "text-[#E84360]" : "text-white/80"
              }`}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      </div>
      {!isLeft && <Avatar side={side} speaker={speaker} />}
    </div>
  );
}

export const ChatBubble = memo(ChatBubbleImpl);
