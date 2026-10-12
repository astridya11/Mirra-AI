"use client";

import { useState } from "react";
import { scriptFor } from "@/src/demo/privateAssist";
import type { AppFixture } from "@/src/demo/scenarios";
import type { Action, PartyView } from "@/src/demo/session";
import { useI18n } from "@/src/i18n";
import { AppBar, Initials, MirraButton, Toast, TripMap } from "./common";
import { DisputeCard } from "./DisputeCard";
import { MirraSheet } from "./MirraSheet";

/** Ryde Passenger app. Renders ONLY from passengerView(session). */
export function PassengerApp({ app, view, dispatch }: { app: AppFixture; view: PartyView; dispatch: (a: Action) => void }) {
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { t, locale } = useI18n();
  const { trip, driver } = app;
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1800);
  };
  const openMirra = () => {
    dispatch({ type: "openPrivate", party: "passenger", greeting: scriptFor(app.caseId, "passenger", locale).greeting });
    setSheet(true);
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface">
      <AppBar right={<MirraButton onClick={openMirra} />} />
      <Toast text={toast} />
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <TripMap
          deviation={trip.deviation}
          from={trip.pickup}
          to={view.tripStatus === "COMPLETED" ? trip.dropoff : undefined}
          className="h-44"
        />
        <div className="p-3 space-y-3 -mt-4 relative">
          {view.dispute && <DisputeCard app={app} dispute={view.dispute} party={view.party} dispatch={dispatch} uploads={view.uploads} />}

          {view.tripStatus === "ACTIVE" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-3 shadow-sm">
              <p className="text-sm font-bold text-ink">{t("app.driverArrived")}</p>
              <p className="text-xs text-muted">{t("app.pickup", { place: trip.pickup })}</p>
              <DriverRow app={app} />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => flash(t("app.calling", { name: driver.name }))} className="rounded-xl border border-line py-2 text-xs font-semibold">
                  📞 {t("app.call")}
                </button>
                <button onClick={() => flash(t("app.messageSentDriver"))} className="rounded-xl border border-line py-2 text-xs font-semibold">
                  💬 {t("app.message")}
                </button>
              </div>
            </div>
          )}

          {view.tripStatus === "NO_SHOW_CANCELLED" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-2 shadow-sm">
              <p className="text-sm font-bold text-ink">{t("app.tripCancelled")}</p>
              <p className="text-xs text-body">{t("app.noShowCharged", { pickup: trip.pickup, fare: trip.fare, payment: trip.payment.toLowerCase() })}</p>
              <DriverRow app={app} />
            </div>
          )}

          {view.tripStatus === "COMPLETED" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-ink">{t("app.tripCompleted")}</p>
                <span className="text-[10px] font-semibold text-ok bg-green-50 rounded-full px-2 py-0.5">{t("app.paid")}</span>
              </div>
              <p className="text-xs text-muted">
                {trip.pickup} → {trip.dropoff}
                <br />
                {trip.times}
              </p>
              <DriverRow app={app} />
              <div className="border-t border-line pt-2 space-y-1">
                {trip.lines.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs text-muted">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold text-ink pt-1">
                  <span>{t("app.total", { payment: trip.payment })}</span>
                  <span>{trip.fare}</span>
                </div>
              </div>
            </div>
          )}
          <p className="text-[10px] text-center text-muted">{t("app.needHelp")}</p>
        </div>
      </div>
      {sheet && <MirraSheet app={app} view={view} dispatch={dispatch} onClose={() => setSheet(false)} />}
    </div>
  );
}

function DriverRow({ app }: { app: AppFixture }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <Initials name={app.driver.name} tone="blue" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          {app.driver.name} <span className="text-xs text-muted font-normal">★ {app.driver.rating}</span>
        </p>
        <p className="text-[11px] text-muted truncate">{app.driver.vehicle ?? t("app.yourDriver")}</p>
      </div>
    </div>
  );
}
