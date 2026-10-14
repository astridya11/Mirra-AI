"use client";

import Link from "next/link";
import { useTranslation } from "@/src/hooks/useTranslation";

export default function HomePage() {
  const t = useTranslation();

  const benefits = [
    { titleKey: "home.benefit1Title", descKey: "home.benefit1Desc" },
    { titleKey: "home.benefit2Title", descKey: "home.benefit2Desc" },
    { titleKey: "home.benefit3Title", descKey: "home.benefit3Desc" },
    { titleKey: "home.benefit4Title", descKey: "home.benefit4Desc" },
  ];

  return (
    <div className="overflow-hidden">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-b from-[#FDF1F3] via-white to-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
            {/* Text */}
            <div className="max-w-xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#E84360] shadow-sm border border-[#FDF1F3]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E84360] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#E84360]" />
                </span>
                MIRRA AI
              </div>
              <h1 className="text-4xl font-extrabold tracking-tight text-[#111827] sm:text-5xl lg:text-6xl leading-tight">
                {t("home.headline")}
              </h1>
              <p className="mt-6 text-lg text-[#6B7280] leading-relaxed">
                {t("home.subheadline")}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/demo"
                  className="inline-flex items-center justify-center rounded-xl bg-[#E84360] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#E84360]/20 hover:bg-[#DE3557] active:scale-95 transition-all"
                >
                  {t("home.ctaPrimary")}
                </Link>
                <Link
                  href="/team"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-[#111827] border border-gray-200 shadow-sm hover:bg-gray-50 active:scale-95 transition-all"
                >
                  {t("home.ctaTeam")}
                </Link>
              </div>
            </div>

            {/* Visual */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="relative w-72 sm:w-80 lg:w-96">
                {/* Phone frame */}
                <div className="relative rounded-[2.5rem] border-[6px] border-[#111827] bg-[#111827] shadow-2xl overflow-hidden">
                  <div className="relative h-[520px] bg-gradient-to-br from-[#E84360]/10 to-[#0D9488]/10">
                    {/* Notch */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#111827] rounded-b-xl z-10" />
                    {/* Screen content */}
                    <div className="pt-10 px-4 pb-4 h-full flex flex-col">
                      <div className="flex-1 flex flex-col items-center justify-center gap-4">
                        <div className="w-full rounded-xl bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-[#E84360]/10 flex items-center justify-center">
                              <svg className="w-5 h-5 text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#111827]">Dispute Resolved</p>
                              <p className="text-xs text-[#6B7280]">S$3.25 refunded</p>
                            </div>
                          </div>
                        </div>
                        <div className="w-full rounded-xl bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-[#0D9488]/10 flex items-center justify-center">
                              <svg className="w-5 h-5 text-[#0D9488]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#111827]">Evidence Verified</p>
                              <p className="text-xs text-[#6B7280]">GPS, EXIF, OCR checked</p>
                            </div>
                          </div>
                        </div>
                        <div className="w-full rounded-xl bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-[#D97706]/10 flex items-center justify-center">
                              <svg className="w-5 h-5 text-[#D97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#111827]">Policy Grounded</p>
                              <p className="text-xs text-[#6B7280]">POL-2 applied</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Map hint */}
                      <div className="mt-auto rounded-xl bg-[#E8F0E3] p-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#0D9488]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                        </svg>
                        <span className="text-xs text-[#6B7280]">Singapore</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Decorative elements */}
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-[#E84360]/10 rounded-full blur-2xl" />
                <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-[#0D9488]/10 rounded-full blur-2xl" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-white py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-[#111827] sm:text-3xl">
              Why MIRRA AI?
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b, i) => (
              <div
                key={i}
                className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md hover:border-[#E84360]/20 transition-all"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#FDF1F3] text-[#E84360] group-hover:bg-[#E84360] group-hover:text-white transition-colors">
                  {i === 0 && (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  )}
                  {i === 1 && (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  )}
                  {i === 2 && (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  )}
                  {i === 3 && (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                  )}
                </div>
                <h3 className="text-base font-semibold text-[#111827]">{t(b.titleKey)}</h3>
                <p className="mt-2 text-sm text-[#6B7280] leading-relaxed">{t(b.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Cards */}
      <section className="bg-[#F9FAFB] py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-3">
            <Link
              href="/team"
              className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md hover:border-[#E84360]/20 transition-all"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#E84360]/5 rounded-bl-full" />
              <h3 className="text-lg font-bold text-[#111827] relative">{t("home.ctaTeam")}</h3>
              <p className="mt-2 text-sm text-[#6B7280] relative">Meet the people building MIRRA AI.</p>
              <div className="mt-4 inline-flex items-center text-sm font-medium text-[#E84360] relative">
                Learn more
                <svg className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </Link>
            <Link
              href="/how-it-works"
              className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md hover:border-[#E84360]/20 transition-all"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#0D9488]/5 rounded-bl-full" />
              <h3 className="text-lg font-bold text-[#111827] relative">{t("home.ctaDiscover")}</h3>
              <p className="mt-2 text-sm text-[#6B7280] relative">Explore the multi-agent pipeline and evidence flow.</p>
              <div className="mt-4 inline-flex items-center text-sm font-medium text-[#0D9488] relative">
                Explore
                <svg className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </Link>
            <Link
              href="/experience"
              className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md hover:border-[#E84360]/20 transition-all"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#D97706]/5 rounded-bl-full" />
              <h3 className="text-lg font-bold text-[#111827] relative">{t("home.ctaRyde")}</h3>
              <p className="mt-2 text-sm text-[#6B7280] relative">Try the Ryde mobile app simulator.</p>
              <div className="mt-4 inline-flex items-center text-sm font-medium text-[#D97706] relative">
                Open app
                <svg className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
