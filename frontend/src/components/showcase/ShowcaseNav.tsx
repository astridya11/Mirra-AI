"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/src/context/I18nContext";
import { useTranslation } from "@/src/hooks/useTranslation";

const navRoutes = [
  { path: "/", key: "nav.home" },
  { path: "/team", key: "nav.team" },
  { path: "/how-it-works", key: "nav.howItWorks" },
  { path: "/demo", key: "nav.demo" },
  { path: "/ryde", key: "nav.rydeExperience" },
];

export default function ShowcaseNav() {
  const pathname = usePathname();
  const { locale, toggleLocale } = useI18n();
  const t = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E84360]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white"/>
                <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-[#111827]">
              MIRRA <span className="text-[#E84360]">AI</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navRoutes.map((route) => (
              <Link
                key={route.path}
                href={route.path}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(route.path)
                    ? "text-[#E84360] bg-[#FDF1F3]"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-gray-50"
                }`}
              >
                {t(route.key)}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLocale}
              className="text-sm font-medium text-[#6B7280] hover:text-[#E84360] transition-colors px-2 py-1 rounded-md hover:bg-gray-50"
              aria-label="Toggle language"
            >
              {locale === "en" ? "English | 中文" : "中文 | English"}
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-md text-[#6B7280] hover:text-[#111827] hover:bg-gray-50"
              aria-label="Toggle menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white">
          <div className="space-y-1 px-4 py-3">
            {navRoutes.map((route) => (
              <Link
                key={route.path}
                href={route.path}
                onClick={() => setMobileOpen(false)}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive(route.path)
                    ? "text-[#E84360] bg-[#FDF1F3]"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-gray-50"
                }`}
              >
                {t(route.key)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
