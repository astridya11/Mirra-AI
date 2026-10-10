"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PriorityBadge from "@/src/components/PriorityBadge";
import SlaBadge from "@/src/components/SlaBadge";
import { getNextCase, getQueue, resetDemo, type ReviewCase } from "@/src/lib/api";

const POLL_MS = 5000; // scores change as SLA time runs down, so the order refreshes live
const CURRENCY = "RM";

export default function ReviewQueuePage() {
  const router = useRouter();
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [support, setSupport] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const open = cases.filter((c) => c.status === "OPEN");
  const fastTrack = open.filter((c) => c.priority_level === "URGENT");
  const rest = open.filter((c) => c.priority_level !== "URGENT");
  const resolved = cases.filter((c) => c.status === "RESOLVED");
  const pastSla = open.filter((c) => c.sla_status === "BREACHED").length;

  const startNext = async () => {
    const { case_id } = await getNextCase();
    if (case_id) router.push(`/review/${case_id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="w-2 h-6 bg-[#E84360] rounded-sm inline-block"></span>
              Mirra AI Tribunal <span className="text-gray-400 font-normal">|</span> Review Queue
            </h1>
            <p className="text-sm text-gray-500 mt-1 ml-4">
              {support ? `Reviewing as ${support}` : "Loading..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await resetDemo();
                refresh();
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              Reset demo
            </button>
            <button
              onClick={startNext}
              disabled={open.length === 0}
              className="rounded-lg bg-[#E84360] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Start next case
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Could not reach the backend: {error}
          </p>
        )}

        <p className="text-sm text-gray-600">
          {open.length} open, {fastTrack.length} fast-tracked, {pastSla} past SLA, {resolved.length} reviewed.
          Cases are ranked by priority level first, then SLA pressure and dispute value.
        </p>

        {isLoading ? (
          <p className="text-sm text-gray-400">Loading cases...</p>
        ) : (
          <>
            <Section
              title="Fast-track"
              hint="Safety threats and high fraud risk. Always reviewed before anything else."
              cases={fastTrack}
              startRank={1}
              empty="No urgent cases right now."
              accent
            />
            <Section
              title="Queue"
              hint="Ranked by SLA pressure and dispute value within each priority level."
              cases={rest}
              startRank={fastTrack.length + 1}
              empty="No other open cases."
            />
            {resolved.length > 0 && (
              <Section title="Reviewed" cases={resolved} empty="" muted />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  hint,
  cases,
  startRank,
  empty,
  accent,
  muted,
}: {
  title: string;
  hint?: string;
  cases: ReviewCase[];
  startRank?: number;
  empty: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-lg font-bold text-gray-900">
          {title} <span className="text-gray-400 font-normal">({cases.length})</span>
        </h2>
        {hint && <p className="text-sm text-gray-500">{hint}</p>}
      </div>
      {cases.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ul
          className={`divide-y divide-gray-100 rounded-2xl border bg-white overflow-hidden ${
            accent ? "border-[#E84360]/40" : "border-gray-200"
          } ${muted ? "opacity-70" : ""}`}
        >
          {cases.map((c, i) => (
            <li key={c.case_id}>
              <CaseRow c={c} rank={startRank ? startRank + i : undefined} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseRow({ c, rank }: { c: ReviewCase; rank?: number }) {
  const resolved = c.status === "RESOLVED";
  return (
    <Link
      href={`/review/${c.case_id}`}
      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50"
    >
      <div className="flex items-start gap-4 min-w-0">
        {rank !== undefined && (
          <span className="w-8 pt-0.5 text-sm font-medium text-gray-400 tabular-nums">#{rank}</span>
        )}
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {c.case_id}{" "}
            <span className="text-sm font-normal text-gray-500">{c.dispute_type}</span>
          </p>
          <p className="text-sm text-gray-500 truncate max-w-xl">
            {c.escalation_reasons?.[0] ?? "Escalated for human review"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Value {CURRENCY} {c.dispute_value.toFixed(0)}
            {c.value_source === "mock" ? " (estimated)" : ""}
            {resolved && c.resolved_by ? `, reviewed by ${c.resolved_by}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <PriorityBadge tier={c.priority_level} />
        <SlaBadge
          deadline={c.sla_deadline}
          totalSeconds={c.sla_total_seconds}
          resolved={resolved}
        />
      </div>
    </Link>
  );
}