"use client";

import { useTranslation } from "@/src/hooks/useTranslation";

export default function ShowcaseFooter() {
  const t = useTranslation();

  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#E84360]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white"/>
                <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#111827]">
              MIRRA <span className="text-[#E84360]">AI</span>
            </span>
          </div>
          <p className="text-sm text-[#6B7280]">{t("footer.tagline")}</p>
          <p className="text-xs text-[#9CA3AF]">{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
