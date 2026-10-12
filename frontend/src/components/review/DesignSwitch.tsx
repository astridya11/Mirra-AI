"use client";

import Link from "next/link";

/**
 * Floating switch between the merged Human Support pages (/review, bilingual) and the
 * teammate's original design, kept unchanged at /team-review for comparison.
 */
export function DesignSwitch({ to, caseId }: { to: "team" | "merged"; caseId?: string }) {
  const base = to === "team" ? "/team-review" : "/review";
  return (
    <Link
      href={caseId ? `${base}/${caseId}` : base}
      className="fixed bottom-5 right-5 z-[60] inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white/95 px-4 py-2 text-[13px] font-medium text-[#1F2937] shadow-lg backdrop-blur hover:border-[#E84360] hover:text-[#E84360]"
    >
      <span className="h-2 w-2 rounded-full bg-[#E84360]" aria-hidden />
      {to === "team" ? "View teammate design" : "Back to MIRRA version (EN / 中文)"}
    </Link>
  );
}
