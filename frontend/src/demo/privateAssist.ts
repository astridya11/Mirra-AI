/**
 * Private MIRRA Assistant — pre-dispute, private support only.
 *
 * NOT the Judge, Prosecutor, Advocates or Policy Consultant. It acknowledges the user's
 * concern calmly, explains what can be checked and the normal Ryde process, and helps the
 * user decide whether a formal complaint is needed. It never rules, never takes sides, and
 * never states facts beyond the current trip record.
 *
 * Single entry point: getPrivateMirraResponse(). Today it returns deterministic scripted
 * fixture replies (facts from backend/mock_data). Milestone 4 can swap the implementation for
 * a DeepSeek-backed call without touching the UI.
 *
 * Privacy: replies are stored only in the asking party's own private chat (session.privateChats[party]).
 */

import { overlay, type Locale } from "@/src/i18n";
import { FEELING_ZH, SCRIPTS_ZH } from "@/src/i18n/content.zh-CN";
import type { ChatMsg, Party, TripStatus } from "./session";

export interface AssistAction {
  /** Stable id (English) — referenced by start/next/fallbackNext and stored suggestions. */
  label: string;
  /** Localized chip text (falls back to label). */
  display?: string;
  /** Extra keywords for typed messages in the selected language. */
  matchZh?: string[];
  /** What the user "says" when tapping the suggestion (defaults to label). */
  ask?: string;
  reply: string;
  map?: boolean;
  /** Opens the formal-complaint confirmation instead of replying. */
  formal?: boolean;
  /** Keywords that route free-typed text to this reply. */
  match?: string[];
  /** Only offered while the trip is in this status. */
  when?: TripStatus;
  /** Follow-up suggestion labels offered after this reply. */
  next?: string[];
}

export interface AssistScript {
  greeting: string;
  /** Opening suggestions (max two are shown). */
  start: string[];
  actions: AssistAction[];
  /** Calm acknowledgement used when the user expresses frustration. */
  empathy: string;
  /** Scope reply when free text matches nothing — never guesses beyond the trip record. */
  fallback: string;
  fallbackNext: string[];
}

export interface PrivateMirraRequest {
  caseId: string;
  party: Party;
  message: string;
  /** Set when the user tapped a suggestion. */
  action?: AssistAction | null;
  tripStatus: TripStatus;
  conversation: ChatMsg[];
  /** Selected UI language — replies come back in this language (a future DeepSeek call receives it too). */
  locale: Locale;
}

export interface PrivateMirraResponse {
  text: string;
  map?: boolean;
  suggest: string[];
}

export const MAX_SUGGESTIONS = 2;
const TYPING_MS = 900;
/** Scripted replies that already open with an acknowledgement don't get a second one. */
const ACKNOWLEDGES = /^(I understand|That sounds|That's a|我理解|这确实|行程以这样)/;
const FEELING = ["annoy", "frustrat", "angry", "upset", "unfair", "so long", "waited", "ridiculous", "fed up", "worried", "stress", ...FEELING_ZH];

// ---------------------------------------------------------------------------
// Scripts (fixture). Trip facts come from backend/mock_data/DISP-00x.json.
// ---------------------------------------------------------------------------

const FORMAL = (label: string, when?: TripStatus): AssistAction => ({
  label,
  reply: "",
  formal: true,
  match: ["complain", "formal", "dispute", "refund", "reverse", "submit", "start claim", "claim"],
  when,
});

export const SCRIPTS: Record<string, Record<Party, AssistScript>> = {
  "DISP-001": {
    passenger: {
      greeting: "Hi Sarah, I'm MIRRA. How can I help with your trip to Changi Airport T3?",
      start: ["I think the driver took a longer route", "Understand the charge"],
      actions: [
        {
          label: "I think the driver took a longer route",
          ask: "I think the driver took a longer route than necessary. Can you check?",
          reply:
            "That sounds confusing. I can review the route privately with you before you decide whether to raise a formal complaint. The trip record shows the vehicle left the ECP onto the PIE at 13:42 — 2.3 km further, and the trip took 35 min against an optimal 28 min.",
          match: ["longer", "route", "detour", "check", "way"],
          next: ["View route comparison", "Ask for clarification"],
        },
        {
          label: "View route comparison",
          reply: "Expected: ECP, about 28 min. Actual: PIE, 35 min, +2.3 km. The deviation began at 13:42. No unexpected stops were recorded.",
          map: true,
          match: ["compare", "comparison", "map"],
          next: ["Understand the charge", "Submit formal complaint"],
        },
        {
          label: "Understand the charge",
          reply:
            "Your fare was S$18.50: base S$3.00 + distance S$12.50 + time S$3.00. The part linked to the extra distance and time is about S$3.25. Whether any of it is refunded is only decided if you submit a formal complaint.",
          match: ["charge", "fare", "fee", "pay", "price", "cost"],
          next: ["View route comparison", "Submit formal complaint"],
        },
        {
          label: "Ask for clarification",
          reply:
            "In the trip chat at 13:43 you asked why the PIE was taken; the driver replied that their GPS auto-rerouted. I can't confirm the reason for the reroute from the trip record. If you file a formal complaint, the driver can explain in full.",
          match: ["why", "clarif", "explain", "reason"],
          next: ["View route comparison", "Submit formal complaint"],
        },
        FORMAL("Submit formal complaint"),
      ],
      empathy: "I understand why that would be frustrating.",
      fallback:
        "I can't confirm that from the current trip record yet. I can help you review the route and the fare before you decide whether to submit a formal complaint — nothing is shared with the driver unless you do.",
      fallbackNext: ["View route comparison", "Understand the charge"],
    },
    driver: {
      greeting: "Hi Tan, I'm MIRRA. Ask me anything about your trips — privately.",
      start: ["Summarise my last trip", "How are fares calculated?"],
      actions: [
        {
          label: "Summarise my last trip",
          reply: "TRIP-2026-08112: Marina Bay Sands → Changi Airport T3, 13:30 – 14:05, S$18.50, paid by credit card.",
          match: ["last", "trip", "summary", "summarise"],
          next: ["How are fares calculated?"],
        },
        {
          label: "How are fares calculated?",
          reply: "Fares combine a base fare, distance and time. Your last trip: base S$3.00 + distance S$12.50 + time S$3.00.",
          match: ["fare", "calculat", "earn"],
          next: ["Summarise my last trip"],
        },
      ],
      empathy: "I understand — that sounds stressful.",
      fallback: "I can't confirm that from your current trip record. I can summarise your last trip or explain how fares are calculated. This conversation is private.",
      fallbackNext: ["Summarise my last trip", "How are fares calculated?"],
    },
  },
  "DISP-002": {
    driver: {
      greeting: "Hi Lim, I'm MIRRA. I'm here if you need help at this pickup.",
      start: ["The rider hasn't arrived yet", "Verify my location"],
      actions: [
        {
          label: "The rider hasn't arrived yet",
          ask: "The rider hasn't arrived yet. What should I do?",
          reply:
            "I understand this is frustrating, especially when you're already at the pickup point. I can help you check the waiting process privately — the passenger is not notified. You arrived at 08:43 and the free 5-minute wait ended at 08:48.",
          match: ["arrive", "late", "what should", "waiting", "not here", "no show"],
          next: ["Check the waiting timer", "Help me contact the rider"],
        },
        {
          label: "Verify my location",
          reply: "Your GPS is within 10 m of the Tiong Bahru Plaza pickup point and the vehicle is stationary. Arrival was auto-confirmed at 08:43.",
          map: true,
          match: ["location", "where am", "gps", "verify"],
          next: ["Check the waiting timer", "Help me contact the rider"],
        },
        {
          label: "Check the waiting timer",
          reply: "Free wait: 5 minutes from your arrival (08:43 – 08:48). The no-show threshold is 8 minutes after arrival, at 08:51.",
          match: ["timer", "how long", "wait time"],
          next: ["What happens after 8 minutes?", "Continue waiting"],
        },
        {
          label: "Help me contact the rider",
          reply:
            "Use Call rider or Message rider on your trip screen. Your in-app call at 08:47 rang for 22 s with no answer. Every contact attempt is logged on the trip record.",
          match: ["contact", "call", "message", "phone"],
          next: ["Check the waiting timer", "Stay neutral"],
        },
        {
          label: "What happens after 8 minutes?",
          reply:
            "Once the 8-minute threshold is reached (08:51), Ryde's no-show process lets you cancel the trip as a rider no-show, and the app applies the S$5.00 no-show fee. The choice to cancel is yours — MIRRA doesn't make it for you.",
          match: ["after 8", "8 minutes", "cancel", "fee"],
          next: ["Continue waiting", "Help me contact the rider"],
        },
        {
          label: "Continue waiting",
          reply: "Okay. Stay at the designated pickup point. Your arrival time and contact attempts are already on the trip record.",
          match: ["keep waiting", "continue", "stay"],
          next: ["Help me contact the rider"],
        },
        {
          label: "Stay neutral",
          reply: "Keep messages factual and polite, and avoid guessing why the rider is late. The trip record speaks for itself.",
          match: ["neutral", "rude", "angry at"],
        },
      ],
      empathy: "I understand why that would be frustrating — you're already at the pickup point.",
      fallback:
        "I can help you check the waiting timeline and what options are available. I can't confirm anything beyond the current trip record. The passenger is not notified.",
      fallbackNext: ["Check the waiting timer", "Help me contact the rider"],
    },
    passenger: {
      greeting: "Hi Michael, I'm MIRRA. How can I help with your ride from Tiong Bahru Plaza?",
      start: ["Where is my driver?", "How long will the driver wait?", "Why was I charged a no-show fee?", "Understand the charge"],
      actions: [
        {
          label: "Where is my driver?",
          reply: "Your driver Lim Wei Ming arrived at Tiong Bahru Plaza at 08:43 — white Honda HR-V, SGP 4521 M.",
          match: ["where", "driver", "car"],
          when: "ACTIVE",
          next: ["How long will the driver wait?"],
        },
        {
          label: "How long will the driver wait?",
          reply: "The free waiting time is 5 minutes from the driver's arrival at 08:43. After that, a cancellation fee may apply under Ryde's no-show process.",
          match: ["how long", "wait"],
          when: "ACTIVE",
        },
        {
          label: "Why was I charged a no-show fee?",
          ask: "I was at the pickup point. Why was I charged a no-show fee?",
          reply:
            "That sounds frustrating, especially if you were nearby. I can review this privately — the driver is not notified. The trip record shows a S$5.00 cancellation fee charged to your e-wallet at 08:51 with the reason 'rider no-show' at Tiong Bahru Plaza.",
          match: ["why", "charged", "no-show", "fee"],
          when: "NO_SHOW_CANCELLED",
          next: ["Understand the charge", "Submit formal complaint"],
        },
        {
          label: "Understand the charge",
          reply:
            "Under Ryde's no-show process, the free wait is 5 minutes and the no-show threshold is 8 minutes after the driver arrives; the fee is S$5.00. If you believe it was applied wrongly, a formal complaint lets MIRRA review the full trip record.",
          match: ["understand", "policy", "charge"],
          when: "NO_SHOW_CANCELLED",
          next: ["Submit formal complaint"],
        },
        FORMAL("Submit formal complaint", "NO_SHOW_CANCELLED"),
      ],
      empathy: "I understand why that would be frustrating.",
      fallback: "I can't confirm that from the current trip record yet. I can help you understand what the record shows — nothing is shared with the driver unless you submit a formal complaint.",
      fallbackNext: ["Why was I charged a no-show fee?", "Where is my driver?"],
    },
  },
  "DISP-004": {
    driver: {
      greeting: "Hi Suresh, I'm MIRRA. How can I help with your last trip?",
      start: ["The rider left a mess", "What evidence is required?"],
      actions: [
        {
          label: "The rider left a mess",
          ask: "The rider left a mess in my vehicle.",
          reply:
            "That's a frustrating end to a trip. I can help you prepare a cleaning-fee claim privately — the rider is not notified. To review it fairly, supporting evidence such as a photo and a professional cleaning receipt is needed.",
          match: ["mess", "clean", "dirty", "seat", "vomit", "spill"],
          next: ["Start cleaning-fee claim", "What evidence is required?"],
        },
        {
          label: "What evidence is required?",
          reply:
            "Under Ryde policy (POL-4): a photo of the soiling taken soon after drop-off, and a professional cleaning receipt dated within 24 h of trip end. Claims must be filed within 48 h. Submitting evidence doesn't guarantee approval — MIRRA reviews it as a package.",
          match: ["evidence", "receipt", "photo", "need", "required"],
          next: ["Start cleaning-fee claim"],
        },
        FORMAL("Start cleaning-fee claim"),
      ],
      empathy: "I understand — dealing with that is stressful.",
      fallback: "I can't confirm that from the current trip record yet. I can explain what a cleaning-fee claim needs before you decide whether to start one.",
      fallbackNext: ["What evidence is required?", "Start cleaning-fee claim"],
    },
    passenger: {
      greeting: "Hi Mei, I'm MIRRA. How can I help?",
      start: ["Summarise my last trip"],
      actions: [
        {
          label: "Summarise my last trip",
          reply: "TRIP-2026-09104: Orchard → Bishan, 21:40 – 22:05, S$24.50, paid by e-wallet.",
          match: ["trip", "summary", "last"],
        },
      ],
      empathy: "I understand.",
      fallback: "I can't confirm that from the current trip record. I can summarise your last trip. This conversation is private.",
      fallbackNext: ["Summarise my last trip"],
    },
  },
};

/** Script in the selected language (curated overlay; ids, facts and flow unchanged). */
export const scriptFor = (caseId: string, party: Party, locale: Locale = "en"): AssistScript =>
  locale === "zh-CN" ? overlay(SCRIPTS[caseId][party], (SCRIPTS_ZH[caseId] as Record<Party, unknown> | undefined)?.[party]) : SCRIPTS[caseId][party];

/** What the user "says" when tapping a chip, in the selected language. */
export function spokenText(caseId: string, party: Party, a: AssistAction, locale: Locale = "en"): string {
  if (locale === "en") return a.ask ?? a.label;
  const base = SCRIPTS[caseId][party].actions.find((b) => b.label === a.label);
  // A curated translated ask wins; otherwise the translated chip text — never the English fallback.
  return a.ask && a.ask !== base?.ask ? a.ask : (a.display ?? a.ask ?? a.label);
}

/**
 * Chat turns rendered in the current language. Greeting and tapped (scripted) turns are re-resolved
 * from the script by actionId; typed messages and free replies stay exactly as written.
 */
export function localizedChat(caseId: string, party: Party, chat: ChatMsg[], locale: Locale = "en"): ChatMsg[] {
  const script = scriptFor(caseId, party, locale);
  return chat.map((m, i) => {
    if (i === 0 && m.from === "mirra") return { ...m, text: script.greeting };
    const ask = m.from === "user" ? m : chat[i - 1]?.from === "user" ? chat[i - 1] : undefined;
    const act = ask?.actionId ? script.actions.find((x) => x.label === ask.actionId) : undefined;
    if (!act || act.formal) return m;
    return { ...m, text: m.from === "user" ? spokenText(caseId, party, act, locale) : act.reply };
  });
}

const available = (a: AssistAction | undefined, status: TripStatus, canFile: boolean): a is AssistAction =>
  !!a && (!a.when || a.when === status) && (!a.formal || canFile);

/**
 * Suggestions to show now: follow-ups attached to MIRRA's latest reply (or the script's opening set),
 * minus anything already asked, filtered by trip status — at most MAX_SUGGESTIONS.
 */
export function visibleSuggestions(caseId: string, party: Party, chat: ChatMsg[], status: TripStatus, canFile: boolean, locale: Locale = "en"): AssistAction[] {
  const script = scriptFor(caseId, party, locale);
  const asked = new Set(chat.filter((m) => m.from === "user").flatMap((m) => [m.text, m.actionId ?? ""]));
  const last = [...chat].reverse().find((m) => m.from === "mirra");
  const labels = last?.suggest ?? script.start;
  return labels
    .map((l) => script.actions.find((a) => a.label === l))
    .filter((a): a is AssistAction => available(a, status, canFile) && !asked.has(a.label) && !asked.has(a.ask ?? a.label))
    .slice(0, MAX_SUGGESTIONS);
}

/** Routes free text to a scripted action (fixture only — replaced by the model in Milestone 4). */
export function matchAction(caseId: string, party: Party, text: string, status: TripStatus, locale: Locale = "en"): AssistAction | null {
  const t = text.toLowerCase();
  return (
    scriptFor(caseId, party, locale).actions.find(
      (a) => (!a.when || a.when === status) && [...(a.match ?? []), ...(a.matchZh ?? [])].some((m) => t.includes(m)),
    ) ?? null
  );
}

/**
 * The single response adapter for private assistance.
 * ponytail: deterministic scripted replies; swap the body for a backend DeepSeek call in Milestone 4.
 */
export async function getPrivateMirraResponse(req: PrivateMirraRequest): Promise<PrivateMirraResponse> {
  const script = scriptFor(req.caseId, req.party, req.locale);
  const matched = req.action === undefined ? matchAction(req.caseId, req.party, req.message, req.tripStatus, req.locale) : req.action;
  // Reply in the selected language even if the chip came from the other language's script.
  const action = matched ? (script.actions.find((a) => a.label === matched.label) ?? matched) : null;
  const feeling = !req.action && FEELING.some((f) => req.message.toLowerCase().includes(f));
  await new Promise((r) => setTimeout(r, TYPING_MS));

  if (action && !action.formal) {
    return {
      text: feeling && !ACKNOWLEDGES.test(action.reply) ? `${script.empathy} ${action.reply}` : action.reply,
      map: action.map,
      suggest: action.next ?? [],
    };
  }
  return { text: feeling ? `${script.empathy} ${script.fallback}` : script.fallback, suggest: script.fallbackNext };
}
