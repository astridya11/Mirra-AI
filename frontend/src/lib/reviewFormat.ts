/**
 * Formatting helpers for the review console.
 *
 * Design spec:
 * - Money is always "SGD 30.00".
 * - Confidence is always "62%".
 * - Enum values are never shown raw ("HIGH_PRIORITY" -> "High priority").
 * - Sentence case everywhere.
 */

export const CURRENCY = "SGD";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Format a number as "SGD 30.00". Returns "—" for null/undefined/NaN.
 */
export function formatMoney(n: unknown): string {
  const num = Number(n);
  if (n == null || Number.isNaN(num)) return "—";
  return `${CURRENCY} ${num.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Percent
// ---------------------------------------------------------------------------

/**
 * Format a confidence value as "62%".
 * Accepts 0–1 (e.g. 0.62 -> "62%"); values > 1 are treated as already a
 * percent (e.g. 62 -> "62%").
 */
export function formatPercent(x: unknown): string {
  const num = Number(x);
  if (x == null || Number.isNaN(num)) return "—";
  const pct = num > 1 ? num : num * 100;
  return `${Math.round(pct)}%`;
}

// ---------------------------------------------------------------------------
// Enum humanizing
// ---------------------------------------------------------------------------

/**
 * Turn an SCREAMING_SNAKE_CASE enum into "Sentence case".
 * e.g. "CLEANING_FEE" -> "Cleaning fee", "HIGH_PRIORITY" -> "High priority".
 */
export function humanizeEnum(value: unknown): string {
  if (value == null || value === "") return "—";
  const s = String(value);
  // If it's already mixed/lower case, just capitalize the first letter.
  if (!s.includes("_") && /[a-z]/.test(s)) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const words = s.toLowerCase().split("_");
  const result = words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  return result || "—";
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

export const disputeTypeLabel = (v: unknown): string => {
  const s = String(v ?? "");
  const map: Record<string, string> = {
    ROUTE_DEVIATION: "Route deviation",
    CLEANING_FEE: "Cleaning fee",
    NO_SHOW_CHARGE: "No-show charge",
    SAFETY_ALERT: "Safety alert",
    UNSAFE_DRIVING: "Unsafe driving",
    HARASSMENT: "Harassment",
    VEHICLE_ACCIDENT: "Vehicle accident",
    PASSENGER_CONDUCT: "Passenger conduct",
    FARE_DISPUTE: "Fare dispute",
    LOST_ITEM: "Lost item",
    DAMAGE: "Damage",
  };
  return map[s] || humanizeEnum(s);
};

export const rulingLabel = (v: unknown): string => {
  const s = String(v ?? "");
  const map: Record<string, string> = {
    APPROVED: "Approved",
    FULL_REFUND: "Full refund",
    PARTIAL_REFUND: "Partial refund",
    REJECTED: "Rejected",
    ESCALATED: "Escalated",
  };
  return map[s] || humanizeEnum(s);
};

export const actionLabel = (v: unknown): string => {
  const s = String(v ?? "");
  const map: Record<string, string> = {
    FULL_REFUND: "Full refund",
    PARTIAL_REFUND: "Partial refund",
    NO_REFUND: "No refund",
    CLEANING_FEE_CHARGE: "Cleaning fee charge",
    PENALTY_ONLY: "Penalty only",
    ESCALATED_NO_ACTION: "Escalated, no action",
  };
  return map[s] || humanizeEnum(s);
};

export const priorityLabel = (v: unknown): string => {
  const s = String(v ?? "");
  const map: Record<string, string> = {
    URGENT: "Urgent",
    HIGH_PRIORITY: "High priority",
    STANDARD: "Standard",
  };
  return map[s] || humanizeEnum(s);
};

// ---------------------------------------------------------------------------
// describeAction — one plain sentence for the recommended action
// ---------------------------------------------------------------------------

export function describeAction(action: Record<string, any> | null | undefined): string {
  if (!action || typeof action !== "object") {
    return "No automatic action — a human decision is needed";
  }

  const type = String(action.action_type ?? "").trim();
  const refund = Number(action.refund_amount ?? 0);
  const cleaning = Number(action.cleaning_fee_amount ?? 0);
  const penaltyTarget = action.penalty_target
    ? humanizeEnum(action.penalty_target)
    : "rider";

  let sentence: string;

  switch (type) {
    case "CLEANING_FEE_CHARGE":
      sentence = `Charge the rider ${formatMoney(cleaning || undefined)} cleaning fee`;
      break;
    case "FULL_REFUND":
    case "PARTIAL_REFUND":
      sentence = `Refund the rider ${formatMoney(refund || undefined)}`;
      break;
    case "NO_REFUND":
      sentence = "No refund";
      break;
    case "PENALTY_ONLY":
      sentence = `Apply a penalty to the ${penaltyTarget}`;
      break;
    case "ESCALATED_NO_ACTION":
    case "":
      sentence = "No automatic action — a human decision is needed";
      break;
    default:
      sentence = humanizeEnum(type);
      break;
  }

  const acct = String(action.account_action ?? "").trim();
  if (acct && acct !== "NONE") {
    sentence += `; ${humanizeEnum(acct)}`;
  }

  return sentence;
}
