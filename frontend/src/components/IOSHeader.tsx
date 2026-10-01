/**
 * IOSHeader — standard iOS navigation bar with back button + centered title.
 */

import type { ReactNode } from "react";

interface IOSHeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: ReactNode;
  subtitle?: string;
}

export function IOSHeader({ title, onBack, rightAction, subtitle }: IOSHeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg border-b border-gray-100">
      <div className="relative flex items-center justify-center px-4 h-[44px]">
        {onBack && (
          <button
            onClick={onBack}
            className="absolute left-3 flex items-center text-[17px] text-[#E84360] active:opacity-60 transition-opacity"
          >
            <svg className="w-6 h-6 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-[17px]">Back</span>
          </button>
        )}
        <div className="text-center">
          <h1 className="text-[17px] font-semibold text-[#111827] truncate max-w-[200px]">{title}</h1>
          {subtitle && (
            <p className="text-[11px] text-[#6B7280] -mt-0.5 truncate max-w-[200px]">{subtitle}</p>
          )}
        </div>
        {rightAction && (
          <div className="absolute right-3">{rightAction}</div>
        )}
      </div>
    </header>
  );
}
