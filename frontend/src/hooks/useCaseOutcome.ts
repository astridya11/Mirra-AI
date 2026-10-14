"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoId } from "@/src/types/session";
import { applyCaseOutcome } from "@/src/lib/sessionStorage";
import {
  readOutcome,
  runCleaningFeePayment,
  subscribeOutcome,
  type CaseOutcome,
} from "@/src/lib/humanReview";

/**
 * Follow the human-review ledger for one case and mirror it into the demo session.
 * If a reviewed, approved payment is still pending (e.g. the review tab was closed
 * mid-payment), resume it; the ledger lock guarantees a single execution.
 */
export function useCaseOutcome(
  caseRef: string | undefined,
  link?: { demoId: DemoId; sessionId: string }
): { outcome: CaseOutcome | null; sync: () => void } {
  const [outcome, setOutcome] = useState<CaseOutcome | null>(() =>
    caseRef ? readOutcome(caseRef) : null
  );
  const [ownerId] = useState(() => `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const applyRef = useRef<((o: CaseOutcome | null) => void) | null>(null);
  const demoId = link?.demoId;
  const sessionId = link?.sessionId;

  useEffect(() => {
    if (!caseRef) return;
    let alive = true;
    const apply = (o: CaseOutcome | null) => {
      if (!alive) return;
      setOutcome(o);
      if (!o) return;
      if (demoId && sessionId) applyCaseOutcome(demoId, sessionId, o);
      if (o.paymentStatus === "pending") {
        // If another tab holds the lock, its result arrives through the subscription.
        void runCleaningFeePayment(caseRef, ownerId).then((next) => {
          if (next && next.paymentStatus !== "pending") apply(next);
        });
      }
    };
    applyRef.current = apply;
    apply(readOutcome(caseRef));
    const unsub = subscribeOutcome(caseRef, apply);
    // Stale-lock recovery: re-check while a payment is still pending.
    const timer = setInterval(() => {
      const o = readOutcome(caseRef);
      if (o?.paymentStatus === "pending") apply(o);
    }, 5000);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
    };
  }, [caseRef, ownerId, demoId, sessionId]);

  const sync = useCallback(() => {
    if (caseRef) applyRef.current?.(readOutcome(caseRef));
  }, [caseRef]);

  return { outcome: caseRef ? outcome : null, sync };
}
