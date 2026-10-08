"use client";

import { memo, useMemo, useState } from "react";
import { TypingDots } from "@/src/components/TypingDots";
import { Avatar } from "@/src/components/Avatar";

export type BubbleSide = "left" | "right";

export interface ChatMessage {
  id: string;
  side: BubbleSide;
  speaker: string;
  speakerTitle: string;
  text: string;
  badge?: string;
  targetLabel?: string;
  imageUrl?: string;
}

// -----------------------------------------------------------------------------
// Markdown cleanup
// -----------------------------------------------------------------------------

function stripMarkdown(s: string): string {
  return s
    // fenced code blocks
    .replace(/```[\s\S]*?```/g, "")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // bold
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    // italic
    .replace(/\*([^*]+)\*/g, "$1")
    // underline
    .replace(/__([^_]+)__/g, "$1")
    // headings
    .replace(/#{1,6}\s+/g, "")
    // markdown links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // unordered lists
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // ordered lists
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // blockquotes
    .replace(/^\s*>\s+/gm, "")
    .trim();
}


// -----------------------------------------------------------------------------
// ChatBubble
// -----------------------------------------------------------------------------

function ChatBubbleImpl({
  msg,
}: {
  msg: ChatMessage;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isRight = msg.side === "right";

  const maxLength = 180;

  const hasImage = Boolean(msg.imageUrl);

  /*
   * Clean markdown before calculating/truncating the displayed text.
   *
   * This prevents markdown syntax from consuming part of the 180-character
   * limit and ensures the user only sees clean text.
   */
  const cleanedText = useMemo(() => {
    return stripMarkdown(msg.text || "");
  }, [msg.text]);

  const isLongText = cleanedText.length > maxLength;

  const displayedText = useMemo(() => {
    if (!isLongText || isExpanded) {
      return cleanedText;
    }

    return cleanedText.slice(0, maxLength) + "…";
  }, [
    cleanedText,
    isLongText,
    isExpanded,
  ]);

  // ---------------------------------------------------------------------------
  // Determine bubble style based on speaker role.
  //
  // This logic intentionally follows FunctionalChatBubble exactly.
  // ---------------------------------------------------------------------------

  const s = msg.speaker.toUpperCase();

  let bubbleClass: string;

  if (s.includes("DRIVER")) {
    // Driver Advocate — black bubble, right side
    bubbleClass =
      "bg-slate-800 text-white rounded-tr-none";
  } else if (s.includes("RIDER")) {
    // Rider Advocate — gray bubble, left side
    bubbleClass =
      "bg-gray-100 text-slate-800 rounded-tl-none";
  } else if (s.includes("PROSECUTOR")) {
    // Prosecutor — soft amber/pink
    bubbleClass =
      "bg-[#FFEBCD] text-slate-800 rounded-tl-none";
  } else if (s.includes("POLICY")) {
    // Policy Consultant — soft emerald
    bubbleClass =
      "bg-[#4682B4] text-white rounded-tr-none";
  } else {
    // Default fallback
    bubbleClass =
      "bg-gray-100 text-slate-800 rounded-tl-none";
  }

  return (
    <div
      className={`flex flex-col my-2.5 ${
        isRight
          ? "items-end"
          : "items-start"
      }`}
    >
      {/* -----------------------------------------------------------------
          Speaker Header
          ----------------------------------------------------------------- */}

      <div
        className={`flex items-center gap-1.5 mb-1 px-1 text-[12px] text-gray-500 ${
          isRight
            ? "flex-row-reverse"
            : ""
        }`}
      >
        <span className="font-normal text-slate-700">
          {msg.speakerTitle}
        </span>

        {msg.targetLabel && (
          <span className="text-gray-400">
            {isRight? "←" : "→"}
          </span>
        )}

        {msg.targetLabel && (
          <span className="text-gray-400">
            {msg.targetLabel}
          </span>
        )}

        {/* {msg.badge && (
          <span className="px-1.5 py-0.2 text-[10px] bg-slate-100 text-slate-800 rounded font-normal">
            {msg.badge}
          </span>
        )} */}
      </div>

      {/* -----------------------------------------------------------------
          Avatar + Bubble
          
          The bubble itself keeps FunctionalChatBubble's exact styling.
          The avatar is simply added beside it.
          ----------------------------------------------------------------- */}

      <div
        className={`flex items-start gap-2 ${
          isRight
            ? "flex-row-reverse"
            : ""
        }`}
      >
        <Avatar
          speaker={msg.speaker}
        />

        {/* Bubble Content — FunctionalChatBubble styling unchanged */}
        <div
          className={`max-w-[75%] rounded-2xl ${hasImage ? "p-1.5" : "px-4 py-2.5"} text-[14px] leading-5 transition-all ${bubbleClass}`}
        >
          {hasImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={msg.imageUrl}
              alt={displayedText || "Uploaded evidence"}
              className="w-full max-h-56 rounded-xl object-cover"
            />
          )}

          <p className={hasImage ? "px-2 pt-1.5 pb-1 text-[13px] whitespace-pre-wrap break-words" : "whitespace-pre-wrap break-words"}>
            {displayedText}
          </p>

          {/* Show More / Show Less Toggle Button */}
          {isLongText && (
            <button
              onClick={() =>
                setIsExpanded(
                  !isExpanded
                )
              }
              className={`mt-2 text-[10px] font-normal underline focus:outline-none transition-colors ${
                isRight
                  ? "text-slate-100 hover:text-white"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {isExpanded
                ? "收起 (Show Less)"
                : "展开全部 (Show More)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChatBubble = memo(
  ChatBubbleImpl
);

// 在 ChatBubble.tsx 文件底部追加导出 TypingBubble 组件

export interface TypingConfig {
  speaker: string;
  speakerTitle: string;
  side: BubbleSide;
}

export const TypingBubble = memo(function TypingBubble({
  config,
}: {
  config: TypingConfig;
}) {
  const isRight = config.side === "right";
  const s = config.speaker.toUpperCase();

  // 复用 ChatBubbleImpl 中的角色气泡配色逻辑
  let bubbleClass: string;
  let dotColorClass: string;

  if (s.includes("DRIVER")) {
    bubbleClass = "bg-slate-800 text-white rounded-tr-none";
    dotColorClass = "bg-slate-300"; // 暗色背景用浅色点
  } else if (s.includes("RIDER")) {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tl-none";
    dotColorClass = "bg-slate-500";
  } else if (s.includes("PROSECUTOR")) {
    bubbleClass = "bg-[#FFEBCD] text-slate-800 rounded-tl-none";
    dotColorClass = "bg-amber-700";
  } else if (s.includes("POLICY")) {
    bubbleClass = "bg-[#4682B4] text-white rounded-tr-none";
    dotColorClass = "bg-blue-100";
  } else {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tl-none";
    dotColorClass = "bg-slate-500";
  }

  return (
    <div
      className={`flex flex-col my-2.5 transition-all duration-300 animate-fadeIn ${
        isRight ? "items-end" : "items-start"
      }`}
    >
      {/* 角色 Header & 正在输入指示 */}
      <div
        className={`flex items-center gap-1.5 mb-1 px-1 text-[11px] text-gray-400 ${
          isRight ? "flex-row-reverse" : ""
        }`}
      >
        <span className="font-medium text-slate-600">
          {config.speakerTitle}
        </span>
        {/* <span className="text-gray-400 animate-pulse">正在思考中...</span> */}
      </div>

      {/* Avatar 与 Typing 气泡主体 */}
      <div
        className={`flex items-center gap-2 ${
          isRight ? "flex-row-reverse" : ""
        }`}
      >
        <Avatar speaker={config.speaker} />

        <div className={`px-4 py-3 rounded-2xl ${bubbleClass}`}>
          <TypingDots />
        </div>
      </div>
    </div>
  );
});