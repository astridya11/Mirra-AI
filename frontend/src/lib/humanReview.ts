import type { HumanReviewDecision } from "@/src/types";
import { mockRydePayCleaningFee } from "@/src/lib/api";
import type { DemoSession, Party, PaymentStatus } from "@/src/types/session";

/**
 * Human-review outcome ledger, keyed by case (live case id or demo review ref).
 *
 * One record per reviewed case. It is the single source of truth for:
 *   - the human decision (written only after the review succeeds), and
 *   - the simulated Cleaning Fee payment (status, transaction id, execution lock).
 *
 * The record lives in localStorage so every tab (Guided Demo, party apps,
 * review page) sees the same decision and payment. The execution lock makes
 * the mock payment endpoint run at most once per reviewed decision, across
 * double clicks, re-renders, refreshes and multiple tabs.
 */

export interface CaseOutcome {
  caseRef: string;
  mode: "live" | "demo";
  decision: HumanReviewDecision;
  /** Final cleaning fee in SGD; null when the claim was rejected. */
  amount: number | null;
  reviewedAt: number;
  riderId?: string;
  driverId?: string;
  paymentStatus: PaymentStatus;
  txnId?: string;
  paymentLock?: { ownerId: string; startedAt: number };
}

const PREFIX = "mirra.caseOutcome.v1.";
const BC_CHANNEL = "mirra-case-outcome";
const PAYMENT_LOCK_TIMEOUT_MS = 20_000;
/** Cases this tab is currently paying for (guards same-tab re-entry). */
const inFlight = new Set<string>();

/** Demo-mode review reference (never a backend case id). */
export function demoReviewRef(sessionId: string): string {
  return `DEMO-REVIEW-${sessionId}`;
}

export function isDemoReviewRef(caseRef: string): boolean {
  return caseRef.startsWith("DEMO-REVIEW-");
}

export function isApproved(decision: HumanReviewDecision): boolean {
  return decision !== "REJECTED_AUTO";
}

export function readOutcome(caseRef: string): CaseOutcome | null {
  if (typeof window === "undefined" || !caseRef) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + caseRef);
    return raw ? (JSON.parse(raw) as CaseOutcome) : null;
  } catch {
    return null;
  }
}

function writeOutcome(o: CaseOutcome): void {
  try {
    window.localStorage.setItem(PREFIX + o.caseRef, JSON.stringify(o));
  } catch {
    // storage full or disabled
  }
  try {
    const bc = new BroadcastChannel(BC_CHANNEL);
    bc.postMessage({ caseRef: o.caseRef });
    bc.close();
  } catch {
    // BroadcastChannel unavailable: the storage event still reaches other tabs
  }
}

export function clearOutcome(caseRef: string): void {
  if (typeof window === "undefined" || !caseRef) return;
  try {
    window.localStorage.removeItem(PREFIX + caseRef);
  } catch {
    // ignore
  }
}

/**
 * Record a successful human review. The first recorded decision wins: a second
 * tab or a retried submit cannot change the decision or reset the payment.
 */
export function recordReview(
  caseRef: string,
  input: {
    mode: "live" | "demo";
    decision: HumanReviewDecision;
    amount: number | null;
    riderId?: string;
    driverId?: string;
  }
): CaseOutcome {
  const existing = readOutcome(caseRef);
  if (existing) return existing;
  const approved = isApproved(input.decision) && (input.amount ?? 0) > 0;
  const outcome: CaseOutcome = {
    caseRef,
    mode: input.mode,
    decision: input.decision,
    amount: isApproved(input.decision) ? input.amount : null,
    reviewedAt: Date.now(),
    riderId: input.riderId,
    driverId: input.driverId,
    paymentStatus: approved ? "pending" : "not_required",
  };
  writeOutcome(outcome);
  return outcome;
}

/**
 * Run the simulated Cleaning Fee payment for a reviewed, approved case at most once.
 * Returns the latest outcome. Does nothing when no review is recorded, the payment
 * is already completed / failed / not required, or another owner holds a fresh lock.
 * A lock older than PAYMENT_LOCK_TIMEOUT_MS (tab closed mid-payment) can be reclaimed.
 */
export async function executePayment(
  caseRef: string,
  ownerId: string,
  pay: (o: CaseOutcome) => Promise<string>
): Promise<CaseOutcome | null> {
  // This tab is already paying for this case (re-render / broadcast echo): never re-enter.
  if (inFlight.has(caseRef)) return readOutcome(caseRef);
  const latest = readOutcome(caseRef);
  if (!latest || latest.paymentStatus !== "pending" || latest.txnId) return latest;
  // Any fresh lock, including one this owner wrote, means an attempt is in progress.
  const lock = latest.paymentLock;
  if (lock && Date.now() - lock.startedAt < PAYMENT_LOCK_TIMEOUT_MS) return latest;

  inFlight.add(caseRef);
  try {
    writeOutcome({ ...latest, paymentLock: { ownerId, startedAt: Date.now() } });
    // Re-read: if another tab claimed in the same instant, the last writer owns the lock.
    if (readOutcome(caseRef)?.paymentLock?.ownerId !== ownerId) return readOutcome(caseRef);

    let next: CaseOutcome;
    try {
      const txnId = await pay(latest);
      next = { ...latest, paymentStatus: "completed", txnId, paymentLock: undefined };
    } catch {
      next = { ...latest, paymentStatus: "failed", paymentLock: undefined };
    }
    writeOutcome(next);
    return next;
  } finally {
    inFlight.delete(caseRef);
  }
}

/**
 * Simulated Ryde payment for an approved cleaning fee, run under the ledger lock.
 * LIVE cases call POST /api/mock-ryde-pay/cleaning-fee with the human-final amount;
 * DEMO references stay offline and get a clearly labelled local demo transaction id.
 */
export function runCleaningFeePayment(caseRef: string, ownerId: string): Promise<CaseOutcome | null> {
  return executePayment(caseRef, ownerId, async (o) => {
    if (o.mode === "demo") {
      await new Promise((r) => setTimeout(r, 600));
      return `DEMO-TXN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    }
    const res = await mockRydePayCleaningFee({
      amount: o.amount ?? 0,
      case_id: o.caseRef,
      rider_id: o.riderId,
      driver_id: o.driverId,
    });
    return res.transaction_id;
  });
}

/** Allow one more attempt after a failed simulated payment. */
export function markPaymentRetry(caseRef: string): CaseOutcome | null {
  const latest = readOutcome(caseRef);
  if (!latest || latest.paymentStatus !== "failed") return latest;
  const next: CaseOutcome = { ...latest, paymentStatus: "pending", paymentLock: undefined };
  writeOutcome(next);
  return next;
}

export function subscribeOutcome(caseRef: string, listener: (o: CaseOutcome | null) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFIX + caseRef) listener(readOutcome(caseRef));
  };
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(BC_CHANNEL);
    bc.onmessage = (e) => {
      if (e.data?.caseRef === caseRef) listener(readOutcome(caseRef));
    };
  } catch {
    bc = null;
  }
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    bc?.close();
  };
}

const money = (n: number) => `S$${n % 1 === 0 ? n : n.toFixed(2)}`;
export const formatSgd = money;

/**
 * Party-facing final result after human review. Both parties derive their text
 * from the same recorded decision; no fraud scores or reviewer notes are exposed.
 */
export function partyFinalResult(
  hr: NonNullable<DemoSession["humanReview"]>,
  party: Party,
  locale: "en" | "zh"
): { title: string; body: string; approved: boolean } {
  const zh = locale === "zh";
  if (hr.decision === "REJECTED_AUTO" || hr.amount == null || hr.amount <= 0) {
    return party === "passenger"
      ? {
          approved: false,
          title: zh ? "不收取清洁费" : "No cleaning fee will be charged.",
          body: zh ? "人工审核后，清洁费索赔未获批准。" : "The cleaning fee claim was not approved after human review.",
        }
      : {
          approved: false,
          title: zh ? "您的清洁费索赔未获批准。" : "Your cleaning fee claim was not approved.",
          body: zh ? "人工审核后不发放款项。" : "No payout after human review.",
        };
  }
  const amt = money(hr.amount);
  return {
    approved: true,
    title: zh ? `人工审核后已批准 ${amt} 清洁费。` : `A ${amt} cleaning fee was approved after human review.`,
    body:
      party === "passenger"
        ? zh
          ? "该费用将通过 Ryde 支付扣取（模拟）。"
          : "The fee is charged through Ryde Pay (simulated)."
        : zh
        ? "该款项将通过 Ryde 支付发放给您（模拟）。"
        : "The amount is paid out to you through Ryde Pay (simulated).",
  };
}
