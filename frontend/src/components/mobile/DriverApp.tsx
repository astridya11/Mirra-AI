"use client";

import { useState } from "react";
import { scriptFor } from "@/src/demo/privateAssist";
import type { AppFixture } from "@/src/demo/scenarios";
import type { Action, PartyView } from "@/src/demo/session";
import { useI18n } from "@/src/i18n";
import { AppBar, Initials, MirraButton, Toast, TripMap } from "./common";
import { CleaningClaimForm } from "./CleaningClaimForm";
import { DisputeCard } from "./DisputeCard";
import { MirraSheet } from "./MirraSheet";

/** Ryde Driver app. Renders ONLY from driverView(session). */
export function DriverApp({ app, view, dispatch }: { app: AppFixture; view: PartyView; dispatch: (a: Action) => void }) {
  const [sheet, setSheet] = useState(false);
  const [claimForm, setClaimForm] = useState(false);
  const { t, locale } = useI18n();
  const [toast, setToast] = useState<string | null>(null);
  const { trip, rider } = app;
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1800);
  };
  const openMirra = () => {
    dispatch({ type: "openPrivate", party: "driver", greeting: scriptFor(app.caseId, "driver", locale).greeting });
    setSheet(true);
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface">
      <AppBar
        right={
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-ok bg-green-50 border border-green-200 rounded-full px-2 py-0.5">{t("app.online")}</span>
            <MirraButton onClick={openMirra} />
          </div>
        }
      />
      <Toast text={toast} />
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <TripMap from={view.tripStatus === "ACTIVE" ? t("app.pickupMap", { place: trip.pickup }) : t("app.youreOnline")} className="h-44" />
        <div className="p-3 space-y-3 -mt-4 relative">
          {view.dispute && <DisputeCard app={app} dispute={view.dispute} party={view.party} dispatch={dispatch} uploads={view.uploads} />}

          {view.tripStatus === "ACTIVE" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-ink">{t("app.arrivedAtPickup")}</p>
                <span className="text-[10px] font-semibold text-warn bg-amber-50 rounded-full px-2 py-0.5">{t("app.waitingForRider")}</span>
              </div>
              <p className="text-xs text-muted">
                {trip.pickup} → {trip.dropoff}
              </p>
              <RiderRow app={app} />
              <div className="rounded-xl bg-surface border border-line px-3 py-2 space-y-1">
                {trip.lines.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[11px] text-muted">
                    <span>{k}</span>
                    <span className="font-semibold text-body">{v}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => flash(t("app.calling", { name: rider.name }))} className="rounded-xl border border-line py-2 text-xs font-semibold">
                  📞 {t("app.callRider")}
                </button>
                <button onClick={() => flash(t("app.messageSentRider"))} className="rounded-xl border border-line py-2 text-xs font-semibold">
                  💬 {t("app.messageRider")}
                </button>
              </div>
              <button
                onClick={() => dispatch({ type: "tripStatus", status: "NO_SHOW_CANCELLED" })}
                className="w-full rounded-xl bg-ink text-white py-2 text-xs font-semibold"
              >
                {t("app.cancelNoShow", { fare: trip.fare })}
              </button>
            </div>
          )}

          {view.tripStatus === "NO_SHOW_CANCELLED" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-2 shadow-sm">
              <p className="text-sm font-bold text-ink">{t("app.cancelledNoShow")}</p>
              <p className="text-xs text-body">{t("app.noShowApplied", { fare: trip.fare })}</p>
              <RiderRow app={app} />
            </div>
          )}

          {view.tripStatus === "COMPLETED" && (
            <div className="rounded-2xl bg-white border border-line p-3 space-y-2 shadow-sm">
              <p className="text-[10px] font-bold tracking-wider text-muted uppercase">{t("app.lastTrip")}</p>
              <p className="text-sm font-semibold text-ink">
                {trip.pickup} → {trip.dropoff}
              </p>
              <p className="text-xs text-muted">{trip.times}</p>
              <RiderRow app={app} />
              <div className="flex justify-between text-sm font-bold text-ink border-t border-line pt-2">
                <span>{t("app.fare", { payment: trip.payment })}</span>
                <span>{trip.fare}</span>
              </div>
            </div>
          )}
          {!view.dispute && <p className="text-[10px] text-center text-muted">{t("app.noNotifications")}</p>}
        </div>
      </div>
      {sheet && (
        <MirraSheet
          app={app}
          view={view}
          dispatch={dispatch}
          onClose={() => setSheet(false)}
          onStartClaim={() => {
            setSheet(false);
            setClaimForm(true);
          }}
        />
      )}
      {claimForm && !view.dispute && <CleaningClaimForm app={app} view={view} dispatch={dispatch} onClose={() => setClaimForm(false)} />}
    </div>
  );
}

function RiderRow({ app }: { app: AppFixture }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <Initials name={app.rider.name} />
      <div>
        <p className="text-sm font-semibold text-ink">
          {app.rider.name} <span className="text-xs text-muted font-normal">★ {app.rider.rating}</span>
        </p>
        <p className="text-[11px] text-muted">{t("app.rider")}</p>
      </div>
    </div>
  );
}
