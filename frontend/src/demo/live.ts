/**
 * Milestone 4 — live backend pipeline for the demo (Demo 3 first).
 *
 * Same backend path as the original RydeHELP flow:
 *   createDispute (photo + receipt as base64)  →  GET /stream (runs the pipeline, SSE)
 *   →  image-check (Prosecutor image analysis + Judge verdict image)  →  completed result.
 * Fixture mode stays the offline fallback (no backend, demo samples, or creation failure).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, createDispute, getCompletedResult, getImageCheck, type ImageCheckResponse } from "@/src/lib/api";
import { judgeConfidence } from "@/src/components/review/reviewModel";
import { enumLabel, tEn, translator, type Locale, type Translator } from "@/src/i18n";
import type { CaseResult, PipelineEvent } from "@/src/types";
import type { AgentKey, AppFixture } from "./scenarios";
import type { Action, Party, UploadKind } from "./session";
import { fromCaseResult, tribunalFor, type Step, type TEvent, type TribunalCase } from "./tribunal";

// ---------------------------------------------------------------------------
// Live / offline switch (per browser, like Presenter Mode). Default: LIVE.
// ---------------------------------------------------------------------------

const LIVE_KEY = "mirra.liveMode";
const liveSubs = new Set<() => void>();
const readLive = () => {
  try {
    return localStorage.getItem(LIVE_KEY) !== "0";
  } catch {
    return true;
  }
};
export const isLiveMode = readLive;

export function useLiveMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (f) => {
      liveSubs.add(f);
      window.addEventListener("storage", f);
      return () => {
        liveSubs.delete(f);
        window.removeEventListener("storage", f);
      };
    },
    readLive,
    () => true,
  );
  const set = (v: boolean) => {
    try {
      localStorage.setItem(LIVE_KEY, v ? "1" : "0");
    } catch {}
    liveSubs.forEach((f) => f());
  };
  return [on, set];
}

// ---------------------------------------------------------------------------
// Claim creation
// ---------------------------------------------------------------------------

/** Real files picked in this tab (File objects can't travel through the shared session). */
export const claimFiles: Partial<Record<UploadKind, File>> = {};

const toDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** Creates the backend dispute case for this claim; returns the new case id. */
export async function createLiveClaim(app: AppFixture, files: Partial<Record<UploadKind, File>> = {}): Promise<string> {
  if (!app.live) throw new Error("Live mode is not configured for this demo");
  const res = await createDispute({
    trip_id: app.trip.id,
    dispute_type: app.live.disputeType,
    dispute_claim_description: app.claim.description,
    filed_by: app.complainant === "driver" ? "DRIVER" : "RIDER",
    rider_id: app.live.riderId,
    driver_id: app.live.driverId,
    image_evidence: files.photo ? [await toDataUrl(files.photo)] : [],
    receipt_evidence: files.receipt ? [await toDataUrl(files.receipt)] : [],
  });
  return res.case_id;
}

/**
 * Files the formal claim. LIVE: creates the real backend case first; if that fails the session is
 * visibly marked offline (never fixture data under a LIVE label). OFFLINE: reference story only.
 */
export async function fileClaim(
  app: AppFixture,
  party: Party,
  dispatch: (a: Action) => void,
  files: Partial<Record<UploadKind, File>> = {},
  allowLive = true,
) {
  if (app.live && allowLive && isLiveMode()) {
    dispatch({ type: "live", status: "CREATING" });
    try {
      dispatch({ type: "live", status: "CREATED", caseId: await createLiveClaim(app, files) });
    } catch {
      dispatch({ type: "live", status: "ERROR" }); // backend unavailable → offline reference story
    }
  }
  dispatch({ type: "submitFormal", party });
}

// ---------------------------------------------------------------------------
// Stream event → tribunal board event
// ---------------------------------------------------------------------------

type FeedEvent = PipelineEvent & { sub_phase?: string; payload?: unknown };
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const TEXT_KEYS = ["argument_summary", "detailed_argument", "reasoning_and_statement", "statement", "content", "question_text", "response_text", "question", "answer", "message", "text", "reasoning"];
const firstText = (o: Rec | null) => {
  for (const k of TEXT_KEYS) if (o && typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  return "";
};

function speakerKey(raw: string): AgentKey {
  const s = raw.toUpperCase();
  if (s.includes("RIDER")) return "rider";
  if (s.includes("DRIVER")) return "driver";
  if (s.includes("POLICY")) return "policy";
  if (s.includes("JUDGE")) return "judge";
  if (s.includes("ROUTER")) return "router";
  return "prosecutor";
}

/** Maps one live pipeline event to a structured board event (null = nothing to show). Agent text stays raw. */
export function mapLiveEvent(e: FeedEvent, t: Translator = tEn): TEvent | null {
  const phase = e.phase ?? "";
  const sub = e.sub_phase ?? "";
  const data = rec(e.data) ?? rec(e.payload) ?? {};
  if (e.event_type === "AGENT_CONVERSATION") {
    const speaker = speakerKey(String(e.speaker ?? data.speaker ?? "PROSECUTOR"));
    const text = firstText(data) || firstText(rec(data.agent_output));
    if (!text) return null;
    if (phase === "ROUND_1_PLEADINGS") return { step: speaker === "driver" ? "driver" : "rider", speaker, kind: "STATEMENT", text, raw: true };
    if (speaker === "prosecutor") return { step: "cross", speaker, kind: "QUESTION", text, raw: true, note: t("live.note.question") };
    const party = speaker === "driver" ? "driver" : "passenger";
    return { step: "cross", speaker, kind: "RESPONSE", text, raw: true, note: t("tribunal.note.claim"), claim: { party, text } };
  }
  if (e.event_type !== "PHASE_COMPLETED") return null;
  if (phase === "ROUND_2_PROSECUTOR_AUDIT" && (sub === "INITIAL_AUDIT" || sub === "FINAL_REPORT")) {
    const summary = firstText(rec(data.prosecutor_findings)) || String(rec(data.prosecutor_findings)?.prosecutor_summary ?? "");
    if (!summary) return null;
    return sub === "INITIAL_AUDIT"
      ? { step: "audit", speaker: "prosecutor", kind: "AUDIT", text: summary, raw: true, note: t("live.note.initialAudit") }
      : { step: "final", speaker: "prosecutor", kind: "FINDING", text: summary, raw: true, note: t("live.note.finalReport") };
  }
  if (phase === "POLICY_CONSULTATION") {
    const s = rec(data.suggestion);
    if (!s) return null;
    return { step: "policy", speaker: "policy", kind: "POLICY", text: String(s.rationale ?? ""), raw: true, note: t("live.note.suggested", { ruling: enumLabel(t, String(s.suggested_ruling_type ?? "")) }) };
  }
  if (phase === "JUDGE_DELIBERATION") {
    const c = judgeConfidence(data as { confidence_score?: number; reasoning_summary?: string; ruling_type?: string });
    return {
      step: "judge",
      speaker: "judge",
      kind: "RULING",
      text: String(data.reasoning_summary ?? ""),
      raw: true,
      note: `${enumLabel(t, String(data.ruling_type ?? ""))} · ${c == null ? t("live.note.confidenceUnavailable") : t("live.note.confidence", { c: c.toFixed(2) })}`,
    };
  }
  return null;
}

/** Prosecutor "Image Analysis" bubbles: the uploaded photo + the backend's integrity summary (raw). */
export const imageAnalysisEvents = (res: ImageCheckResponse | null, t: Translator = tEn): TEvent[] =>
  (res?.images ?? []).map((img) => ({
    step: "audit" as Step,
    speaker: "prosecutor" as AgentKey,
    kind: "AUDIT" as const,
    text: img.summary,
    raw: true,
    note: t("live.note.imageAnalysis"),
    imageUrl: backendUrl(img.image_url),
  }));

/** Judge "Evidence Verdict" bubbles: the backend-rendered verdict image (stain boxes + stamp). */
export const verdictImageEvents = (res: ImageCheckResponse | null, t: Translator = tEn, stamp = 0): TEvent[] =>
  (res?.images ?? [])
    .filter((img) => img.verdict_image_url)
    .map((img) => ({
      step: "judge" as Step,
      speaker: "judge" as AgentKey,
      kind: "RULING" as const,
      text: t("live.verdictImageText"),
      note: t("live.note.evidenceVerdict"),
      imageUrl: `${backendUrl(img.verdict_image_url!)}?t=${stamp}`,
    }));

function routerEvent(r: CaseResult, t: Translator): TEvent {
  const route = r.case_metadata.resolution_channel;
  return { step: "router", speaker: "router", kind: "ROUTE", text: t(route === "ESCALATED_HUMAN_REVIEW" ? "live.router.human" : "live.router.auto"), note: enumLabel(t, route) };
}

// ---------------------------------------------------------------------------
// One stream per case (module registry — survives re-renders and dev double-mount).
// Raw backend events are stored; board events are mapped at render time in the
// selected language, so switching language never re-runs anything.
// ---------------------------------------------------------------------------

export interface LiveRun {
  raw: FeedEvent[];
  analysis: ImageCheckResponse | null;
  verdict: ImageCheckResponse | null;
  result: CaseResult | null;
  stamp: number;
  done: boolean;
  error: string | null;
}
const runs = new Map<string, LiveRun>();
const subs = new Set<() => void>();
const emit = (id: string, patch: Partial<LiveRun>) => {
  runs.set(id, { ...(runs.get(id) as LiveRun), ...patch });
  subs.forEach((f) => f());
};

/** Board events for a running/finished live run, in the selected language. Router always last. */
export function liveEvents(run: LiveRun, t: Translator): TEvent[] {
  const out: TEvent[] = [];
  run.raw.forEach((e) => {
    const m = mapLiveEvent(e, t);
    if (m) out.push(m);
    if (e.event_type === "PHASE_COMPLETED" && e.phase === "ROUND_2_PROSECUTOR_AUDIT" && e.sub_phase === "INITIAL_AUDIT") out.push(...imageAnalysisEvents(run.analysis, t));
    if (e.event_type === "PHASE_COMPLETED" && e.phase === "JUDGE_DELIBERATION") out.push(...verdictImageEvents(run.verdict, t, run.stamp));
  });
  if (run.result) out.push(routerEvent(run.result, t));
  return out;
}

const IDLE_TIMEOUT_MS = 180_000; // no pipeline event for 3 min → treat as an LLM/backend timeout

/**
 * SSE client for GET /api/disputes/{id}/stream. Unlike api.ts streamPipeline, a failed or dropped
 * connection and the backend's `pipeline_error` event are reported as errors instead of ending silently.
 */
function openStream(id: string, h: { onEvent: (e: PipelineEvent) => void; onComplete: (r: CaseResult | null) => void; onError: () => void }) {
  const es = new EventSource(backendUrl(`/api/disputes/${id}/stream`));
  let finished = false;
  let idle: ReturnType<typeof setTimeout>;
  const end = (fn: () => void) => {
    if (finished) return;
    finished = true;
    clearTimeout(idle);
    es.close();
    fn();
  };
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => end(h.onError), IDLE_TIMEOUT_MS);
  };
  arm();
  es.addEventListener("pipeline_event", (e) => {
    arm();
    try {
      h.onEvent(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore malformed event */
    }
  });
  es.addEventListener("pipeline_complete", (e) =>
    end(() => {
      try {
        h.onComplete(JSON.parse((e as MessageEvent).data).result ?? null);
      } catch {
        h.onComplete(null);
      }
    }),
  );
  es.addEventListener("pipeline_error", () => end(h.onError));
  es.onerror = () => end(h.onError); // closed before pipeline_complete = failure
}

/** Starts the backend pipeline stream once for this case. */
export function startLiveRun(id: string, onDone: (r: CaseResult | null) => void, onError: (msg: string) => void) {
  if (runs.has(id)) return;
  runs.set(id, { raw: [], analysis: null, verdict: null, result: null, stamp: 0, done: false, error: null });
  openStream(id, {
    onEvent: (e) => {
      const fe = e as FeedEvent;
      emit(id, { raw: [...runs.get(id)!.raw, fe] });
      if (fe.event_type === "PHASE_COMPLETED" && fe.phase === "ROUND_2_PROSECUTOR_AUDIT" && fe.sub_phase === "INITIAL_AUDIT")
        getImageCheck(id).then((ic) => emit(id, { analysis: ic }));
      if (fe.event_type === "PHASE_COMPLETED" && fe.phase === "JUDGE_DELIBERATION") getImageCheck(id).then((ic) => emit(id, { verdict: ic, stamp: Date.now() }));
    },
    onComplete: (r) => {
      emit(id, { result: r, done: true });
      onDone(r);
    },
    onError: () => {
      emit(id, { done: true, error: "Live pipeline stream failed" });
      onError("Live pipeline stream failed");
    },
  });
}

export function useLiveRun(id: string | null): LiveRun | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => (id ? runs.get(id) ?? null : null),
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Completed result (other tabs, reloads, verdicts)
// ---------------------------------------------------------------------------

const finished = (r: CaseResult | null) => !!r?.judge_verdict?.execution_payload;

export interface LiveResult {
  id: string;
  result: CaseResult;
  images: ImageCheckResponse | null;
  /** Fetch time — cache-buster for re-rendered verdict images. */
  stamp: number;
}

/** Polls the completed backend result (and its image check) for a live case. */
export function useLiveResult(id: string | null): LiveResult | null {
  const [state, setState] = useState<{ id: string; result: CaseResult | null; images: ImageCheckResponse | null; stamp: number } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const result = await getCompletedResult(id).catch(() => null);
      const images = finished(result) ? await getImageCheck(id) : null;
      if (alive) setState((prev) => ({ id, result, images, stamp: prev?.id === id && prev.images ? prev.stamp : Date.now() }));
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  return state?.id === id && finished(state.result) ? (state as LiveResult) : null;
}

// ---------------------------------------------------------------------------
// Result → board / verdict data
// ---------------------------------------------------------------------------

/** Board events rebuilt from a completed result (reload / other tabs), with the image bubbles in place. */
function eventsFromResult(base: TEvent[], images: ImageCheckResponse | null, t: Translator, stamp: number): TEvent[] {
  const out: TEvent[] = [];
  base.forEach((e) => {
    out.push(e);
    if (e.step === "audit") out.push(...imageAnalysisEvents(images, t));
    if (e.step === "judge") out.push(...verdictImageEvents(images, t, stamp));
  });
  return out;
}

export function liveTribunal(app: AppFixture, live: LiveResult, run: LiveRun | null, t: Translator = tEn): TribunalCase {
  const r = live.result;
  const jv = r.judge_verdict;
  const escalated = r.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW";
  const cleaning = r.case_metadata.dispute_type === "CLEANING_FEE";
  const ex = jv?.explanations;
  const act = jv?.recommended_action;
  const refund = act && (act.action_type === "FULL_REFUND" || act.action_type === "PARTIAL_REFUND") ? act.refund_amount ?? 0 : 0;
  const amount = `S$${refund.toFixed(2)}`;
  // Same live decision, role-specific wording — derived only from the backend's action.
  const decided = {
    passenger: refund > 0 ? t("verdict.refund", { amount }) : act?.action_type === "NO_REFUND" ? t("verdict.noRefund") : enumLabel(t, jv?.ruling_type),
    driver: refund > 0 ? t("verdict.refundIssued", { amount }) : act?.action_type === "NO_REFUND" ? t("verdict.noRefundIssued") : enumLabel(t, jv?.ruling_type),
  };
  const ep = jv?.execution_payload;
  const headline = t(escalated ? "verdict.underReview" : "verdict.caseResolved");
  const base = fromCaseResult(
    r,
    {
      amount: app.claim.amount,
      fraudNote: t("live.fraudNote"),
      learnings: [],
      verdict: {
        passenger: {
          headline,
          big: escalated ? t(cleaning ? "verdict.noFeeCharged" : "verdict.underReview") : decided.passenger,
          body: ex?.explanation_for_rider || t("verdict.reviewed"),
          raw: !!ex?.explanation_for_rider,
        },
        driver: {
          headline,
          big: escalated ? t(cleaning ? "verdict.claimSentToReview" : "verdict.underReview") : decided.driver,
          body: ex?.explanation_for_driver || t("verdict.reviewed"),
          raw: !!ex?.explanation_for_driver,
          note: escalated && cleaning ? t("verdict.noPaymentPending") : undefined,
        },
      },
    },
    t,
  );
  return {
    ...base,
    source: t("live.source", { id: r.case_metadata.case_id }),
    path: cleaning ? t(r.dispute_claim?.image_evidence?.length ? "live.path.evidence" : "live.path.missing") : undefined,
    headline: escalated
      ? t(cleaning ? "live.headline.cleaningEscalated" : "live.headline.escalated")
      : `${decided.passenger} → ${enumLabel(t, r.case_metadata.resolution_channel)}`,
    policyNote: cleaning ? t("policy.pol4Note") : undefined,
    execution: [
      { step: t("exec.judge"), status: t("exec.recommends", { ruling: enumLabel(t, jv?.ruling_type), action: act ? ` · ${enumLabel(t, act.action_type)}` : "" }), tone: "done" },
      { step: t("exec.router"), status: enumLabel(t, r.case_metadata.resolution_channel), tone: "done" },
      cleaning
        ? { step: t("exec.humanPol4"), status: t(escalated ? "exec.pendingReviewer" : "exec.requiredBeforeCharge"), tone: "pending" }
        : { step: t("exec.human"), status: t(escalated ? "exec.pendingReviewer" : "exec.notRequired"), tone: escalated ? "pending" : "none" },
      {
        step: t(cleaning ? "exec.payout" : "exec.execution"),
        status: escalated ? t("exec.noneWhilePending") : `${enumLabel(t, ep?.execution_status)}${ep?.transaction_id ? ` · ${t("pay.demoTxn")} ${ep.transaction_id}` : ""}`,
        tone: escalated ? "none" : "done",
      },
    ],
    // Image checks resolve asynchronously, so keep the Execution Router as the final event.
    events: (run?.raw.length ? liveEvents({ ...run, result: run.result ?? r }, t) : eventsFromResult(base.events, live.images, t, live.stamp)).sort(
      (a, b) => Number(a.step === "router") - Number(b.step === "router"),
    ),
  };
}

/** Board shape while the live stream is still running (no result yet). */
export function pendingTribunal(app: AppFixture, run: LiveRun | null, t: Translator = tEn, locale: Locale = "en"): TribunalCase {
  const f = tribunalFor(app.caseId, true, locale);
  return {
    ...f,
    pending: true,
    source: t("live.sourceRunning"),
    questions: [],
    learnings: [],
    policy: { clauses: [], suggestion: "" },
    policyNote: undefined,
    path: undefined,
    evidence: [],
    verified: [],
    disputed: [],
    missing: [],
    multimodal: undefined,
    judge: null,
    route: null,
    execution: undefined,
    headline: undefined,
    events: run ? liveEvents(run, t) : [],
  };
}

/** Tribunal data for a session in the selected language: the live result when this claim ran on the backend, else the fixture. */
export function useCaseTribunal(app: AppFixture, liveCaseId: string | null, evidenceProvided: boolean, locale: Locale = "en") {
  const live = useLiveResult(liveCaseId);
  const t = translator(locale);
  if (!liveCaseId) return { tc: tribunalFor(app.caseId, evidenceProvided, locale), live: false, ready: true };
  return { tc: live ? liveTribunal(app, live, null, t) : null, live: true, ready: !!live };
}
