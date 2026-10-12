"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { defaultSession, driverView, passengerView, type Party } from "@/src/demo/session";
import { useScenarioSession } from "@/src/demo/useDemoSession";
import { useI18n } from "@/src/i18n";
import { appFor } from "@/src/i18n/content";
import { LanguageSwitch } from "@/src/i18n/LanguageSwitch";
import { Phone } from "@/src/components/showcase/ui";
import { DriverApp } from "./DriverApp";
import { PassengerApp } from "./PassengerApp";

/**
 * One party's Ryde app bound to a shared demo session (?session=…).
 * Each party receives only its own selector output — never the raw session.
 */
export function PartyTab(props: { party: Party; demoId: string; sessionId?: string; backHref?: string }) {
  return (
    <Suspense>
      <PartyTabInner {...props} />
    </Suspense>
  );
}

function PartyTabInner({ party, demoId, sessionId, backHref }: { party: Party; demoId: string; sessionId?: string; backHref?: string }) {
  const params = useSearchParams();
  const sid = sessionId ?? params.get("session") ?? defaultSession(demoId);
  const { app: source, session, dispatch } = useScenarioSession(demoId, sid);
  const { t, locale } = useI18n();
  const app = source && appFor(source, locale);

  if (!app) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-console text-slate-300 text-sm p-6 text-center">
        {t("tab.notAvailable", { n: demoId })}
      </div>
    );
  }

  const other: Party = party === "passenger" ? "driver" : "passenger";
  const label = t(party === "passenger" ? "exp.passenger" : "exp.driver");

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1b1f2b] to-console flex flex-col items-center px-4 py-4 gap-4">
      <div className="w-full max-w-[720px] flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        {backHref && (
          <Link href={backHref} className="hover:text-white">
            ←
          </Link>
        )}
        <span className="font-semibold text-white">{label}</span>
        <span>
          {t("tab.meta", { n: demoId, caseId: app.caseId })} <span className="font-mono text-slate-200">{sid}</span>
        </span>
        <LanguageSwitch dark compact />
        <span className="ml-auto flex gap-3">
          <a href={`/demo/${demoId}/${other}?session=${sid}`} target="_blank" rel="noreferrer" className="text-mirra hover:brightness-125">
            {t(other === "passenger" ? "tab.openPassenger" : "tab.openDriver")}
          </a>
          <button onClick={() => dispatch({ type: "reset" })} className="hover:text-white">
            {t("common.resetSession")}
          </button>
        </span>
      </div>
      <Phone size="lg" time={app.clock[session.tripStatus] ?? "9:41"}>
        {party === "passenger" ? (
          <PassengerApp app={app} view={passengerView(session)} dispatch={dispatch} />
        ) : (
          <DriverApp app={app} view={driverView(session)} dispatch={dispatch} />
        )}
      </Phone>
    </div>
  );
}
