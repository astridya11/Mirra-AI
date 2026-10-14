import type { DemoId, DemoSession } from "@/src/types/session";
import { demoReviewRef } from "./humanReview";
import { getFixtureByDemoId } from "./tribunalFixtures";

/** Every demo page for one session shares these links (same demoId + sessionId). */
export const partyHref = (demoId: DemoId, party: "passenger" | "driver", sessionId: string) =>
  `/demo/${demoId}/${party}?session=${encodeURIComponent(sessionId)}`;

export const guidedHref = (demoId: DemoId, sessionId: string) =>
  `/demo/${demoId}/guided?session=${encodeURIComponent(sessionId)}`;

/**
 * Internal Console target. A LIVE session links to its real case; before a live case exists
 * in LIVE mode there is nothing to observe yet. DEMO MODE uses the fixture observer view.
 */
export function consoleTarget(
  demoId: DemoId,
  session: DemoSession | null,
  mode: "live" | "demo"
): { href: string | null; kind: "live" | "fixture" | "pending" } {
  if (session?.liveCaseId) return { href: `/internal/${encodeURIComponent(session.liveCaseId)}`, kind: "live" };
  if (mode === "live") return { href: null, kind: "pending" };
  const fixture = getFixtureByDemoId(demoId);
  return fixture ? { href: `/internal/${fixture.caseId}`, kind: "fixture" } : { href: null, kind: "pending" };
}

/**
 * Human Review target for a Demo 3 session whose tribunal routed to human review:
 * the real review page for a LIVE case (linked back to this session), otherwise the
 * offline DEMO MODE review reference. Null while no human review is required.
 */
export function humanReviewHref(demoId: DemoId, sessionId: string, session: DemoSession | null): string | null {
  if (demoId !== "3" || !session?.tribunalCompleted || session.decision?.executionRoute !== "human_review") return null;
  return session.liveCaseId
    ? `/review/${encodeURIComponent(session.liveCaseId)}?demo=${demoId}&session=${encodeURIComponent(sessionId)}`
    : `/review/${encodeURIComponent(demoReviewRef(sessionId))}`;
}
