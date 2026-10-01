/**
 * ScrollToLatest — lightweight "jump to latest" button.
 * Appears when the user scrolls up during live streaming.
 */

"use client";

import { memo } from "react";

interface ScrollToLatestProps {
  visible: boolean;
  onClick: () => void;
}

function ScrollToLatestImpl({ visible, onClick }: ScrollToLatestProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      aria-label="Scroll to latest message"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-white shadow-md border border-gray-100 px-3 py-1.5 text-[13px] font-medium text-[#E84360] active:scale-95 transition-transform animate-fade-in"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
      Latest
    </button>
  );
}

export const ScrollToLatest = memo(ScrollToLatestImpl);
