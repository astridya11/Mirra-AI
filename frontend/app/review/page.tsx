"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PriorityBadge from "@/src/components/PriorityBadge";
import SlaBadge from "@/src/components/SlaBadge";
import {
  confidenceLabel,
  decisionLabel,
  finalAction,
  judgeConfidence,
  money,
  moneyFlow,
  reasonLabel,
  recommendationLabel,
  typeLabel,
} from "@/src/components/review/reviewModel";
import { getCompletedResult, getNextCase, getQueue, resetDemo, type ReviewCase } from "@/src/lib/api";
import type { CaseResult } from "@/src/types";
import { enumLabel, useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";
import { RawText } from "@/src/i18n/RawText";

const POLL_MS = 5000; // scores change as SLA time runs down, so the order refreshes live
const FILTERS = ["All", "Open", "High priority", "Resolved"] as const;
const FILTER_KEY: Record<(typeof FILTERS)[number], MessageKey> = {
  All: "review.filter.all",
  Open: "review.filter.open",
  "High priority": "review.filter.high",
  Resolved: "review.filter.resolved",
};
type Filter = (typeof FILTERS)[number];

export default function ReviewQueuePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [support, setSupport] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  // Completed pipeline results, for AI recommendation / confidence / final outcome on each card.
  // ponytail: one GET /result per case (cached); a batch endpoint would replace this for large queues.
  const [results, setResults] = useState<Record<string, CaseResult | null>>({});

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + polling of external queue
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Fetch each case's result once; refetch a resolved case whose cached result predates the review.
  useEffect(() => {
    cases.forEach((c) => {
      const cached = results[c.case_id];
      const stale = c.status === "RESOLVED" && cached && !cached.judge_verdict?.execution_payload?.human_confirmation_details;
      if (cached !== undefined && !stale) return;
      getCompletedResult(c.case_id)
        .catch(() => null)
        .then((r) => setResults((m) => ({ ...m, [c.case_id]: r })));
    });
  }, [cases, results]);

  const q = search.trim().toLowerCase();
  const matches = (c: ReviewCase) => !q || c.case_id.toLowerCase().includes(q) || c.dispute_type.toLowerCase().includes(q);
  const open = cases.filter((c) => c.status === "OPEN");
  const resolved = cases.filter((c) => c.status === "RESOLVED");
  const highPriority = open.filter((c) => c.priority_level !== "STANDARD");
  const atRisk = open.filter((c) => c.sla_status === "AT_RISK" || c.sla_status === "BREACHED").length;

  const shownOpen = (filter === "High priority" ? highPriority : filter === "Resolved" ? [] : open).filter(matches);
  const fastTrack = shownOpen.filter((c) => c.priority_level === "URGENT");
  const rest = shownOpen.filter((c) => c.priority_level !== "URGENT");
  const shownHistory = filter === "All" || filter === "Resolved" ? resolved.filter(matches) : [];

  const startNext = async () => {
    const { case_id } = await getNextCase();
    if (case_id) router.push(`/review/${case_id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="w-2 h-6 bg-[#E84360] rounded-sm inline-block"></span>
              MIRRA AI <span className="text-gray-400 font-normal">|</span> {t("review.title")}
            </h1>
            <p className="text-sm text-gray-500 mt-1 ml-4">{support ? t("review.reviewingAs", { name: support }) : t("review.loading")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitch compact />
            <button
              onClick={async () => {
                await resetDemo();
                setResults({});
                refresh();
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
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

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("review.backendError", { error })}</p>}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label={t("review.summary")}>
          <Tile label={t("review.tile.open")} value={open.length} />
          <Tile label={t("review.tile.high")} value={highPriority.length} tone="amber" />
          <Tile label={t("review.tile.sla")} value={atRisk} tone="red" />
          <Tile label={t("review.tile.reviewed")} value={resolved.length} tone="green" />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label={t("review.filterCases")}>
            {FILTERS.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f ? "bg-[#E84360] text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                {t(FILTER_KEY[f])}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("review.search")}
            aria-label={t("review.searchAria")}
            className="flex-1 min-w-[200px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-[#E84360] focus:outline-none"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400">{t("review.loadingCases")}</p>
        ) : (
          <>
            {filter !== "Resolved" && (
              <>
                <Section title={t("review.fastTrack")} hint={t("review.fastTrackHint")} count={fastTrack.length} empty={t("review.noUrgent")} accent>
                  {fastTrack.map((c, i) => (
                    <OpenCard key={c.case_id} c={c} r={results[c.case_id]} rank={i + 1} />
                  ))}
                </Section>
                <Section title={t("review.tile.open")} hint={t("review.openHint")} count={rest.length} empty={t("review.noOpen")}>
                  {rest.map((c, i) => (
                    <OpenCard key={c.case_id} c={c} r={results[c.case_id]} rank={fastTrack.length + i + 1} />
                  ))}
                </Section>
              </>
            )}
            {(filter === "All" || filter === "Resolved") && (
              <Section title={t("review.history")} hint={t("review.historyHint")} count={shownHistory.length} empty={t("review.noHistory")}>
                {shownHistory.map((c) => (
                  <HistoryCard key={c.case_id} c={c} r={results[c.case_id]} />
                ))}
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" | "green" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : "text-gray-900";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, count, empty, accent, children }: { title: string; hint?: string; count: number; empty: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-lg font-bold text-gray-900">
          {title} <span className="text-gray-400 font-normal">({count})</span>
        </h2>
        {hint && <p className="text-sm text-gray-500">{hint}</p>}
      </div>
      {count === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className={`divide-y divide-gray-100 rounded-2xl border bg-white overflow-hidden ${accent ? "border-[#E84360]/40" : "border-gray-200"}`}>{children}</ul>
      )}
    </section>
  );
}

function OpenCard({ c, r, rank }: { c: ReviewCase; r: CaseResult | null | undefined; rank: number }) {
  // Prefer the completed verdict; the queue's raw 0.00 from a failed Judge run is never shown as a score.
  const conf = r ? judgeConfidence(r.judge_verdict) : c.confidence_score > 0 ? c.confidence_score : null;
  const { t } = useI18n();
  const reason = c.escalation_reasons?.[0];
  return (
    <li>
      <Link href={`/review/${c.case_id}`} className="grid gap-3 px-5 py-4 hover:bg-gray-50 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <span className="text-sm font-medium text-gray-400 tabular-nums">#{rank}</span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-gray-900">
            {c.case_id} <span className="text-sm font-normal text-gray-500">{typeLabel(c.dispute_type, t)}</span>
            <span className="ml-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">{t("review.pendingDecision")}</span>
          </p>
          <div className="text-sm text-gray-600 min-w-0">
            <span>{t("review.reason")} </span>
            {reason ? (
              <RawText as="span" text={reasonLabel(reason, t)} raw={reasonLabel(reason, t) === reason} className="truncate" />
            ) : (
              t("review.escalatedDefault")
            )}
          </div>
          <p className="text-xs text-gray-500">
            {t("review.claimValue", { amount: money(c.dispute_value) })}
            {c.value_source === "mock" ? ` ${t("review.est")}` : ""} · {t("review.aiRecommendation")} {r === undefined ? t("review.loadingShort") : recommendationLabel(r, t)} ·{" "}
            {t("review.judgeConfidence")} {confidenceLabel(conf, t)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge tier={c.priority_level} />
          <SlaBadge deadline={c.sla_deadline} totalSeconds={c.sla_total_seconds} resolved={false} />
          <span className="text-sm font-semibold text-[#E84360]">{t("review.reviewCase")}</span>
        </div>
      </Link>
    </li>
  );
}

function HistoryCard({ c, r }: { c: ReviewCase; r: CaseResult | null | undefined }) {
  const d = r?.judge_verdict?.execution_payload?.human_confirmation_details;
  const action = finalAction(r);
  const f = moneyFlow(action);
  const cleaning = c.dispute_type === "CLEANING_FEE";
  const { t } = useI18n();
  const financial = !d
    ? "—"
    : cleaning && f.cleaning > 0
      ? t("review.feeMoved", { amount: money(f.cleaning) })
      : f.refund > 0
        ? t("review.refundMoved", { amount: money(f.refund) })
        : t("review.noMoney");
  return (
    <li>
      <Link href={`/review/${c.case_id}`} className="grid gap-2 px-5 py-4 hover:bg-gray-50 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-gray-900">
            {c.case_id} <span className="text-sm font-normal text-gray-500">{typeLabel(c.dispute_type, t)}</span>
          </p>
          <p className="text-sm text-gray-700">
            {d ? decisionLabel(d.approval_decision, action, cleaning, t) : t("review.reviewed")} · {financial}
          </p>
          <p className="text-xs text-gray-500">
            {t("review.reviewedBy", { name: c.resolved_by ?? d?.reviewer_id ?? "support" })} · {c.resolved_at ? new Date(c.resolved_at).toLocaleString() : "—"} ·{" "}
            {t("review.status")} {enumLabel(t, r?.judge_verdict?.execution_payload?.execution_status ?? "RESOLVED")}
          </p>
        </div>
        <span className="text-sm font-semibold text-[#E84360]">{t("review.viewDetails")}</span>
      </Link>
    </li>
  );
}
