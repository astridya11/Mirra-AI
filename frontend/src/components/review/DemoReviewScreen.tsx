"use client";

import Link from "next/link";
import { useI18n } from "@/src/context/I18nContext";
import { getFixtureByDemoId } from "@/src/lib/tribunalFixtures";
import { getScenario } from "@/src/lib/demoScenarios";
import LanguageToggle from "@/src/components/LanguageToggle";
import HumanReviewDecision from "./HumanReviewDecision";
import { useHydrated } from "@/src/hooks/useStoredValue";

/**
 * Offline Human Review for Demo 3 in DEMO MODE (backend unavailable).
 * Uses the deterministic fixture, is clearly labelled as a demo reference,
 * never calls the backend and never pretends to be a LIVE case.
 */
export default function DemoReviewScreen(props: { caseRef: string; sessionId: string }) {
  // The outcome ledger lives in localStorage: render after hydration (no mismatch).
  return useHydrated() ? <DemoReviewContent {...props} /> : <div className="min-h-screen bg-[#F6F7F9]" />;
}

function DemoReviewContent({ caseRef, sessionId }: { caseRef: string; sessionId: string }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const fixture = getFixtureByDemoId("3");
  const scenario = getScenario("3");
  const backHref = `/demo/3/guided?session=${encodeURIComponent(sessionId)}`;
  const judge = fixture?.events.find((e) => e.role === "ai_judge");

  const tone = {
    verified: "bg-[#F0FDFA] text-[#0D9488] border-[#0D9488]/20",
    disputed: "bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30",
    missing: "bg-gray-50 text-[#6B7280] border-gray-200",
  } as const;
  const catLabel = {
    verified: zh ? "已核实" : "Verified",
    disputed: zh ? "有争议" : "Disputed",
    missing: zh ? "缺失" : "Missing",
  } as const;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#1F2937]">
      <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={backHref}
              aria-label={zh ? "返回引导演示" : "Back to Guided Demo"}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6B7280] hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold">{zh ? "人工审核 · 清洁费" : "Human Review · Cleaning Fee"}</h1>
              <p className="truncate text-[12px] text-[#6B7280]">
                {zh ? "演示审核参考" : "Demo review reference"}: <span className="font-mono">{caseRef}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
              DEMO MODE
            </span>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="mb-4 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-[13px] text-[#6B7280]">
          {zh
            ? "后端不可用时的离线演示：使用确定性示例数据，不会创建或修改任何真实案件，交易 ID 为本地演示 ID。"
            : "Offline demo for when the backend is unavailable: deterministic sample data, no live case is created or changed, and the transaction ID is a local demo ID."}
        </p>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6 min-w-0">
            <HumanReviewDecision
              caseRef={caseRef}
              mode="demo"
              claimAmount={60}
              recommendedAction={null}
              link={{ demoId: "3", sessionId }}
            />

            {judge && (
              <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#6B7280]">
                  {zh ? "为什么需要人工审核" : "Why a human is needed"}
                </h2>
                <p className="mt-2 text-[14px] leading-relaxed">{zh ? judge.contentZh ?? judge.content : judge.content}</p>
              </section>
            )}

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#6B7280]">
                {zh ? "证据" : "Evidence"}
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {fixture?.evidence.map((e) => (
                  <li key={e.id} className={`rounded-lg border px-3 py-2 ${tone[e.category]}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{zh ? e.labelZh ?? e.label : e.label}</span>
                      <span className="text-[10px] font-bold uppercase">{catLabel[e.category]}</span>
                    </div>
                    {e.detail && <p className="mt-0.5 text-[12px] opacity-80">{zh ? e.detailZh ?? e.detail : e.detail}</p>}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-2 text-[14px]">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#6B7280]">{zh ? "案件" : "Case"}</h2>
              <Row k={zh ? "行程" : "Trip"} v={`${scenario?.trip.pickup ?? ""} → ${scenario?.trip.dropoff ?? ""}`} />
              <Row k={zh ? "车费" : "Fare"} v={scenario?.trip.fare ?? "—"} />
              <Row k={zh ? "索赔" : "Claim"} v={zh ? "清洁费 S$60（司机提交）" : "Cleaning fee S$60 (filed by driver)"} />
              <Row k={zh ? "路由" : "Route"} v={zh ? "人工审核" : "Human review"} />
            </section>
            {fixture?.fraudSignals && (
              <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#6B7280]">
                  {zh ? "风险信号（仅审核员可见）" : "Risk signals (reviewer only)"}
                </h2>
                <ul className="mt-3 space-y-2">
                  {fixture.fraudSignals.map((f) => (
                    <li key={f.id} className="rounded-lg border border-gray-200 px-3 py-2 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{zh ? f.labelZh ?? f.label : f.label}</span>
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            f.risk === "high" ? "text-[#E84360]" : f.risk === "medium" ? "text-[#B45309]" : "text-[#6B7280]"
                          }`}
                        >
                          {zh ? { high: "高", medium: "中", low: "低" }[f.risk] : f.risk}
                        </span>
                      </div>
                      {f.detail && <p className="mt-0.5 text-[12px] text-[#6B7280]">{zh ? f.detailZh ?? f.detail : f.detail}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[#6B7280]">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
