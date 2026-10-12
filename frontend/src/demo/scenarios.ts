/**
 * Showcase demo definitions (briefings + presenter scripts).
 *
 * Case facts mirror backend/mock_data/DISP-00x.json.
 * Do not alter case facts here to improve the story — when the live backend returns
 * a completed result it is the source of truth; these values are the offline fallback.
 */

import type { Party, TripStatus } from "./session";

export type AgentKey = "collector" | "rider" | "driver" | "prosecutor" | "policy" | "judge" | "router";

export const AGENTS: Record<AgentKey, { name: string; role: string; color: string; glyph: string; phase: string }> = {
  collector: { name: "Evidence Collection Agent", role: "Gathers and indexes evidence for both advocates (read-only)", color: "#0891B2", glyph: "E", phase: "Intake" },
  rider: { name: "Rider Advocate", role: "Represents the passenger's perspective", color: "#F23D63", glyph: "R", phase: "Round 1" },
  driver: { name: "Driver Advocate", role: "Represents the driver's perspective", color: "#2563EB", glyph: "D", phase: "Round 1" },
  prosecutor: { name: "Prosecutor Agent", role: "Audits evidence, asks targeted questions", color: "#7C3AED", glyph: "P", phase: "Round 2" },
  policy: { name: "Policy Consultant", role: "Applies Ryde policies & precedents", color: "#D97706", glyph: "§", phase: "Policy" },
  judge: { name: "AI Judge", role: "Makes a fair, explainable decision", color: "#16A34A", glyph: "J", phase: "Deliberation" },
  router: { name: "Execution Router", role: "Automates or escalates to a human", color: "#475569", glyph: "→", phase: "Execution" },
};

export const AGENT_ORDER: AgentKey[] = ["collector", "rider", "driver", "prosecutor", "policy", "judge", "router"];

export interface PresenterNote {
  stage: string;
  say: string;
  watch: string;
  next: string;
}

export interface Outcome {
  label: string;
  caseId: string;
  headline: string;
  lines: string[];
  tone: "green" | "amber" | "red" | "slate";
}

export interface Demo {
  n: 1 | 2 | 3;
  title: string;
  theme: string;
  icon: string;
  caseIds: string[];
  question: string;
  scenario: string;
  card: string;
  checks: string[];
  proves: string[];
  outcomes: Outcome[];
  startsFrom: "Passenger" | "Driver";
  presenter: PresenterNote;
}

export const DEMOS: Demo[] = [
  {
    n: 1,
    title: "Route Deviation",
    theme: "Automation",
    icon: "🚗",
    caseIds: ["DISP-001"],
    question: "Can MIRRA autonomously resolve a clear, low-risk dispute?",
    scenario:
      "Marina Bay Sands → Changi Airport T3. The vehicle left the optimal ECP route onto the PIE (2.3 km deviation). The rider suspects an unnecessary detour caused an additional S$3.25 on an S$18.50 fare.",
    card: "A rider believes the driver took an unnecessary detour and caused an additional fare.",
    checks: ["GPS trajectory", "Trip duration", "Chat records", "Fare breakdown"],
    proves: [
      "Private MIRRA assistance — the driver is not notified",
      "Evidence-driven investigation",
      "Both sides represented by their own advocate",
      "Clear, low-risk cases can auto-resolve",
    ],
    outcomes: [
      {
        label: "Expected outcome",
        caseId: "DISP-001",
        headline: "S$3.25 refund → FULLY_AUTOMATED",
        lines: ["Clear evidence + low risk", "No human intervention required"],
        tone: "green",
      },
    ],
    startsFrom: "Passenger",
    presenter: {
      stage: "Briefing",
      say: "This is the simplest case: clear GPS evidence and a small amount. We want to show MIRRA can close it end-to-end without a human.",
      watch: "The passenger first asks MIRRA privately — the driver's app does not change at all.",
      next: "Begin Guided Demo, then open MIRRA from the passenger's active trip.",
    },
  },
  {
    n: 2,
    title: "No-show Charge",
    theme: "Fairness",
    icon: "⛔",
    caseIds: ["DISP-002"],
    question: "Can MIRRA remain neutral even when the complainant is wrong?",
    scenario:
      "Pickup at Tiong Bahru Plaza, scheduled 08:45. The driver arrived at 08:43, called the rider, the rider was notified, and the wait timer expired before the trip was cancelled at 08:51 with a S$5.00 no-show fee. The rider later disputes the charge.",
    card: "A rider disputes a S$5.00 no-show fee after the driver waited at the pickup point.",
    checks: ["Driver arrival GPS", "Wait timer", "Rider notification", "Call records"],
    proves: [
      "Driver can privately ask MIRRA — the passenger is not notified",
      "MIRRA verifies the record, not whoever complains first",
      "Complainants can lose when the evidence is against them",
      "Fair decisions are still automated",
    ],
    outcomes: [
      {
        label: "Expected outcome",
        caseId: "DISP-002",
        headline: "No-show fee upheld · no refund → FULLY_AUTOMATED",
        lines: ["Demo 1: the passenger wins", "Demo 2: the passenger loses", "MIRRA is neutral"],
        tone: "slate",
      },
    ],
    startsFrom: "Driver",
    presenter: {
      stage: "Briefing",
      say: "In Demo 1 the passenger won. Now the passenger complains again — but this time the evidence says the driver did everything right.",
      watch: "This demo starts on the driver side. When the driver asks MIRRA privately, the passenger sees nothing.",
      next: "Begin Guided Demo from the driver's pickup screen.",
    },
  },
  {
    n: 3,
    title: "Cleaning Fee Claim",
    theme: "Evidence Intelligence",
    icon: "📷",
    caseIds: ["DISP-004"],
    question: "Does MIRRA judge the evidence — not just whether evidence exists?",
    scenario:
      "Orchard → Bishan, 25 Sep. The driver tells MIRRA the rider left a mess and starts a S$60 cleaning-fee claim. MIRRA asks for a cleaning photo and a professional cleaning receipt. What happens next depends on the driver's evidence choice.",
    card: "A driver claims a cleaning fee. The driver's evidence choice decides the path: skip it, or upload a photo and receipt.",
    checks: ["Photo + receipt evidence request", "Image & EXIF analysis", "Receipt OCR", "Reused-photo detection"],
    proves: [
      "Missing evidence is not fraud",
      "A valid receipt does not make the whole claim valid",
      "MIRRA evaluates evidence as a package",
      "Cleaning fees always need human confirmation (POL-4)",
    ],
    outcomes: [
      {
        label: "If the driver skips the evidence",
        caseId: "Missing-evidence path",
        headline: "INSUFFICIENT EVIDENCE → cleaning fee not approved",
        lines: [
          "2 verified · 0 disputed · 3 missing evidence categories (6 underlying checks)",
          "Fraud LOW · no fraud accusation",
          "No driver payout",
        ],
        tone: "amber",
      },
      {
        label: "If photo + receipt are uploaded",
        caseId: "DISP-004",
        headline: "HIGH FRAUD RISK → AUTOMATION STOPPED → HUMAN REVIEW",
        lines: [
          "Receipt VALID: Sparkle Car Care Pte Ltd · S$60 · OCR 0.93",
          "Photo INCONSISTENT / REUSED: EXIF 2026-08-30 vs trip 2026-09-25 · matches DISP-0871",
          "Fraud 0.765 (demo fixture) · HIGH · no payout while pending",
        ],
        tone: "red",
      },
      {
        label: "If the evidence is valid (concept, not in this fixture)",
        caseId: "Approved path",
        headline: "Judge recommends → human confirms → fee charged",
        lines: ["Rider charged and driver credited only after human confirmation (POL-4)", "Amount comes from the policy / pipeline result — never hardcoded"],
        tone: "green",
      },
    ],
    startsFrom: "Driver",
    presenter: {
      stage: "Briefing",
      say: "One cleaning-fee claim. MIRRA first asks for the evidence needed to support it.",
      watch: "The driver's evidence choice changes MIRRA's path — skipping evidence is never treated as fraud.",
      next: "Begin Guided Demo, then open MIRRA from the driver's app.",
    },
  },
];

export const getDemo = (n: string) => DEMOS.find((d) => String(d.n) === n);

// ---------------------------------------------------------------------------
// Ryde app fixtures (Milestone 2). Trip facts, names and claim text come from
// backend/mock_data/DISP-00x.json. MIRRA replies are controlled fixture text
// (no LLM yet) live in privateAssist.ts.
// ---------------------------------------------------------------------------

export interface AppFixture {
  demoId: string;
  caseId: string;
  /** Party that files the formal complaint in this case (dispute_claim.filed_by). */
  complainant: Party;
  initialStatus: TripStatus;
  clock: Partial<Record<TripStatus, string>>;
  rider: { name: string; rating: number };
  driver: { name: string; rating: number; vehicle?: string };
  trip: {
    id: string;
    pickup: string;
    dropoff: string;
    times: string;
    fare: string;
    payment: string;
    deviation?: boolean;
    lines: [string, string][];
  };
  claim: { title: string; amount: string; description: string };
  /** Formal action opens the evidence-collection claim form instead of a plain confirmation. */
  claimForm?: boolean;
  /** Milestone 4: ids for creating the real backend case (backend/data/trips + users.json). */
  live?: { riderId: string; driverId: string; disputeType: string };
}

export const APPS: Record<string, AppFixture> = {
  "1": {
    demoId: "1",
    caseId: "DISP-001",
    complainant: "passenger",
    initialStatus: "COMPLETED",
    clock: { COMPLETED: "14:08" },
    rider: { name: "Sarah Chen", rating: 4.8 },
    driver: { name: "Tan Ah Kow", rating: 4.7 },
    trip: {
      id: "TRIP-2026-08112",
      pickup: "Marina Bay Sands",
      dropoff: "Changi Airport T3",
      times: "22 Sep · 13:30 – 14:05",
      fare: "S$18.50",
      payment: "Credit card",
      deviation: true,
      lines: [
        ["Base fare", "S$3.00"],
        ["Distance", "S$12.50"],
        ["Time", "S$3.00"],
      ],
    },
    claim: {
      title: "Route deviation",
      amount: "S$3.25",
      description: "The driver took a detour and I was charged an extra fee. I want the money back.",
    },
    live: { riderId: "R-1092", driverId: "D-5541", disputeType: "ROUTE_DEVIATION" },
  },
  "2": {
    demoId: "2",
    caseId: "DISP-002",
    complainant: "passenger",
    initialStatus: "ACTIVE",
    clock: { ACTIVE: "08:49", NO_SHOW_CANCELLED: "08:51" },
    rider: { name: "Michael Wong", rating: 3.9 },
    driver: { name: "Lim Wei Ming", rating: 4.9, vehicle: "White Honda HR-V · SGP 4521 M" },
    trip: {
      id: "TRIP-2026-09945",
      pickup: "Tiong Bahru Plaza",
      dropoff: "VivoCity",
      times: "13 Sep · pickup 08:45",
      fare: "S$5.00",
      payment: "E-wallet",
      lines: [
        ["Driver arrived", "08:43"],
        ["Driver call (no answer)", "08:47"],
        ["Free wait ended", "08:48"],
        ["No-show threshold", "08:51"],
      ],
    },
    claim: {
      title: "No-show charge",
      amount: "S$5.00",
      description:
        "I was at the pickup point at Tiong Bahru Plaza on time but the driver never showed up. I waited 10 minutes at the lobby and couldn't find the car. The app charged me a $5.00 cancellation fee for a 'no-show' which is completely unfair -- I was there, the driver was not. I want the charge reversed immediately.",
    },
    live: { riderId: "R-7823", driverId: "D-2398", disputeType: "NO_SHOW_CHARGE" },
  },
  // Demo 3 — one cleaning-fee claim on TRIP-2026-09104 (backend/mock_data/DISP-004.json).
  // The driver's evidence choice decides the path (see tribunalFor in tribunal.ts).
  "3": {
    demoId: "3",
    caseId: "DISP-004",
    complainant: "driver",
    initialStatus: "COMPLETED",
    clock: { COMPLETED: "22:58" },
    rider: { name: "Mei Tan", rating: 4.8 },
    driver: { name: "Suresh Kumar", rating: 4.9 },
    trip: {
      id: "TRIP-2026-09104",
      pickup: "Orchard",
      dropoff: "Bishan",
      times: "25 Sep · 21:40 – 22:05",
      fare: "S$24.50",
      payment: "E-wallet",
      lines: [
        ["Base fare", "S$3.50"],
        ["Distance", "S$14.00"],
        ["Time", "S$7.00"],
      ],
    },
    claim: { title: "Cleaning fee", amount: "S$60.00", description: "The rider caused a mess in my vehicle and i want to request a cleaning fee." },
    claimForm: true,
    live: { riderId: "R-5520", driverId: "D-3307", disputeType: "CLEANING_FEE" },
  },
};


// ---------------------------------------------------------------------------
// Presenter guide per guided-demo stage
// ---------------------------------------------------------------------------

export type GuideStage = "TRIP" | "PRIVATE" | "FORMAL" | "FROZEN" | "TRIBUNAL" | "DECISION";

export interface StageNote {
  say: string;
  watch: string;
  proves: string;
  expected: string;
  next: string;
}

const note = (say: string, watch: string, proves: string, expected: string, next: string): StageNote => ({ say, watch, proves, expected, next });

const SHARED_FORMAL_TO_TRIBUNAL = {
  FROZEN: note(
    "Both parties have now submitted their final evidence.",
    "The evidence base is frozen before the tribunal begins.",
    "MIRRA cannot silently change verified evidence during cross-examination.",
    "No party can add evidence from this point.",
    "Reveal the agents one by one with Next agent.",
  ),
};

export const GUIDE: Record<string, Record<GuideStage, StageNote>> = {
  "1": {
    TRIP: note(
      "Sarah has just finished a trip to Changi. She thinks it took longer than it should.",
      "Both apps show a normal completed trip.",
      "MIRRA is embedded in the real Ryde trip screen.",
      "No dispute exists yet.",
      "Tap MIRRA AI in the passenger app.",
    ),
    PRIVATE: note(
      "The passenger is only asking MIRRA privately. This is not yet a formal complaint.",
      "The driver receives no notification — the driver's app does not change at all.",
      "Private assistance never leaks to the other party.",
      "Passenger understands the 2.3 km deviation and the S$3.25 extra.",
      "Submit Formal Complaint from the passenger's MIRRA panel.",
    ),
    FORMAL: note(
      "Now it is formal. Only at this moment does the driver learn about the dispute.",
      "The driver sees the formal claim — never the passenger's private chat.",
      "Formal complaint is the first dispute event visible to both parties.",
      "Both sides submit final statements, then the tribunal starts.",
      "Submit final statements in both apps, then Start MIRRA Tribunal.",
    ),
    ...SHARED_FORMAL_TO_TRIBUNAL,
    TRIBUNAL: note(
      "Each side has its own advocate. The prosecutor audits the evidence and questions the driver.",
      "The driver's answer is labelled as a claim — it does not become evidence.",
      "Both sides are represented; evidence stays frozen.",
      "GPS: 2.3 km deviation, no valid reason under POL-2.",
      "Keep revealing until the Execution Router.",
    ),
    DECISION: note(
      "Clear evidence, low amount, no fraud or safety flags — so MIRRA executes automatically.",
      "Both apps receive the same ruling in their own words.",
      "Clear, low-risk cases can auto-resolve.",
      "S$3.25 refund → FULLY_AUTOMATED.",
      "Open the Internal Console, then move on to Demo 2.",
    ),
  },
  "2": {
    TRIP: note(
      "This demo starts on the driver side. Lim has arrived at Tiong Bahru Plaza and the rider is not there.",
      "The passenger app shows the normal 'driver has arrived' screen.",
      "The same MIRRA works for drivers, not just riders.",
      "No dispute exists yet.",
      "Tap MIRRA AI in the driver app.",
    ),
    PRIVATE: note(
      "The driver asks MIRRA privately what to do. MIRRA stays neutral and points to the waiting rules.",
      "The passenger receives nothing.",
      "Privacy works in both directions.",
      "Driver waits, contacts the rider, then cancels at the threshold.",
      "Cancel at the no-show threshold, then let the passenger dispute the charge.",
    ),
    FORMAL: note(
      "The passenger disputes the S$5 fee. Now the driver is notified.",
      "MIRRA does not assume the complainant is right.",
      "Formal complaint is the first dispute event visible to the driver.",
      "Arrival, notification, wait timer, call and cancellation time will be checked.",
      "Submit final statements, then Start MIRRA Tribunal.",
    ),
    ...SHARED_FORMAL_TO_TRIBUNAL,
    TRIBUNAL: note(
      "The prosecutor asks the rider for evidence of arrival. The rider says they arrived around 08:50.",
      "That answer is a claim only. Rider history appears as a secondary signal — not as the reason for the ruling.",
      "MIRRA decides on current-case evidence, not reputation.",
      "All five POL-3 conditions verified.",
      "Keep revealing until the Execution Router.",
    ),
    DECISION: note(
      "Demo 1: the passenger won. Demo 2: the passenger lost. MIRRA is neutral.",
      "The passenger sees 'No refund'; the driver sees the fee remains valid.",
      "MIRRA does not side with whoever files the complaint.",
      "No-show fee upheld → no refund → FULLY_AUTOMATED.",
      "Move on to Demo 3.",
    ),
  },
  "3": {
    TRIP: note(
      "Stage 1 — the driver wants to claim a cleaning fee. MIRRA first asks for the evidence needed to support the claim.",
      "The rider's app shows a normal completed trip.",
      "MIRRA guides before it judges.",
      "MIRRA asks for a cleaning photo and a professional receipt.",
      "Tap MIRRA AI in the driver app.",
    ),
    PRIVATE: note(
      "Stage 2 — the evidence choice. MIRRA asks for a cleaning photo and a professional cleaning receipt.",
      "If the driver skips the required evidence, MIRRA does not invent a fraud accusation — it simply cannot substantiate the claim.",
      "Claim preparation is private — the rider sees nothing yet.",
      "Two paths: skip the evidence, or upload photo + receipt.",
      "Start cleaning-fee claim, then upload (or skip) the evidence.",
    ),
    FORMAL: note(
      "Stage 3 — evidence submitted. Now the question is not simply whether evidence exists, but whether the evidence is trustworthy.",
      "The rider is notified only now. No forensic result is shown yet.",
      "Uploading evidence does not guarantee approval.",
      "Photo + receipt go into review.",
      "Submit final statements, then Start MIRRA Tribunal.",
    ),
    FROZEN: note(
      "The evidence package is frozen. Multimodal verification runs on the frozen record.",
      "Photo, EXIF time, photo location, fingerprint and receipt OCR are checked together.",
      "Evidence cannot change during the review.",
      "The receipt passes; the photo is checked for integrity.",
      "Watch the checks, then reveal the agents.",
    ),
    TRIBUNAL: note(
      "Stage 4 — multimodal verification. The receipt is valid, but the photo fails the integrity checks.",
      "Fraud 0.765 (demo fixture) · HIGH — from current-case evidence, not history.",
      "MIRRA evaluates evidence as a package.",
      "Automation stops.",
      "Keep revealing to the Execution Router.",
    ),
    DECISION: note(
      "Stage 5 — the Judge recommends, the Router routes, and POL-4 requires a human to confirm any cleaning fee.",
      "No payout is shown to the driver while the review is pending.",
      "MIRRA knows when not to automate.",
      "HIGH FRAUD RISK → AUTOMATION STOPPED → HUMAN REVIEW.",
      "Open the Internal Console or Human Review.",
    ),
  },
  "3-missing": {
    TRIP: note("", "", "", "", ""),
    PRIVATE: note("", "", "", "", ""),
    FORMAL: note(
      "Stage 3A — the driver filed the claim without the required photo and receipt.",
      "The rider is notified now. MIRRA will not guess what the evidence would have shown.",
      "Missing evidence is not fraud.",
      "INSUFFICIENT EVIDENCE.",
      "Submit final statements, then Start MIRRA Tribunal.",
    ),
    FROZEN: note(
      "The frozen record has no photo and no receipt.",
      "Gaps are recorded as missing — not as contradictions.",
      "MIRRA does not invent certainty.",
      "2 verified · 0 disputed · 3 missing evidence categories.",
      "Reveal the agents.",
    ),
    TRIBUNAL: note(
      "Fraud stays LOW — there is no evidence-integrity signal to analyse.",
      "Nobody is accused of anything.",
      "Missing evidence is not fraud.",
      "The claim cannot be substantiated.",
      "Keep revealing to the end.",
    ),
    DECISION: note(
      "MIRRA cannot substantiate the claim, so no cleaning fee is approved — and no fraud conclusion is made.",
      "Driver: 'Cleaning fee not approved'. Rider: 'No cleaning fee has been approved.'",
      "Missing evidence is not fraud.",
      "Cleaning fee not approved · no payout.",
      "Replay the claim with a photo and receipt uploaded.",
    ),
  },
};

// The missing-evidence path shares Demo 3's opening stages.
GUIDE["3-missing"].TRIP = GUIDE["3"].TRIP;
GUIDE["3-missing"].PRIVATE = GUIDE["3"].PRIVATE;
