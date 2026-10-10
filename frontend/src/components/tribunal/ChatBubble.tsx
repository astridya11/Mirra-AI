"use client";

import { memo, useEffect, useMemo, useState } from "react";
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
  const [isImageOpen, setIsImageOpen] = useState(false);

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
  }, [cleanedText, isLongText, isExpanded]);

  // Close the full-screen image viewer with Escape.
  useEffect(() => {
    if (!isImageOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImageOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Prevent the background page from scrolling while viewing the image.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isImageOpen]);

  // ---------------------------------------------------------------------------
  // Bubble styling by speaker
  // ---------------------------------------------------------------------------

  const s = msg.speaker.toUpperCase();

  let bubbleClass: string;

  if (s.includes("DRIVER")) {
    bubbleClass = "bg-slate-800 text-white rounded-tr-none";
  } else if (s.includes("RIDER")) {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tl-none";
  } else if (s.includes("PROSECUTOR")) {
    bubbleClass = "bg-[#FFEBCD] text-slate-800 rounded-tl-none";
  } else if (s.includes("POLICY")) {
    bubbleClass = "bg-[#4682B4] text-white rounded-tr-none";
  } else {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tr-none";
  }

  return (
    <>
      <div
        className={`flex flex-col my-3 ${
          isRight ? "items-end" : "items-start"
        }`}
      >
        {/* Speaker Header */}

        <div
          className={`flex items-center gap-1.5 mb-2 px-1 text-[12px] text-gray-500 ${
            isRight ? "flex-row-reverse" : ""
          }`}
        >
          <span className="font-normal text-slate-700">
            {msg.speakerTitle}
          </span>

          {msg.targetLabel && (
            <span className="text-gray-400">
              {isRight ? "←" : "→"}
            </span>
          )}

          {msg.targetLabel && (
            <span className="text-gray-400 text-[11px] inline-block w-min break-words leading-[1.15]">
              {msg.targetLabel}
            </span>
          )}

          {msg.badge && (
            <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-800 rounded-xl font-normal">
              {msg.badge}
            </span>
          )}
        </div>

        {/* Avatar + Bubble */}

        <div
          className={`flex items-start gap-2 ${
            isRight ? "flex-row-reverse" : ""
          }`}
        >
          <Avatar speaker={msg.speaker} />

          <div
            className={`max-w-[75%] rounded-2xl ${
              hasImage ? "p-1.5" : "px-4 py-2.5"
            } text-[14px] leading-5 transition-all ${bubbleClass}`}
          >
            {hasImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <button
                type="button"
                onClick={() => setIsImageOpen(true)}
                className="group relative block w-full cursor-zoom-in overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Tap to view full image"
              >
                <img
                  src={msg.imageUrl}
                  alt={displayedText || "Uploaded evidence"}
                  className="block w-full max-h-56 rounded-md object-cover transition-opacity group-hover:opacity-90"
                />

                {/* Tap-to-open hint */}
                <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                  <span aria-hidden="true">⤢</span>
                </span>
              </button>
            )}

            <p
              className={
                hasImage
                  ? "px-2 pt-1.5 pb-1 text-[13px] whitespace-pre-wrap break-words"
                  : "whitespace-pre-wrap break-words"
              }
            >
              {displayedText}
            </p>

            {/* Show More / Show Less */}

            {isLongText && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
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

      {/* -----------------------------------------------------------------
          Full-Screen Image Viewer
          ----------------------------------------------------------------- */}

      {isImageOpen && msg.imageUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Full-size evidence image"
          onClick={() => setIsImageOpen(false)}
        >
          {/* Close Button */}

          <button
            type="button"
            onClick={() => setIsImageOpen(false)}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white transition-colors hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close full-size image"
          >
            ×
          </button>

          {/* Full Image — clicking the image itself does not close it */}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={msg.imageUrl}
            alt={msg.text || "Full-size uploaded evidence"}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] max-w-full select-none rounded-sm object-contain"
            draggable={false}
          />

          {/* Bottom hint */}

          <span className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-xs text-white/70">
            Tap outside the image to close
          </span>
        </div>
      )}
    </>
  );
}

export const ChatBubble = memo(ChatBubbleImpl);

// -----------------------------------------------------------------------------
// Typing Bubble
// -----------------------------------------------------------------------------

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

  let bubbleClass: string;

  if (s.includes("DRIVER")) {
    bubbleClass = "bg-slate-800 text-white rounded-tr-none";
  } else if (s.includes("RIDER")) {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tl-none";
  } else if (s.includes("PROSECUTOR")) {
    bubbleClass = "bg-[#FFEBCD] text-slate-800 rounded-tl-none";
  } else if (s.includes("POLICY")) {
    bubbleClass = "bg-[#4682B4] text-white rounded-tr-none";
  } else {
    bubbleClass = "bg-gray-100 text-slate-800 rounded-tr-none";
  }

  return (
    <div
      className={`flex flex-col my-3 transition-all duration-300 animate-fadeIn ${
        isRight ? "items-end" : "items-start"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 mb-2 px-1 text-[11px] text-gray-400 ${
          isRight ? "flex-row-reverse" : ""
        }`}
      >
        <span className="font-medium text-slate-600">
          {config.speakerTitle}
        </span>
      </div>

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