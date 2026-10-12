/**
 * Tribunal data for the guided demo, normalised into one display shape.
 *
 * DISP-001 / DISP-002: mapped from mockCompletedResults (src/mock/cases.ts) — the
 *   repo's fixture CaseResult objects. Milestone 4 swaps the source for
 *   getCompletedResult(id) through the SAME fromCaseResult() mapper.
 * Demo 3 missing-evidence path: backend prosecutor checks + fraud scorer run on the DISP-004
 *   trip with the photo/receipt removed (DISP-003-style insufficient-evidence outcome).
 * DISP-004: evidence values from backend/mock_data/DISP-004.json; fraud 0.765 / HIGH /
 *   escalation from the agreed storyline. Judge confidence intentionally absent.
 *
 * Only structured outputs are shown — never chain-of-thought.
 */

import { judgeConfidence } from "@/src/components/review/reviewModel";
import { enumLabel, overlay, tEn, translator, type Locale, type Translator } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";
import { TRIBUNAL_ZH } from "@/src/i18n/content.zh-CN";
import { FIXTURE_TEXT_ZH } from "@/src/i18n/fixtures.zh-CN";
import { mockCompletedResults } from "@/src/mock/cases";
import type { CaseResult } from "@/src/types";
import type { AgentKey } from "./scenarios";
import type { Claim, Party } from "./session";

export type Step = "rider" | "driver" | "audit" | "cross" | "final" | "policy" | "judge" | "router";
export type Route = "FULLY_AUTOMATED" | "ESCALATED_HUMAN_REVIEW";
export type EvState = "VERIFIED" | "DISPUTED" | "MISSING" | "CONTRADICTED";

export const STEPS: { key: Step; name: string; agent: AgentKey }[] = [
  { key: "rider", name: "Rider Advocate", agent: "rider" },
  { key: "driver", name: "Driver Advocate", agent: "driver" },
  { key: "audit", name: "Initial Prosecutor", agent: "prosecutor" },
  { key: "cross", name: "Cross-examination", agent: "prosecutor" },
  { key: "final", name: "Final Prosecutor", agent: "prosecutor" },
  { key: "policy", name: "Policy Consultant", agent: "policy" },
  { key: "judge", name: "AI Judge", agent: "judge" },
  { key: "router", name: "Execution Router", agent: "router" },
];

export interface EvidenceItem {
  id: string;
  type: string;
  label: string;
  state: EvState;
}

export interface Fact {
  id: string;
  text: string;
}

export interface TEvent {
  step: Step;
  speaker: AgentKey;
  kind: "STATEMENT" | "AUDIT" | "QUESTION" | "RESPONSE" | "FINDING" | "POLICY" | "RULING" | "ROUTE";
  text: string;
  note?: string;
  /** Round-2 response: recorded in session.claims, never as evidence. */
  claim?: Claim;
  /** Live mode: evidence image (Prosecutor image analysis / Judge verdict image). */
  imageUrl?: string;
  /** Text is original backend free text (shown untranslated, with a label in other languages). */
  raw?: boolean;
}

export interface Perspective {
  headline: string;
  big: string;
  body: string;
  /** Body is the backend's original explanation text. */
  raw?: boolean;
  /** Frontend follow-up line shown after the body (localized). */
  note?: string;
}

export interface TribunalCase {
  /** Live run still streaming: no backend result yet, so no fixture-derived metrics may be shown. */
  pending?: boolean;
  caseId: string;
  disputeType: string;
  amount: string;
  source: string;
  evidence: EvidenceItem[];
  verified: Fact[];
  disputed: Fact[];
  missing: Fact[];
  questions: { to: Party; text: string; response?: string }[];
  /** fixture=true: demo value, not present in the raw case JSON (Milestone 4 uses live fraud_assessment). */
  fraud: { score: number; level: "LOW" | "MEDIUM" | "HIGH"; note: string; fixture?: boolean };
  /** UI grouping of raw missing checks into evidence categories (raw checks stay in `missing`). */
  missingCategories?: { label: string; checks: string[] }[];
  /** Policy safeguard shown alongside the outcome — not an escalation of this case. */
  policyNote?: string;
  /** Judge → Router → human confirmation → payout, as status lines (cleaning-fee flows). */
  execution?: { step: string; status: string; tone: "done" | "pending" | "blocked" | "none" }[];
  /** Short decision headline for the presenter / console. */
  headline?: string;
  /** Workflow label for the Internal Console, e.g. the evidence path taken. */
  path?: string;
  safety: { threat: boolean; escalated: boolean; priority: string; reasons: string[] };
  policy: { clauses: { id: string; title: string; summary: string }[]; suggestion: string };
  judge: { ruling: string; action: string; confidence: number | null; explanation: string; findings: string[]; raw?: boolean } | null;
  route: Route | null;
  verdict: Record<Party, Perspective>;
  events: TEvent[];
  learnings: string[];
  multimodal?: { steps: string[]; checks: { label: string; ok: boolean; detail: string }[] };
}

/** e.g. "3 verified · 0 disputed · 3 missing evidence categories (5 underlying checks)" — truthful to grouping and raw checks. */
export function factCounts(tc: Pick<TribunalCase, "verified" | "disputed" | "missing" | "missingCategories">, t: Translator = tEn) {
  const base = { v: tc.verified.length, d: tc.disputed.length, m: tc.missing.length };
  return tc.missingCategories
    ? t("facts.countsCategories", { ...base, c: tc.missingCategories.length })
    : t("facts.counts", base);
}

/** Localized label for a backend action, e.g. "Partial Refund · S$3.25" (raw enum unchanged). */
export function actionLabel(t: Translator, a?: { action_type?: string; refund_amount?: number } | null) {
  return a ? `${enumLabel(t, a.action_type)}${a.refund_amount ? ` · S$${a.refund_amount.toFixed(2)}` : ""}` : "";
}

const party = (p?: string): Party => (p === "DRIVER" ? "driver" : "passenger");

/** Maps a pipeline CaseResult into the tribunal display shape. Used for fixtures now, live results in Milestone 4. */
export function fromCaseResult(
  r: CaseResult,
  extra: { amount: string; verdict: Record<Party, Perspective>; learnings: string[]; fraudNote: string },
  t: Translator = tEn,
): TribunalCase {
  const pf = r.prosecutor_findings;
  const facts = (list?: { fact_id: string; description: string }[]) => (list ?? []).map((f) => ({ id: f.fact_id, text: f.description }));
  const verified = facts(pf?.verified_facts);
  const disputed = facts(pf?.disputed_facts);
  const missing = facts(pf?.missing_facts);

  const evidence: EvidenceItem[] = [];
  const addEvidence = (list: NonNullable<CaseResult["prosecutor_findings"]>["verified_facts"] | undefined, state: EvState) =>
    (list ?? []).forEach((f) =>
      f.supporting_evidence.forEach((e) => {
        if (!evidence.some((x) => x.id === e.evidence_id))
          evidence.push({ id: e.evidence_id, type: enumLabel(t, e.source_type), label: e.description, state });
      }),
    );
  addEvidence(pf?.verified_facts, "VERIFIED");
  addEvidence(pf?.disputed_facts, "DISPUTED");
  addEvidence(pf?.missing_facts, "MISSING");

  const cross = r.round_2_cross_exam;
  const questions = (cross?.targeted_questions ?? []).map((q) => ({
    to: party(q.directed_to),
    text: q.question_text,
    response: cross?.targeted_responses?.find((x) => x.question_id === q.question_id)?.response_text,
  }));

  const fa = r.bonus_modules?.fraud_assessment;
  const ep = r.bonus_modules?.escalation_protocol;
  const sug = r.policy_consultation?.suggestion;
  const jv = r.judge_verdict;
  // Route guard: case_metadata.resolution_channel on a RAW input case (e.g. backend/mock_data/DISP-004.json,
  // which starts at INIT_CLAIM with "FULLY_AUTOMATED") is NOT a decision. Only trust it once the pipeline has
  // run through the Execution Router and produced an execution payload; otherwise the route is unknown.
  const routed = r.case_metadata.current_state === "EXECUTION_ROUTER" && !!r.judge_verdict?.execution_payload;
  const route = routed ? ((r.case_metadata.resolution_channel as Route) ?? null) : null;
  const counts = factCounts({ verified, disputed, missing }, t);
  const conf = judgeConfidence(jv); // a failed Judge run's 0.00 is not a confidence
  const rider = r.round_1_statements?.rider_statement?.argument_summary;
  const driver = r.round_1_statements?.driver_statement?.argument_summary;

  // Agent texts are the backend's own words (raw); notes/labels are localized frontend copy.
  const events: TEvent[] = [
    { step: "rider", speaker: "rider", kind: "STATEMENT", text: rider ?? t("tribunal.riderClaim"), raw: !!rider },
    { step: "driver", speaker: "driver", kind: "STATEMENT", text: driver ?? t("tribunal.driverClaim"), raw: !!driver },
    { step: "audit", speaker: "prosecutor", kind: "AUDIT", text: t("tribunal.initialAudit", { counts }), note: t("tribunal.note.verified") },
  ];
  questions.forEach((q) => {
    events.push({ step: "cross", speaker: "prosecutor", kind: "QUESTION", text: q.text, raw: true, note: t(q.to === "driver" ? "tribunal.note.questionDriver" : "tribunal.note.questionRider") });
    if (q.response)
      events.push({
        step: "cross",
        speaker: q.to === "driver" ? "driver" : "rider",
        kind: "RESPONSE",
        text: q.response,
        raw: true,
        note: t("tribunal.note.claim"),
        claim: { party: q.to, text: q.response },
      });
  });
  events.push(
    { step: "final", speaker: "prosecutor", kind: "FINDING", text: pf?.prosecutor_summary ?? "", raw: true, note: t("tribunal.note.frozen", { counts }) },
    {
      step: "policy",
      speaker: "policy",
      kind: "POLICY",
      text: sug?.rationale ?? "",
      raw: true,
      note: t("tribunal.note.policy", { ids: (sug?.applicable_clauses ?? []).map((c) => c.clause_id).join(", ") }),
    },
    {
      step: "judge",
      speaker: "judge",
      kind: "RULING",
      text: jv?.reasoning_summary ?? "",
      raw: true,
      note: `${enumLabel(t, jv?.ruling_type)} · ${actionLabel(t, jv?.recommended_action)}${conf != null ? ` · ${t("tribunal.note.confidenceFixture", { c: conf.toFixed(2) })}` : ""}`,
    },
    {
      step: "router",
      speaker: "router",
      kind: "ROUTE",
      text: t(route === "FULLY_AUTOMATED" ? "tribunal.router.auto" : "tribunal.router.human"),
      note: route ? enumLabel(t, route) : undefined,
    },
  );

  return {
    caseId: r.case_metadata.case_id,
    disputeType: r.case_metadata.dispute_type,
    amount: extra.amount,
    source: "Fixture · src/mock/cases.ts (CaseResult) — live Judge output connects in Milestone 4",
    evidence,
    verified,
    disputed,
    missing,
    questions,
    fraud: { score: fa?.fraud_risk_score ?? 0, level: (ep?.fraud_risk_level as "LOW" | "MEDIUM" | "HIGH") ?? "LOW", note: extra.fraudNote },
    safety: {
      threat: !!ep?.safety_threat_detected,
      escalated: !!ep?.is_escalated,
      priority: ep?.priority_level ?? "STANDARD",
      reasons: ep?.escalation_reasons ?? [],
    },
    policy: {
      clauses: (sug?.applicable_clauses ?? []).map((c) => ({ id: c.clause_id, title: c.clause_title, summary: c.clause_text_summary ?? "" })),
      suggestion: `${enumLabel(t, sug?.suggested_ruling_type)} · ${actionLabel(t, sug?.suggested_recommended_action)}`,
    },
    judge: jv
      ? {
          ruling: enumLabel(t, jv.ruling_type),
          action: actionLabel(t, jv.recommended_action),
          confidence: conf,
          explanation: jv.reasoning_summary,
          findings: verified.map((f) => f.text),
          raw: true,
        }
      : null,
    route,
    verdict: extra.verdict,
    events,
    learnings: extra.learnings,
  };
}

const RESULTS = mockCompletedResults;

const disp001 = (t: Translator) => fromCaseResult(RESULTS["DISP-001"], {
  amount: "S$3.25",
  fraudNote: "No fraud risk factors in the current case.",
  verdict: {
    passenger: {
      headline: "Case resolved",
      big: "S$3.25 refund",
      body: RESULTS["DISP-001"].judge_verdict?.explanations?.explanation_for_rider ?? "",
      raw: true,
    },
    driver: {
      headline: "Case resolved",
      big: "Partial refund issued to rider",
      body: RESULTS["DISP-001"].judge_verdict?.explanations?.explanation_for_driver ?? "",
      raw: true,
    },
  },
  learnings: [
    "A navigation-app reroute without a verified cause is not a valid reason under POL-2.",
    "Clear GPS evidence + low amount + no fraud/safety flags → POL-6 allows automation.",
  ],
}, t);

const disp002 = (t: Translator) => fromCaseResult(RESULTS["DISP-002"], {
  amount: "S$5.00",
  fraudNote: "History-based secondary signal only (prior disputes, bad-faith flag). It is not used for the ruling — the POL-3 conditions are decided on current-case records.",
  verdict: {
    passenger: {
      headline: "Case resolved",
      big: "No-show charge upheld · No refund",
      body: RESULTS["DISP-002"].judge_verdict?.explanations?.explanation_for_rider ?? "",
      raw: true,
    },
    driver: {
      headline: "Case resolved",
      big: "Cancellation fee remains valid",
      body: RESULTS["DISP-002"].judge_verdict?.explanations?.explanation_for_driver ?? "",
      raw: true,
    },
  },
  learnings: [
    "All five POL-3 conditions were verified from system records, so the complainant's claim was rejected.",
    "The rider's round-2 answer (arriving ~08:50) stayed a claim and could not override frozen GPS and app events.",
  ],
}, t);

/**
 * Demo 3 — claim filed WITHOUT the required photo + receipt (DISP-003-style insufficient-evidence path).
 * Facts and fraud score: backend prosecutor checks + fraud scorer run on the DISP-004 trip with
 * image_evidence / receipt_evidence removed (2 verified · 0 disputed · 6 missing; fraud 0.015 NO_ACTION).
 */
const DEMO3_MISSING: TribunalCase = {
  caseId: "DISP-004",
  disputeType: "CLEANING_FEE",
  amount: "S$60.00",
  source: "Fixture · backend prosecutor checks + fraud scorer on DISP-004 without photo/receipt · live pipeline in Milestone 4",
  path: "Required evidence missing → DISP-003-style insufficient-evidence path",
  headline: "INSUFFICIENT EVIDENCE",
  evidence: [
    { id: "PAYMENT-DATA", type: "Payment record", label: "Cleaning-fee claim of SGD 60.00, filed 55 min after trip end", state: "VERIFIED" },
    { id: "F-MIS-001/002", type: "Cleaning receipt", label: "No receipt submitted", state: "MISSING" },
    { id: "F-MIS-003/005/006", type: "Cleaning photo", label: "No photo submitted", state: "MISSING" },
    { id: "F-MIS-004", type: "Party accounts", label: "Rider's account of the incident not recorded", state: "MISSING" },
  ],
  verified: [
    { id: "F-VER-001", text: "Cleaning-fee claim of SGD 60.00 recorded, filed at 2026-09-25T23:00:00+08:00 (dispute claim)." },
    { id: "F-VER-002", text: "The cleaning-fee claim was filed 55 min after trip end (trip end 25 Sep 22:05, filed 25 Sep 23:00)." },
  ],
  disputed: [],
  missing: [
    { id: "F-MIS-001", text: "No readable receipt is available to check the claimed amount against." },
    { id: "F-MIS-002", text: "No receipt evidence is available to check timing for." },
    { id: "F-MIS-003", text: "No image evidence with EXIF data is available." },
    { id: "F-MIS-004", text: "Relevant conflicting party accounts are incomplete: missing rider denial." },
    { id: "F-MIS-005", text: "The frozen structured evidence record does not contain verifiable image evidence for the cleaning-fee claim." },
    { id: "F-MIS-006", text: "Neither a photo reference in the claim nor structured image evidence is available in the frozen record." },
  ],
  missingCategories: [
    { label: "Cleaning receipt", checks: ["F-MIS-001", "F-MIS-002"] },
    { label: "Cleaning photo", checks: ["F-MIS-003", "F-MIS-005", "F-MIS-006"] },
    { label: "Party accounts", checks: ["F-MIS-004"] },
  ],
  policyNote: "Any approved cleaning-fee charge requires human confirmation under POL-4.",
  questions: [],
  fraud: {
    score: 0.015,
    level: "LOW",
    note: "Missing evidence is not fraud. No evidence-integrity signal exists to analyse; only minor historical risk factors (capped by the history-only safeguard).",
  },
  safety: { threat: false, escalated: false, priority: "STANDARD", reasons: [] },
  policy: {
    clauses: [
      {
        id: "POL-4",
        title: "Cleaning Fee Claims",
        summary:
          "A professional cleaning receipt dated within 24 hours after trip end is required; photo time/location checks apply. Any approved cleaning-fee charge requires human confirmation.",
      },
      { id: "POL-6", title: "Execution Gate and Escalation", summary: "Cleaning-fee charges are never auto-executed." },
    ],
    suggestion: "Required receipt and photo are missing — the cleaning fee cannot be approved on the frozen record.",
  },
  judge: {
    ruling: "NOT APPROVED",
    action: "No cleaning fee charged",
    confidence: null,
    explanation:
      "MIRRA cannot substantiate the cleaning-fee claim from the available evidence: the required receipt and photo were not submitted. Missing evidence is not fraud — no fraud conclusion is made.",
    findings: ["Claim recorded and filed on time", "No cleaning receipt submitted", "No cleaning photo submitted"],
  },
  route: null,
  execution: [
    { step: "AI Judge", status: "Recommends: cleaning fee not approved", tone: "done" },
    { step: "Execution Router", status: "No charge to execute", tone: "none" },
    { step: "Human confirmation (POL-4)", status: "Not required — no fee approved", tone: "none" },
    { step: "Payout", status: "None — rider not charged, driver not credited", tone: "none" },
  ],
  verdict: {
    passenger: {
      headline: "Claim reviewed",
      big: "No cleaning fee has been approved",
      body: "The driver's cleaning-fee claim could not be substantiated from the available evidence. You have not been charged.",
    },
    driver: {
      headline: "Claim could not be substantiated",
      big: "Cleaning fee not approved",
      body: "Evidence review: cleaning photo missing · cleaning receipt missing. MIRRA cannot approve a cleaning fee without the required evidence. This is not a fraud finding.",
    },
  },
  events: [
    { step: "rider", speaker: "rider", kind: "STATEMENT", text: "Presented the rider's position: the rider described the ride as smooth (MSG-202); no admission of soiling." },
    { step: "driver", speaker: "driver", kind: "STATEMENT", text: "Presented the driver's cleaning-fee claim of S$60.00. No photo or receipt was submitted with the claim." },
    {
      step: "audit",
      speaker: "prosecutor",
      kind: "AUDIT",
      text: "Initial audit on the frozen record: 2 verified · 0 disputed · 3 missing evidence categories (6 underlying checks). No receipt and no photo are on file.",
      note: "Evidence verification completed",
    },
    {
      step: "cross",
      speaker: "prosecutor",
      kind: "QUESTION",
      text: "No targeted question can resolve the gaps: a missing receipt or photo cannot be added after the evidence freeze.",
      note: "Freeze respected",
    },
    {
      step: "final",
      speaker: "prosecutor",
      kind: "FINDING",
      text: "Frozen evidence unchanged. Missing items are recorded as MISSING — not as contradictions and not as fraud.",
      note: "INSUFFICIENT EVIDENCE · fraud LOW",
    },
    { step: "policy", speaker: "policy", kind: "POLICY", text: "POL-4 requires a professional cleaning receipt; without it the fee cannot be approved. POL-6: cleaning-fee charges are never auto-executed.", note: "Applicable policy: POL-4, POL-6" },
    { step: "judge", speaker: "judge", kind: "RULING", text: "Recommends: cleaning fee not approved — the claim cannot be substantiated. No fraud conclusion.", note: "NOT APPROVED" },
    { step: "router", speaker: "router", kind: "ROUTE", text: "No charge to execute. Claim closed without a cleaning fee.", note: "No payout" },
  ],
  learnings: ["Missing evidence is recorded as missing, never as fraud.", "MIRRA asks for evidence first and does not invent certainty when it is absent."],
};

const DISP_004: TribunalCase = {
  caseId: "DISP-004",
  disputeType: "CLEANING_FEE",
  amount: "S$60.00",
  path: "Required evidence received → DISP-004 multimodal-verification path",
  headline: "HIGH FRAUD RISK → AUTOMATION STOPPED → HUMAN REVIEW REQUIRED",
  policyNote: "Any approved cleaning-fee charge requires human confirmation under POL-4.",
  execution: [
    { step: "AI Judge", status: "Recommends: escalate — automation stopped", tone: "blocked" },
    { step: "Execution Router", status: "ESCALATED_HUMAN_REVIEW · HIGH_PRIORITY", tone: "done" },
    { step: "Human confirmation (POL-4)", status: "Pending human reviewer", tone: "pending" },
    { step: "Payout", status: "None while the review is pending", tone: "none" },
  ],
  source: "Fixture · backend/mock_data/DISP-004.json + agreed fraud storyline · Judge confidence not asserted",
  evidence: [
    { id: "RCP-001", type: "Receipt OCR", label: "Sparkle Car Care Pte Ltd · S$60 · OCR 0.93 · 26 Sep 09:30", state: "VERIFIED" },
    { id: "PAYMENT-DATA", type: "Payment record", label: "Cleaning-fee claim of SGD 60.00, filed 55 min after trip end", state: "VERIFIED" },
    { id: "IMG-001", type: "Photo", label: "Liquid spill · moderate · AI-generated signal 0.05", state: "VERIFIED" },
    { id: "IMG-001 · EXIF time", type: "EXIF", label: "Taken 2026-08-30 15:12 — trip was 2026-09-25", state: "CONTRADICTED" },
    { id: "IMG-001 · EXIF GPS", type: "EXIF GPS", label: "1.3496, 103.9568 — ≈12 km from the Bishan drop-off", state: "CONTRADICTED" },
    { id: "IMG-001 · pHash", type: "Image fingerprint", label: "Matches known image from DISP-0871", state: "CONTRADICTED" },
  ],
  verified: [
    { id: "F-VER-001", text: "Cleaning-fee claim of SGD 60.00 recorded, filed at 2026-09-25T23:00:00+08:00 (dispute claim)." },
    { id: "F-VER-002", text: "The cleaning-fee claim was filed 55 min after trip end (trip end 25 Sep 22:05, filed 25 Sep 23:00)." },
    { id: "F-VER-003", text: "Receipt RCP-001: Sparkle Car Care Pte Ltd, SGD 60.00, dated 26 Sep 09:30 (within 24 h of trip end), OCR confidence 0.93." },
  ],
  disputed: [
    { id: "F-DIS-001", text: "Photo IMG-001 EXIF timestamp 2026-08-30 15:12 is before the trip (2026-09-25)." },
    { id: "F-DIS-002", text: "Photo IMG-001 EXIF GPS (1.3496, 103.9568) is outside the 500 m drop-off window." },
    { id: "F-DIS-003", text: "Photo IMG-001 perceptual hash matches a known image from DISP-0871 (recycled photo)." },
  ],
  missing: [],
  questions: [
    { to: "driver", text: "Photo IMG-001 was taken on 2026-08-30 and matches an image from DISP-0871. When and where was this photo taken?" },
  ],
  // 0.765 / HIGH is agreed demo storyline data — it is NOT in backend/mock_data/DISP-004.json.
  // Milestone 4 replaces it with bonus_modules.fraud_assessment from the completed pipeline.
  fraud: {
    score: 0.765,
    level: "HIGH",
    fixture: true,
    note: "Demo fixture value (not in the raw DISP-004 input). Driven by current-case evidence integrity signals (EXIF time, EXIF GPS, recycled image) — not by party history.",
  },
  safety: { threat: false, escalated: true, priority: "HIGH_PRIORITY", reasons: ["Fraud risk HIGH", "Cleaning-fee charge requires human confirmation"] },
  policy: {
    clauses: [
      {
        id: "POL-4",
        title: "Cleaning Fee Claims",
        summary: "EXIF time/location inconsistent with the trip or a recycled image must be recorded as contradicted. Cleaning-fee charges always require human confirmation.",
      },
      { id: "POL-6", title: "Execution Gate and Escalation", summary: "No auto-execution when fraud risk is HIGH; fraud HIGH → HIGH_PRIORITY." },
    ],
    suggestion: "ESCALATED · human review required",
  },
  judge: {
    ruling: "ESCALATED",
    action: "No charge applied pending human review",
    confidence: null,
    explanation: "The receipt is valid, but the photo evidence is contradicted by its EXIF date, EXIF location and a recycled-image match. One valid evidence item does not validate the whole claim.",
    findings: [
      "Receipt valid (OCR 0.93)",
      "Photo taken 26 days before the trip",
      "Photo location ≈12 km from drop-off",
      "Photo reused from DISP-0871",
    ],
  },
  // Fixture route. Milestone 4: take the route from the completed pipeline's Execution Router output —
  // never from the raw input's case_metadata.resolution_channel ("FULLY_AUTOMATED" at INIT_CLAIM).
  route: "ESCALATED_HUMAN_REVIEW",
  verdict: {
    passenger: {
      headline: "Under human review",
      big: "No fee charged",
      body: "A cleaning-fee claim on your trip needs human review before any decision. No fee has been charged to you.",
    },
    driver: {
      headline: "Under human review",
      big: "Claim sent to human review",
      body: "Your receipt was verified, but the photo could not be matched to this trip. A Ryde specialist will review the claim before any fee is applied. No payment is made while the review is pending.",
    },
  },
  events: [
    { step: "rider", speaker: "rider", kind: "STATEMENT", text: "Presented the rider's position: the rider described the ride as smooth (MSG-202); no admission of soiling." },
    { step: "driver", speaker: "driver", kind: "STATEMENT", text: "Presented the driver's cleaning-fee claim of S$60.00 with photo IMG-001 and receipt RCP-001." },
    {
      step: "audit",
      speaker: "prosecutor",
      kind: "AUDIT",
      text: "Initial audit: receipt verified (OCR 0.93). Photo EXIF date, EXIF location and image fingerprint contradict the trip.",
      note: "Multimodal verification completed",
    },
    { step: "cross", speaker: "prosecutor", kind: "QUESTION", text: "To the driver: photo IMG-001 was taken on 2026-08-30 and matches DISP-0871. When and where was it taken?", note: "Targeted question to the driver" },
    {
      step: "final",
      speaker: "prosecutor",
      kind: "FINDING",
      text: "Frozen evidence unchanged. Any answer is retained as a claim and cannot overturn EXIF or fingerprint evidence.",
      note: "3 verified · 3 contradicted · fraud 0.765 HIGH (fixture)",
    },
    { step: "policy", speaker: "policy", kind: "POLICY", text: "POL-4: contradicted photo evidence is recorded; cleaning-fee charges need human confirmation. POL-6: fraud HIGH blocks automation.", note: "Applicable policy: POL-4, POL-6" },
    { step: "judge", speaker: "judge", kind: "RULING", text: "A valid receipt does not make the whole claim valid. Automation stopped.", note: "ESCALATED" },
    { step: "router", speaker: "router", kind: "ROUTE", text: "HIGH fraud risk → automation stopped → human review required.", note: "ESCALATED_HUMAN_REVIEW · HIGH_PRIORITY" },
  ],
  learnings: [
    "One valid evidence item (the receipt) does not validate the whole claim.",
    "Recycled or out-of-window photos are integrity issues, routed to a human — MIRRA does not decide alone.",
  ],
  multimodal: {
    steps: ["Analyzing photo…", "Reading EXIF…", "Checking GPS…", "Comparing image fingerprint…", "Running receipt OCR…", "Checking prior evidence matches…"],
    checks: [
      { label: "Photo analysis", ok: true, detail: "Liquid spill · moderate · AI-generated 0.05" },
      { label: "EXIF timestamp", ok: false, detail: "2026-08-30 15:12 vs trip 2026-09-25" },
      { label: "EXIF GPS", ok: false, detail: "≈12 km from drop-off (limit 500 m)" },
      { label: "Image fingerprint", ok: false, detail: "phash:c3d4e5f6a7b8c9d0" },
      { label: "Receipt OCR", ok: true, detail: "Sparkle Car Care Pte Ltd · S$60 · 0.93" },
      { label: "Prior evidence match", ok: false, detail: "Known image from DISP-0871" },
    ],
  },
};

/**
 * Offline fixtures only: swap curated Chinese in for the mock CaseResult texts. A translated block is
 * our own demo copy, not backend output, so it drops the "original system text" (raw) marker.
 */
function translateFixture<T>(o: T): T {
  if (typeof o === "string") return (FIXTURE_TEXT_ZH[o] ?? o) as T;
  if (Array.isArray(o)) return o.map(translateFixture) as T;
  if (!o || typeof o !== "object") return o;
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const [k, v] of Object.entries(o)) {
    out[k] = translateFixture(v);
    if (typeof v === "string" && out[k] !== v) changed = true;
  }
  if (changed && out.raw === true) out.raw = false;
  return out as T;
}

// Fixtures per locale: generated copy via the translator, curated Chinese overlays on top.
const cache = new Map<Locale, Record<string, TribunalCase>>();
function fixtures(locale: Locale): Record<string, TribunalCase> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const t = translator(locale);
  const zh = (tc: TribunalCase, id: string) => (locale === "zh-CN" ? translateFixture(overlay(tc, TRIBUNAL_ZH[id])) : tc);
  const built = {
    "DISP-001": zh(disp001(t), "DISP-001"),
    "DISP-002": zh(disp002(t), "DISP-002"),
    "DISP-004": zh(DISP_004, "DISP-004"),
    DEMO3_MISSING: zh(DEMO3_MISSING, "DEMO3_MISSING"),
  };
  cache.set(locale, built);
  return built;
}

/** Localized step name (Rider Advocate, Initial Prosecutor, …). */
export const stepName = (t: Translator, step: Step) => t(`step.${step}` as MessageKey);

/**
 * Tribunal data for a case. Demo 3 branches on the driver's evidence choice:
 * photo + receipt submitted → DISP-004 multimodal path; otherwise the insufficient-evidence path.
 */
export function tribunalFor(caseId: string, evidenceProvided: boolean, locale: Locale = "en"): TribunalCase {
  const f = fixtures(locale);
  return caseId === "DISP-004" && !evidenceProvided ? f.DEMO3_MISSING : f[caseId];
}
