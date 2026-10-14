"use client";

import { useTranslation } from "@/src/hooks/useTranslation";

export default function TeamPage() {
  const t = useTranslation();

  const members = [
    {
      nameKey: "team.p1Name",
      roleKey: "team.p1Role",
      descKey: "team.p1Desc",
      color: "bg-[#E84360]",
      light: "bg-[#FDF1F3]",
    },
    {
      nameKey: "team.p2Name",
      roleKey: "team.p2Role",
      descKey: "team.p2Desc",
      color: "bg-[#0D9488]",
      light: "bg-[#ECFDF5]",
    },
    {
      nameKey: "team.p3Name",
      roleKey: "team.p3Role",
      descKey: "team.p3Desc",
      color: "bg-[#D97706]",
      light: "bg-[#FFFBEB]",
    },
  ];

  const values = [
    { titleKey: "team.value1Title", descKey: "team.value1Desc" },
    { titleKey: "team.value2Title", descKey: "team.value2Desc" },
    { titleKey: "team.value3Title", descKey: "team.value3Desc" },
    { titleKey: "team.value4Title", descKey: "team.value4Desc" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      {/* Header */}
      <div className="text-center mb-16">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#111827] sm:text-4xl">
          {t("team.title")}
        </h1>
        <p className="mt-4 text-lg text-[#6B7280] max-w-2xl mx-auto">
          {t("team.subtitle")}
        </p>
      </div>

      {/* Team Members */}
      <div className="grid gap-8 sm:grid-cols-3 mb-20">
        {members.map((m, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-8 shadow-sm hover:shadow-md transition-all text-center"
          >
            <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${m.light}`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${m.color} text-white text-lg font-bold`}>
                {t(m.nameKey)}
              </div>
            </div>
            <h3 className="text-lg font-bold text-[#111827]">{t(m.roleKey)}</h3>
            <p className="mt-1 text-sm text-[#6B7280]">{t(m.descKey)}</p>
          </div>
        ))}
      </div>

      {/* Vision */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#111827] to-[#1E293B] px-8 py-12 sm:px-12 sm:py-16 mb-20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#E84360]/10 rounded-full blur-3xl" />
        <div className="relative max-w-3xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{t("team.visionTitle")}</h2>
          <p className="mt-4 text-lg text-gray-300 leading-relaxed">{t("team.visionText")}</p>
        </div>
      </div>

      {/* Values */}
      <div>
        <h2 className="text-2xl font-bold text-[#111827] text-center mb-10">
          Core Values
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all"
            >
              <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-[#FDF1F3] text-[#E84360]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[#111827]">{t(v.titleKey)}</h3>
              <p className="mt-2 text-sm text-[#6B7280] leading-relaxed">{t(v.descKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
