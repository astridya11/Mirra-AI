"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PriorityBadge from "@/src/components/PriorityBadge";
import SlaBar from "@/src/components/SlaBar";
import { getNextCase, getQueue, resetDemo, type ReviewCase } from "@/src/lib/api";
import { formatMoney, disputeTypeLabel } from "@/src/lib/reviewFormat";
import { useAuth } from "@/src/context/AuthContext";
import { DesignSwitch } from "@/src/components/review/DesignSwitch";
import { reasonLabel } from "@/src/components/review/reviewModel";
import { enumLabel, useI18n } from "@/src/i18n";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";
import { useZhTranslation } from "@/src/i18n/translate";

const POLL_MS = 5000; // scores change as SLA time runs down, so the order refreshes live

export default function ReviewQueuePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [support, setSupport] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  // Redirect non-support users away before any review data is fetched.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.party !== "SUPPORT") {
      router.replace("/help");
    }
  }, [user, authLoading, router]);

  const refresh = useCallback(async () => {
    try {
      const data = await getQueue();
      setCases(data.cases);
      setSupport(data.support.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the queue");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Only fetch review data once the user is confirmed as SUPPORT.
  const authed = !authLoading && user?.party === "SUPPORT";

  useEffect(() => {
    if (!authed) return;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, authed]);

  // While auth is loading, render nothing to avoid a flash of content.
  if (authLoading || !authed) return null;

  const open = cases.filter((c) => c.status === "OPEN");
  const fastTrack = open.filter((c) => c.priority_level === "URGENT");
  const rest = open.filter((c) => c.priority_level !== "URGENT");
  const resolved = cases.filter((c) => c.status === "RESOLVED");
  const pastSla = open.filter((c) => c.sla_status === "BREACHED").length;

  const startNext = async () => {
    const { case_id } = await getNextCase();
    if (case_id) router.push(`/review/${case_id}`);
  };

  const nothingOpen = open.length === 0 && fastTrack.length === 0;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#1F2937] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/help"
                aria-label={t("tq.backHelp")}
                className="text-slate-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E84360]/40 inline-flex items-center justify-center w-8 h-8 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-semibold text-[#1F2937]">{t("tq.title")}</h1>
            </div>
            <p className="text-sm text-[#6B7280] mt-0.5">
              {support ? t("review.reviewingAs", { name: support }) : t("review.loading")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitch compact />
            <button
              onClick={async () => {
                await resetDemo();
                refresh();
              }}
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#6B7280] hover:bg-gray-100"
            >
              {t("review.resetDemo")}
            </button>
            <button
              onClick={startNext}
              disabled={open.length === 0}
              className="rounded-lg bg-[#E84360] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {t("review.startNext")}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {t("tq.backendDown")}
          </div>
        )}

        {/* Stat strip */}
        {!error && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-0">
            <StatPair value={open.length} label={t("tq.open")} />
            <StatPair value={fastTrack.length} label={t("tq.fastTrack")} />
            <StatPair
              value={pastSla}
              label={t("tq.pastSla")}
              tone={pastSla > 0 ? "red" : undefined}
            />
            <StatPair value={resolved.length} label={t("tq.reviewed")} />
          </div>
        )}

        {/* Help line */}
        {!error && (
          <p className="text-xs text-[#9CA3AF]">
            {t("tq.rankHint")}
          </p>
        )}

        {/* Content */}
        {error ? null : isLoading ? (
          <p className="text-sm text-[#9CA3AF]">{t("review.loadingCases")}</p>
        ) : nothingOpen ? (
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
            <p className="text-sm text-[#6B7280]">
              {t("tq.none")}
            </p>
          </div>
        ) : (
          <>
            <Section
              title={t("tq.fastTrack")}
              hint={t("tq.fastHint")}
              cases={fastTrack}
              startRank={1}
              empty={t("tq.noUrgent")}
              accent
            />
            <Section
              title={t("tq.queue")}
              cases={rest}
              startRank={fastTrack.length + 1}
            />
            {resolved.length > 0 && (
              <ReviewedSection cases={resolved} />
            )}
          </>
        )}
      </main>
      <DesignSwitch to="team" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

function StatPair({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "red";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`text-lg font-semibold tabular-nums ${
          tone === "red" ? "text-red-600" : "text-[#1F2937]"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-[#6B7280]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Section({
  title,
  hint,
  cases,
  startRank,
  empty,
  accent,
}: {
  title: string;
  hint?: string;
  cases: ReviewCase[];
  startRank?: number;
  empty?: string;
  accent?: boolean;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-[#1F2937]">
          {title} <span className="text-[#9CA3AF] font-normal">({cases.length})</span>
        </h2>
        {hint && <p className="text-xs text-[#6B7280] mt-0.5">{hint}</p>}
      </div>
      {cases.length === 0 ? (
        empty ? (
          <p className="text-sm text-[#9CA3AF]">{empty}</p>
        ) : null
      ) : (
        <div
          className={`rounded-xl border bg-white overflow-hidden ${
            accent ? "border-l-[3px] border-l-[#E84360] border-t-[#E5E7EB] border-r-[#E5E7EB] border-b-[#E5E7EB]" : "border-[#E5E7EB]"
          }`}
        >
          <ColumnHeader />
          <div className="divide-y divide-[#F3F4F6]">
            {cases.map((c, i) => (
              <CaseRow
                key={c.case_id}
                c={c}
                rank={startRank ? startRank + i : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewedSection({ cases }: { cases: ReviewCase[] }) {
  const { t } = useI18n();
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-[#6B7280] hover:text-[#1F2937] select-none">
        {t("tq.reviewed")} <span className="text-[#9CA3AF]">({cases.length})</span>
      </summary>
      <div className="mt-2 rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <ColumnHeader />
        <div className="divide-y divide-[#F3F4F6]">
          {cases.map((c, i) => (
            <CaseRow
              key={c.case_id}
              c={c}
              rank={i + 1}
              muted
            />
          ))}
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Column header
// ---------------------------------------------------------------------------

function ColumnHeader() {
  const { t } = useI18n();
  return (
    <div className="hidden md:grid grid-cols-[2.5rem_1fr_1.5fr_8rem_7rem_11rem] gap-3 px-4 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB]">
      <span className="text-xs text-[#6B7280] font-medium">{t("tq.col.rank")}</span>
      <span className="text-xs text-[#6B7280] font-medium">{t("tq.col.case")}</span>
      <span className="text-xs text-[#6B7280] font-medium">{t("tq.col.why")}</span>
      <span className="text-xs text-[#6B7280] font-medium text-right">{t("tq.col.amount")}</span>
      <span className="text-xs text-[#6B7280] font-medium">{t("tq.col.priority")}</span>
      <span className="text-xs text-[#6B7280] font-medium">{t("tq.col.sla")}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case row
// ---------------------------------------------------------------------------

function CaseRow({
  c,
  rank,
  muted,
}: {
  c: ReviewCase;
  rank?: number;
  muted?: boolean;
}) {
  const resolved = c.status === "RESOLVED";
  const { t, locale } = useI18n();
  const rawReason = c.escalation_reasons?.[0];
  const reason = rawReason ? reasonLabel(rawReason, t) : t("review.escalatedDefault");
  const translated = useZhTranslation(reason, locale !== "en" && !!rawReason && reason === rawReason);
  const shownReason = translated ?? reason;
  const dispute = locale === "en" ? disputeTypeLabel(c.dispute_type) : enumLabel(t, c.dispute_type);

  return (
    <Link
      href={`/review/${c.case_id}`}
      className={`group relative block px-4 py-3 hover:bg-[#F9FAFB] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E84360]/40 ${
        muted ? "opacity-60" : ""
      }`}
    >
      {/* Desktop grid layout */}
      <div className="hidden md:grid grid-cols-[2.5rem_1fr_1.5fr_8rem_7rem_11rem] gap-3 items-center">
        {rank !== undefined ? (
          <span className="text-sm text-[#9CA3AF] tabular-nums">#{rank}</span>
        ) : (
          <span />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#1F2937] truncate">{c.case_id}</p>
          <p className="text-xs text-[#6B7280] truncate">{dispute}</p>
        </div>
        <p
          className="text-xs text-[#6B7280] truncate"
          title={rawReason ?? reason}
        >
          {shownReason}
        </p>
        <span className="text-sm text-[#1F2937] text-right tabular-nums">
          {c.value_source === "mock" ? (
            <span title={t("rail.amountNotRecorded")}>&mdash;</span>
          ) : (
            formatMoney(c.dispute_value)
          )}
        </span>
        <div className="justify-self-start">
          <PriorityBadge tier={c.priority_level} />
        </div>
        {resolved ? (
          <span className="text-xs text-[#6B7280] truncate">
            {c.resolved_by ? t("review.reviewedBy", { name: c.resolved_by }) : t("tq.reviewed")}
          </span>
        ) : (
          <SlaBar
            deadline={c.sla_deadline}
            totalSeconds={c.sla_total_seconds}
            resolved={resolved}
          />
        )}
      </div>

      {/* Mobile stacked layout */}
      <div className="md:hidden space-y-2">
        {/* Line 1: case + priority */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {rank !== undefined && (
              <span className="text-sm text-[#9CA3AF] tabular-nums shrink-0">#{rank}</span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#1F2937] truncate">{c.case_id}</p>
              <p className="text-xs text-[#6B7280] truncate">{dispute}</p>
            </div>
          </div>
          <PriorityBadge tier={c.priority_level} />
        </div>
        {/* Line 2: reason + amount + SLA */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#6B7280] truncate flex-1" title={rawReason ?? reason}>
            {shownReason}
          </p>
          <span className="text-sm text-[#1F2937] tabular-nums shrink-0">
            {c.value_source === "mock" ? (
              <span title={t("rail.amountNotRecorded")}>&mdash;</span>
            ) : (
              formatMoney(c.dispute_value)
            )}
          </span>
        </div>
        {/* SLA bar */}
        <div>
          {resolved ? (
            <span className="text-xs text-[#6B7280]">
              {c.resolved_by ? t("review.reviewedBy", { name: c.resolved_by }) : t("tq.reviewed")}
            </span>
          ) : (
            <SlaBar
              deadline={c.sla_deadline}
              totalSeconds={c.sla_total_seconds}
              resolved={resolved}
            />
          )}
        </div>
      </div>
    </Link>
  );
}
