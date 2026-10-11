/**
 * API client for the Mirra AI dispute resolution backend.
 *
 * SSE streaming is the primary transport for real-time pipeline events.
 * When NEXT_PUBLIC_USE_MOCK=true, falls back to mock data streams.
 */

import type {
  CaseListItem,
  Past30DaysTripListItem,
  CaseResult,
  HumanReviewRequest,
  PartyDecisionRequest,
  PipelineCompleteEvent,
  PipelineEvent,
  RawCaseData,
} from "@/src/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

export interface CreateDisputePayload {
  trip_id: string;
  dispute_type: string;
  dispute_claim_description: string;
  filed_by: string;
  rider_id: string;
  driver_id: string;
  image_evidence?: string[];
  receipt_evidence?: string[];
}

export interface DisputeResponse {
  message: string;
  case_id: string;
  file_path: string;
  data: {
    case_metadata: Record<string, any>;
    dispute_claim: Record<string, any>;
    data_sources: Record<string, any>;
  };
}

export type PriorityTier = "URGENT" | "HIGH_PRIORITY" | "STANDARD";
export type SlaStatus = "ON_TRACK" | "AT_RISK" | "BREACHED" | "RESOLVED";
 
export interface ReviewCase {
  case_id: string;
  priority_level: PriorityTier;
  dispute_type: string;
  confidence_score: number;
  escalation_reasons: string[];
  trip_id: string;
  rider_id: string;
  driver_id: string;
  filed_by: string;
  escalated_at: string;
  dispute_value: number;
  value_source: string; // field name it came from, or "mock"
  priority_score: number;
  status: "OPEN" | "RESOLVED";
  sla_deadline: string;
  sla_total_seconds: number;
  sla_status: SlaStatus;
  seconds_remaining: number;
  resolved_by: string | null;
  resolved_at: string | null;
  support?: { id: string; name: string }; // mock reviewer, only on GET /cases/{id}
}
 
export interface QueueResponse {
  server_time: string;
  support: { id: string; name: string };
  cases: ReviewCase[];
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

/* SLA & Routing Manager */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
 
export const getQueue = () => request<QueueResponse>("/api/review/queue");
export const getNextCase = () => request<{ case_id: string | null }>("/api/review/next");
export const getCase = (id: string) => request<ReviewCase>(`/api/review/cases/${id}`);
export const resolveCase = (id: string) =>
  request<{ case: ReviewCase; next_case_id: string | null }>(
    `/api/review/cases/${id}/resolve`,
    { method: "POST" }
  );
export const resetDemo = () =>
  request<{ ok: boolean }>("/api/review/demo/reset", { method: "POST" });
 
// ---- Human review (existing endpoint) ----
 
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
 
export async function submitHumanReview(caseId: string, payload: HumanReviewRequest) {
  const res = await fetch(`${API_BASE_URL}/api/disputes/${caseId}/human-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.detail;
    throw new ApiError(
      res.status,
      typeof d === "string" ? d : JSON.stringify(d ?? body ?? res.statusText)
    );
  }
  return body;
}
 

/**
 * Creates a new dispute case on the backend.
 * Generates {case_id}.json inside backend/disputes folder.
 */
export async function createDispute(payload: CreateDisputePayload): Promise<DisputeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/create-dispute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || `Failed to create dispute: ${response.statusText}`);
  }

  return response.json();
}

export async function listCases(): Promise<CaseListItem[]> {
  if (USE_MOCK) {
    console.log("MOCK MODE ON: list cases");
    const { mockListCases } = await import("@/src/mock/cases");
    return mockListCases();
  }
  const res = await fetch(`${API_BASE_URL}/api/disputes`);
  if (!res.ok) throw new Error(`Failed to list cases: ${res.status}`);
  return res.json();
}

export async function getCaseResult(id: string): Promise<CaseResult> {
  if (USE_MOCK) {
    const { mockGetCaseResult } = await import("@/src/mock/cases");
    return mockGetCaseResult(id);
  }
  const res = await fetch(`${API_BASE_URL}/api/disputes/${id}`);
  if (!res.ok) throw new Error(`Failed to get case ${id}: ${res.status}`);
  return res.json();
}

export async function getCompletedResult(id: string): Promise<CaseResult | null> {
  if (USE_MOCK) {
    const { mockGetCaseResult } = await import("@/src/mock/cases");
    return mockGetCaseResult(id);
  }
  const res = await fetch(`${API_BASE_URL}/api/disputes/${id}/result`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get completed result: ${res.status}`);
  return res.json();
}

export async function getRawCaseData(id: string): Promise<RawCaseData> {
  const res = await fetch(`${API_BASE_URL}/api/disputes/${id}`);
  if (!res.ok) throw new Error(`Failed to get raw case data: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Image evidence check
// ---------------------------------------------------------------------------

export interface ImageCheckPhotoTime {
  taken_at: string | null;
  seconds_after_trip_end: number | null;
  within_window: boolean | null;
  text: string;
  limit_text: string;
}

export interface ImageCheckPhotoDistance {
  meters: number | null;
  within_radius: boolean | null;
  text: string;
  limit_text: string;
}

export interface ImageCheckItem {
  image_id: string;
  image_url: string;
  verdict_image_url: string | null;
  classification: string | null;
  severity: string | null;
  stain_regions: unknown;
  photo_time: ImageCheckPhotoTime | null;
  photo_distance: ImageCheckPhotoDistance | null;
  recycled: { matched: boolean; prior_case: string | null };
  ai_generated: { flag: boolean | null; confidence: number | null };
  status: "OK" | "FLAGGED" | "INCOMPLETE";
  summary: string;
}

export interface ImageCheckResponse {
  case_id: string;
  has_verdict: boolean;
  images: ImageCheckItem[];
}

/**
 * Build a full backend URL from a relative path (e.g. "/evidence/...").
 */
export function backendUrl(path: string): string {
  return API_BASE_URL + path;
}

/**
 * Fetch the image evidence check for a case.
 * Returns null on any non-200 or network error (never throws).
 */
export async function getImageCheck(id: string): Promise<ImageCheckResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/disputes/${id}/evidence/image-check`);
    if (!res.ok) return null;
    return (await res.json()) as ImageCheckResponse;
  } catch {
    return null;
  }
}

export async function submitPartyDecision(
  id: string,
  decision: PartyDecisionRequest
): Promise<CaseResult> {
  if (USE_MOCK) {
    const { mockSubmitPartyDecision } = await import("@/src/mock/cases");
    return mockSubmitPartyDecision(id, decision);
  }
  const res = await fetch(`${API_BASE_URL}/api/disputes/${id}/party-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (res.status === 404 || res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Cannot submit decision: ${res.status}`);
  }
  if (!res.ok) throw new Error(`Failed to submit party decision: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE Streaming
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onEvent: (event: PipelineEvent) => void;
  onComplete: (result: CaseResult | null) => void;
  onError: (error: Event | string) => void;
}

export function streamPipeline(id: string, callbacks: StreamCallbacks): () => void {
  if (USE_MOCK) {
    console.log("MOCK MODE ON: stream pipeline");
    return streamMockPipeline(id, callbacks);
  }

  const url = `${API_BASE_URL}/api/disputes/${id}/stream`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener("pipeline_event", (e: MessageEvent) => {
    try {
      const event: PipelineEvent = JSON.parse(e.data);
      callbacks.onEvent(event);
    } catch {
      // ignore parse errors
    }
  });

  eventSource.addEventListener("pipeline_complete", (e: MessageEvent) => {
    try {
      const complete: PipelineCompleteEvent = JSON.parse(e.data);
      callbacks.onComplete(complete.result);
    } catch {
      callbacks.onComplete(null);
    }
    eventSource.close();
  });

  eventSource.onerror = (e: Event) => {
    if (eventSource.readyState === EventSource.CLOSED) {
      // Stream ended normally
      return;
    }
    callbacks.onError(e);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

// ---------------------------------------------------------------------------
// Mock SSE streaming (when NEXT_PUBLIC_USE_MOCK=true)
// ---------------------------------------------------------------------------

function streamMockPipeline(id: string, callbacks: StreamCallbacks): () => void {
  let cancelled = false;

  (async () => {
    const { getMockPipelineEvents } = await import("@/src/mock/stream");
    const { mockGetCaseResult } = await import("@/src/mock/cases");

    const events = getMockPipelineEvents(id);

    for (const event of events) {
      if (cancelled) return;
      callbacks.onEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    if (cancelled) return;
    const result = await mockGetCaseResult(id);
    callbacks.onComplete(result);
  })();

  return () => {
    cancelled = true;
  };
}
