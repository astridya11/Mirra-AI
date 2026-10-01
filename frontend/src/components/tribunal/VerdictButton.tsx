/**
 * VerdictButton — fixed bottom CTA shown after the pipeline completes.
 * Navigates to /help/chat with caseId context.
 *
 * Handles safe-area-inset-bottom and slide-up fade-in.
 */

"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";

interface VerdictButtonProps {
  caseId: string;
}

function VerdictButtonImpl({ caseId }: VerdictButtonProps) {
  const router = useRouter();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 bg-white/90 backdrop-blur-lg border-t border-gray-100 animate-slide-up"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-[560px] mx-auto px-4 py-3">
        <button
          onClick={() => {
            router.push(`/help/chat?caseId=${caseId}&from=process`);
          }}
          className="w-full h-12 rounded-2xl bg-[#E84360] text-white font-semibold text-[16px] active:scale-[0.98] transition-transform shadow-md flex items-center justify-center gap-2"
        >
          <span>View verdict</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const VerdictButton = memo(VerdictButtonImpl);
