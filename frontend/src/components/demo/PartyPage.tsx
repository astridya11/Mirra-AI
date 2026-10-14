"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import RydeApp from "@/src/components/ryde/RydeApp";
import { LanguageSwitch, Phone } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/context/I18nContext";
import { useHydrated } from "@/src/hooks/useStoredValue";
import { briefingSessionId, resetSession } from "@/src/lib/sessionStorage";
import { partyHref } from "@/src/lib/demoLinks";
import type { DemoId, Party } from "@/src/types/session";

/**
 * One party's Ryde app as its own tab (presentation after the prototype PartyTab).
 * Bound to the shared demo session from ?session=…; RydeApp renders only this
 * party's view (selectPartyView), so private MIRRA chats never cross tabs.
 */
export default function PartyPage({ demoId, party }: { demoId: DemoId; party: Party }) {
  return (
    <Suspense>
      <PartyPageInner demoId={demoId} party={party} />
    </Suspense>
  );
}

function PartyPageInner({ demoId, party }: { demoId: DemoId; party: Party }) {
  const hydrated = useHydrated();
  const params = useSearchParams();
  if (!hydrated) return <div className="min-h-screen bg-console" />;
  if (!["1", "2", "3"].includes(demoId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-console text-slate-300 text-sm">
        <Link href="/demo" className="hover:text-white">
          Unknown demo · ← /demo
        </Link>
      </div>
    );
  }
  return <PartyPageBody demoId={demoId} party={party} sid={params.get("session") ?? briefingSessionId(demoId)} />;
}

function PartyPageBody({ demoId, party, sid }: { demoId: DemoId; party: Party; sid: string }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  // Remount the app after a reset so its local screen state starts over too.
  const [epoch, setEpoch] = useState(0);
  const other: Party = party === "passenger" ? "driver" : "passenger";
  const label = party === "passenger" ? (zh ? "乘客" : "Passenger") : zh ? "司机" : "Driver";

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1b1f2b] to-console flex flex-col items-center px-4 py-4 gap-4" data-party-page={party}>
      <div className="w-full max-w-[760px] flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <Link href={`/demo/${demoId}`} className="font-semibold text-slate-300 hover:text-white">
          ← {zh ? "返回演示" : "Back to Demo"}
        </Link>
        <span
          className={`font-semibold px-2.5 py-0.5 rounded-full ${
            party === "passenger" ? "bg-mirra/20 text-mirra" : "bg-teal-400/15 text-teal-300"
          }`}
        >
          {label}
        </span>
        <span>
          {zh ? `演示 ${demoId}` : `Demo ${demoId}`} · {zh ? "会话" : "Session"}{" "}
          <span className="font-mono text-slate-200">{sid}</span>
        </span>
        <LanguageSwitch dark />
        <span className="ml-auto flex items-center gap-4">
          <a href={partyHref(demoId, other, sid)} target="_blank" rel="noreferrer" className="font-semibold text-mirra hover:brightness-125">
            {other === "driver" ? (zh ? "打开司机应用 ↗" : "Open Driver App ↗") : zh ? "打开乘客应用 ↗" : "Open Passenger App ↗"}
          </a>
          <button
            onClick={() => {
              resetSession(demoId, sid);
              setEpoch((e) => e + 1);
            }}
            className="hover:text-white"
          >
            {zh ? "重置会话" : "Reset Session"}
          </button>
        </span>
      </div>
      <Phone size="lg">
        <div className="flex-1 min-h-0" data-phone={party}>
          <RydeApp key={epoch} demoId={demoId} sessionId={sid} party={party} embedded />
        </div>
      </Phone>
      <p className="text-[11px] text-slate-500 text-center max-w-[420px]">
        {zh
          ? "此标签页只显示该方自己的视图。私人 MIRRA 对话不会出现在另一方的应用中。"
          : "This tab shows only this party's view. Private MIRRA chats never appear in the other party's app."}
      </p>
    </div>
  );
}
