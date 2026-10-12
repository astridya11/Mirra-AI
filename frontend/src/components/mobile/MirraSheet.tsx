"use client";

import { useEffect, useRef, useState } from "react";
import { TypingDots } from "@/src/components/TypingDots";
import { fileClaim } from "@/src/demo/live";
import { getPrivateMirraResponse, matchAction, visibleSuggestions, type AssistAction, localizedChat, spokenText } from "@/src/demo/privateAssist";
import type { AppFixture } from "@/src/demo/scenarios";
import type { Action, PartyView } from "@/src/demo/session";
import { AvailabilityBadge, MirraLogo } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import { TripMap } from "./common";

/**
 * Private MIRRA assistance panel, shared by Passenger and Driver apps.
 * Reads only this party's own view; writes only this party's private chat.
 */
export function MirraSheet({
  app,
  view,
  dispatch,
  onClose,
  onStartClaim,
}: {
  app: AppFixture;
  view: PartyView;
  dispatch: (a: Action) => void;
  onClose: () => void;
  /** Opens the evidence-collection form (cleaning-fee claims) instead of a plain confirmation. */
  onStartClaim?: () => void;
}) {
  const other = view.party === "passenger" ? "driver" : "passenger";
  const { t, locale } = useI18n();
  const otherLabel = t(other === "driver" ? "role.driver" : "role.passenger");
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  /** User text shown while MIRRA is "typing"; suggestions are hidden meanwhile. */
  const [pending, setPending] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const chat = view.chat ?? [];
  const canFile = app.complainant === view.party && !view.dispute;
  const suggestions = pending || confirming ? [] : visibleSuggestions(app.caseId, view.party, chat, view.tripStatus, canFile, locale);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length, confirming, pending]);

  /** One path for taps and typed text: formal → confirmation; anything else → the response adapter. */
  async function send(text: string, tapped: AssistAction | null) {
    if (pending) return;
    const action = tapped ?? matchAction(app.caseId, view.party, text, view.tripStatus, locale);
    if (action?.formal && canFile) {
      if (app.claimForm && onStartClaim) onStartClaim();
      else setConfirming(true);
      return;
    }
    setPending(text);
    const res = await getPrivateMirraResponse({
      caseId: app.caseId,
      party: view.party,
      message: text,
      action: tapped ?? undefined, // undefined → adapter routes typed text itself
      tripStatus: view.tripStatus,
      conversation: chat,
      locale,
    });
    dispatch({
      type: "privateMessage",
      party: view.party,
      text,
      actionId: tapped?.label,
      reply: { from: "mirra", text: res.text, map: res.map, suggest: res.suggest },
    });
    setPending(null);
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-white animate-slide-up" role="dialog" aria-label={t("chat.dialog")}>
      <div className="bg-console px-4 pt-3 pb-3 shrink-0">
        <div className="flex items-start justify-between">
          <MirraLogo dark subtitle={false} />
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1" aria-label={t("chat.close")}>
            ✕
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <AvailabilityBadge />
          <span className="text-[10px] text-slate-400">{t(view.party === "passenger" ? "chat.passengerSupport" : "chat.driverSupport")}</span>
        </div>
      </div>
      <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl bg-mirra-soft border border-mirra/20 px-3 py-2 shrink-0">
        <span aria-hidden>🔒</span>
        <div>
          <p className="text-xs font-semibold text-ink">{t("chat.private")}</p>
          <p className="text-[11px] text-muted">{t("chat.notNotified", { other: otherLabel })}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 py-3 space-y-2">
        {localizedChat(app.caseId, view.party, chat, locale).map((m, i) =>
          m.from === "user" ? (
            <p key={i} className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-br-md bg-mirra text-white text-xs px-3 py-2 animate-pop-in">
              {m.text}
            </p>
          ) : (
            <div key={i} className="max-w-[90%] rounded-2xl rounded-bl-md bg-surface border border-line text-xs text-body px-3 py-2 animate-pop-in">
              <p>{m.text}</p>
              {m.map && <TripMap deviation={app.trip.deviation} from={app.trip.pickup} to={app.trip.deviation ? app.trip.dropoff : undefined} className="h-28 rounded-lg mt-2" />}
            </div>
          ),
        )}
        {pending && (
          <>
            <p className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-br-md bg-mirra text-white text-xs px-3 py-2 animate-pop-in">{pending}</p>
            <div className="w-fit rounded-2xl rounded-bl-md bg-surface border border-line px-3 py-2.5" aria-label={t("chat.typing")} data-typing>
              <TypingDots />
            </div>
          </>
        )}
        {confirming && (
          <div className="rounded-2xl border border-mirra/40 bg-white p-3 space-y-2 animate-pop-in">
            <p className="text-xs font-bold text-ink">{t("chat.confirmTitle")}</p>
            <p className="text-[11px] text-muted">{t("chat.confirmBody", { other: otherLabel })}</p>
            <div className="flex gap-2">
              <button
                disabled={filing}
                onClick={async () => {
                  setFiling(true);
                  await fileClaim(app, view.party, dispatch);
                  onClose();
                }}
                className="flex-1 rounded-lg bg-mirra text-white text-xs font-semibold py-2 disabled:opacity-50"
              >
                {filing ? t("chat.submitting") : t("chat.submitComplaint")}
              </button>
              <button onClick={() => setConfirming(false)} className="flex-1 rounded-lg border border-line text-xs py-2">
                {t("chat.notNow")}
              </button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-line p-2 space-y-2">
        {suggestions.length > 0 && (
          <>
            <p className="text-[10px] font-semibold text-muted px-1">{t("chat.suggested")}</p>
            {/* At most two, stacked vertically; replaced after every reply. */}
            <ul className="space-y-1.5">
              {suggestions.map((a) => (
                <li key={a.label}>
                  <button
                    onClick={() => send(spokenText(app.caseId, view.party, a, locale), a)}
                    className={`w-full flex items-center gap-2 text-left text-xs rounded-xl border px-3 py-2 break-words ${
                      a.formal ? "border-mirra bg-mirra text-white font-semibold" : "border-mirra/30 text-mirra bg-white hover:bg-mirra-soft"
                    }`}
                  >
                    <span className="flex-1 min-w-0">{a.display ?? a.label}</span>
                    <span aria-hidden>→</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            send(text, null);
          }}
          className="flex items-center gap-2 rounded-full border border-line pl-3 pr-1 py-1"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.input")}
            data-chat-input
            className="flex-1 min-w-0 text-xs outline-none bg-transparent"
          />
          <button type="submit" className="w-7 h-7 rounded-full bg-mirra text-white text-xs" aria-label={t("chat.send")}>
            ➤
          </button>
        </form>
      </div>
    </div>
  );
}
