"use client";

import { useTranslation } from "@/src/hooks/useTranslation";

export default function HowItWorksPage() {
  const t = useTranslation();

  const steps = [
    { num: 1, key: "step1", descKey: "step1Desc", color: "bg-[#E84360]" },
    { num: 2, key: "step2", descKey: "step2Desc", color: "bg-[#0D9488]" },
    { num: 3, key: "step3", descKey: "step3Desc", color: "bg-[#D97706]" },
    { num: 4, key: "step4", descKey: "step4Desc", color: "bg-[#7C3AED]" },
    { num: 5, key: "step5", descKey: "step5Desc", color: "bg-[#D97706]" },
    { num: 6, key: "step6", descKey: "step6Desc", color: "bg-[#0D9488]" },
    { num: 7, key: "step7", descKey: "step7Desc", color: "bg-[#111827]" },
    { num: 8, key: "step8", descKey: "step8Desc", color: "bg-[#E84360]" },
  ];

  const capabilities = [
    "cap1", "cap2", "cap3", "cap4", "cap5",
    "cap6", "cap7", "cap8", "cap9", "cap10",
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      {/* Header */}
      <div className="text-center mb-16">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#111827] sm:text-4xl">
          {t("howItWorks.title")}
        </h1>
        <p className="mt-4 text-lg text-[#6B7280] max-w-3xl mx-auto">
          {t("howItWorks.subtitle")}
        </p>
      </div>

      {/* Pipeline */}
      <div className="mb-20">
        <div className="relative">
          {/* Vertical line (desktop) */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-gray-200 -translate-x-1/2" />

          <div className="space-y-8 lg:space-y-12">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`relative flex flex-col lg:flex-row items-center gap-6 lg:gap-12 ${
                  i % 2 === 1 ? "lg:flex-row-reverse" : ""
                }`}
              >
                {/* Content card */}
                <div className="flex-1 w-full">
                  <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${step.color} text-white text-sm font-bold`}>
                        {step.num}
                      </div>
                      <h3 className="text-base font-bold text-[#111827]">
                        {t(`howItWorks.${step.key}`)}
                      </h3>
                    </div>
                    <p className="text-sm text-[#6B7280] leading-relaxed">
                      {t(`howItWorks.${step.descKey}`)}
                    </p>
                  </div>
                </div>

                {/* Center dot */}
                <div className="hidden lg:flex shrink-0 h-10 w-10 items-center justify-center rounded-full bg-white border-2 border-gray-200 z-10">
                  <div className={`h-3 w-3 rounded-full ${step.color}`} />
                </div>

                {/* Spacer for alternating layout */}
                <div className="hidden lg:block flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="rounded-2xl bg-[#F9FAFB] p-8 sm:p-12">
        <h2 className="text-xl font-bold text-[#111827] text-center mb-10">
          {t("howItWorks.capabilitiesTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((cap, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm border border-gray-100"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#FDF1F3] text-[#E84360]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <span className="text-sm font-medium text-[#111827]">
                {t(`howItWorks.${cap}`)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
