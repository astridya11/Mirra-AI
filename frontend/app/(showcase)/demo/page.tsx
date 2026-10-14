"use client";

import Link from "next/link";
import { useTranslation } from "@/src/hooks/useTranslation";

export default function DemoPage() {
  const t = useTranslation();

  const demos = [
    {
      num: 1,
      titleKey: "demo.demo1Title",
      themeKey: "demo.demo1Theme",
      descKey: "demo.demo1Desc",
      capsKey: "demo.demo1Capabilities",
      ctaKey: "demo.demo1Cta",
      color: "bg-[#E84360]",
      light: "bg-[#FDF1F3]",
      border: "border-[#E84360]/20",
    },
    {
      num: 2,
      titleKey: "demo.demo2Title",
      themeKey: "demo.demo2Theme",
      descKey: "demo.demo2Desc",
      capsKey: "demo.demo2Capabilities",
      ctaKey: "demo.demo2Cta",
      color: "bg-[#0D9488]",
      light: "bg-[#ECFDF5]",
      border: "border-[#0D9488]/20",
    },
    {
      num: 3,
      titleKey: "demo.demo3Title",
      themeKey: "demo.demo3Theme",
      descKey: "demo.demo3Desc",
      capsKey: "demo.demo3Capabilities",
      ctaKey: "demo.demo3Cta",
      color: "bg-[#D97706]",
      light: "bg-[#FFFBEB]",
      border: "border-[#D97706]/20",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      {/* Header */}
      <div className="text-center mb-16">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#111827] sm:text-4xl">
          {t("demo.title")}
        </h1>
        <p className="mt-4 text-lg text-[#6B7280] max-w-2xl mx-auto">
          {t("demo.subtitle")}
        </p>
      </div>

      {/* Demo Cards */}
      <div className="grid gap-8 lg:grid-cols-3">
        {demos.map((demo) => (
          <div
            key={demo.num}
            className={`group relative flex flex-col rounded-2xl border ${demo.border} bg-white shadow-sm hover:shadow-lg transition-all overflow-hidden`}
          >
            {/* Theme badge */}
            <div className={`${demo.light} px-6 py-3 border-b ${demo.border}`}>
              <span className={`inline-block rounded-md ${demo.color} px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase`}>
                {t(demo.themeKey)}
              </span>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 flex flex-col">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50 group-hover:bg-white transition-colors">
                <span className={`text-xl font-extrabold ${demo.color.replace("bg-", "text-")}`}>
                  {demo.num}
                </span>
              </div>
              <h3 className="text-lg font-bold text-[#111827]">{t(demo.titleKey)}</h3>
              <p className="mt-3 text-sm text-[#6B7280] leading-relaxed flex-1">
                {t(demo.descKey)}
              </p>
              <div className="mt-4">
                <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
                  Capabilities
                </p>
                <p className="text-xs text-[#6B7280] leading-relaxed">
                  {t(demo.capsKey)}
                </p>
              </div>
            </div>

            {/* CTA */}
            <div className="px-6 pb-6">
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  alert(`Demo ${demo.num} will be available in a future milestone.`);
                }}
                className={`flex w-full items-center justify-center rounded-xl ${demo.color} px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all`}
              >
                {t(demo.ctaKey)}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
