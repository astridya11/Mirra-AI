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

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

export async function listPast30DaysTrips(party_id: string): Promise<Past30DaysTripListItem> {
  const res = await fetch(`${API_BASE_URL}/api/v1/30-days-trips/${party_id}`);
  if (!res.ok) throw new Error(`Failed to list past 30 days trips: ${res.status}`);
  return res.json();
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

export async function submitHumanReview(
  id: string,
  review: HumanReviewRequest
): Promise<CaseResult> {
  if (USE_MOCK) {
    const { mockSubmitHumanReview } = await import("@/src/mock/cases");
    return mockSubmitHumanReview(id, review);
  }
  const res = await fetch(`${API_BASE_URL}/api/disputes/${id}/human-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(review),
  });
  if (!res.ok) throw new Error(`Failed to submit human review: ${res.status}`);
  return res.json();
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
