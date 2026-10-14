"use client";

import { useRouter } from "next/navigation";

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export default function MobileLayout({
  children,
  title,
  showBack = false,
  onBack,
  rightAction,
}: MobileLayoutProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center items-start py-0 md:py-8">
      {/* Phone frame (desktop only) */}
      <div className="w-full max-w-md md:min-h-[800px] md:rounded-[2.5rem] md:border-[8px] md:border-[#1f2937] md:bg-[#1f2937] md:shadow-2xl overflow-hidden relative">
        {/* Notch (desktop only) */}
        <div className="hidden md:block absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-[#1f2937] rounded-b-2xl z-30" />

        {/* Content area */}
        <div className="h-screen md:h-[calc(800px-16px)] bg-white overflow-hidden flex flex-col relative md:rounded-[2rem]">
          {/* Header */}
          <header className="shrink-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 z-20">
            {showBack && (
              <button
                onClick={handleBack}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-50 active:scale-95 transition-all"
              >
                <svg className="h-5 w-5 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            <div className="flex-1 min-w-0">
              {title && (
                <h1 className="text-base font-bold text-[#111827] truncate text-center pr-8">
                  {title}
                </h1>
              )}
            </div>
            {rightAction && <div className="shrink-0">{rightAction}</div>}
          </header>

          {/* Main content */}
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  );
}
