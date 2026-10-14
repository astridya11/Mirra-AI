import type { PipelineEvent, CaseResult } from "@/src/types";
import type {
  TribunalEvent,
  TribunalEventType,
  TribunalAgentRole,
  EvidenceItem,
  FraudSignal,
  TribunalFixture,
} from "@/src/types/tribunal";

// ── Speaker → Role mapping ──
const SPEAKER_ROLE_MAP: Record<string, TribunalAgentRole> = {
  RIDER_ADVOCATE: "rider_advocate",
  DRIVER_ADVOCATE: "driver_advocate",
  PROSECUTOR: "cross_examination",
};

// ── Event type mapping ──
function mapEventType(
  event: PipelineEvent
): { role: TribunalAgentRole; type: TribunalEventType } | null {
  const et = event.event_type;
  const phase = event.phase;
  const speaker = event.speaker;
  const messageType = event.message_type;
  const subPhase = (event as { sub_phase?: string }).sub_phase;

  if (et === "AGENT_CONVERSATION" && speaker) {
    const role = SPEAKER_ROLE_MAP[speaker];
    if (!role) return null;

    if (messageType === "STATEMENT") {
      return { role, type: "statement" };
    }
    if (messageType === "QUESTION") {
      return { role: "cross_examination", type: "targeted_question" };
    }
    if (messageType === "RESPONSE") {
      return { role, type: "claim_response" };
    }
    return null;
  }

  if (et === "PHASE_COMPLETED" && phase) {
    if (phase === "ROUND_2_PROSECUTOR_AUDIT" && subPhase === "INITIAL_AUDIT") {
      return { role: "initial_prosecutor", type: "evidence_audit" };
    }
    if (phase === "ROUND_2_PROSECUTOR_AUDIT" && subPhase === "FINAL_REPORT") {
      return { role: "final_prosecutor", type: "verified_summary" };
    }
    if (phase === "POLICY_CONSULTATION") {
      return { role: "policy_consultant", type: "policy_application" };
    }
    if (phase === "JUDGE_DELIBERATION") {
      return { role: "ai_judge", type: "decision" };
    }
    if (phase === "EXECUTION_ROUTER") {
      return { role: "execution_router", type: "execution_route" };
    }
  }

  return null;
}

function extractContent(event: PipelineEvent): string {
  const d = event.data as Record<string, unknown>;

  // Agent conversation content
  if (typeof d.content === "string") return d.content;

  // Prosecutor findings summary
  if (typeof d.prosecutor_summary === "string") return d.prosecutor_summary;
  const pf = d.prosecutor_findings as Record<string, unknown> | undefined;
  if (pf && typeof pf.prosecutor_summary === "string") return pf.prosecutor_summary;

  // Policy suggestion rationale
  const pol = d.suggestion as Record<string, unknown> | undefined;
  if (pol && typeof pol.rationale === "string") return pol.rationale;

  // Judge verdict reasoning
  const jv = d as Record<string, unknown>;
  if (typeof jv.reasoning_summary === "string") return jv.reasoning_summary;

  // Execution router
  if (typeof d.route === "string") {
    const route = d.route as string;
    // A missing / failed Judge confidence is "unavailable", never 0%.
    const confidence =
      typeof d.confidence_score === "number" ? `${(d.confidence_score * 100).toFixed(0)}%` : "unavailable";
    const reasons = Array.isArray(d.escalation_reasons)
      ? (d.escalation_reasons as string[]).join("; ")
      : "";
    return `Route: ${route}. Confidence: ${confidence}. ${reasons}`.trim();
  }

  // Fallback: use label
  return event.label || `${event.phase} ${event.event_type || ""}`;
}

export function mapPipelineEventToTribunalEvent(
  event: PipelineEvent,
  index: number
): TribunalEvent | null {
  const mapped = mapEventType(event);
  if (!mapped) return null;

  return {
    id: `live-${index}`,
    role: mapped.role,
    type: mapped.type,
    title: event.label || mapped.type,
    content: extractContent(event),
    timestamp: Date.parse(event.timestamp) || Date.now(),
    status: "complete",
  };
}

/**
 * Rebuild the tribunal feed from a stored CaseResult (page refresh / return from the
 * review page). The backend SSE endpoint re-runs the pipeline on every connection,
 * so a completed case is restored from its result instead of being streamed again.
 */
export function eventsFromCaseResult(result: CaseResult): TribunalEvent[] {
  const ts = result.judge_verdict?.deliberated_at ?? "";
  const pe: PipelineEvent[] = (result.agent_conversation ?? []).map((m) => ({
    phase: "AGENT_CONVERSATION",
    label: "",
    data: { content: m.content },
    timestamp: m.timestamp ?? ts,
    event_type: "AGENT_CONVERSATION",
    speaker: m.speaker,
    message_type: m.message_type,
  }));
  const phase = (p: string, data: unknown, label: string, sub?: string): PipelineEvent =>
    ({ phase: p, label, data: (data ?? {}) as Record<string, unknown>, timestamp: ts, event_type: "PHASE_COMPLETED", ...(sub ? { sub_phase: sub } : {}) }) as PipelineEvent;
  if (result.prosecutor_findings) {
    pe.push(phase("ROUND_2_PROSECUTOR_AUDIT", { prosecutor_findings: result.prosecutor_findings }, "Final prosecutor report", "FINAL_REPORT"));
  }
  if (result.policy_consultation) pe.push(phase("POLICY_CONSULTATION", result.policy_consultation, "Policy consultation"));
  if (result.judge_verdict) pe.push(phase("JUDGE_DELIBERATION", result.judge_verdict, "Judge verdict"));
  if (result.judge_verdict) {
    pe.push(
      phase(
        "EXECUTION_ROUTER",
        {
          route: result.case_metadata?.resolution_channel,
          confidence_score: result.judge_verdict.confidence_score,
          escalation_reasons: result.bonus_modules?.escalation_protocol?.escalation_reasons,
        },
        "Execution router"
      )
    );
  }
  return pe
    .map((e, i) => mapPipelineEventToTribunalEvent(e, i))
    .filter((e): e is TribunalEvent => e !== null)
    .map((e, i) => ({ ...e, id: `restored-${i}` }));
}

export function buildEvidenceFromCaseResult(result: CaseResult): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const findings = result.prosecutor_findings;
  if (!findings) return items;

  findings.verified_facts?.forEach((f) => {
    items.push({
      id: f.fact_id,
      label: f.description,
      category: "verified",
      detail: f.supporting_evidence?.map((e) => e.description).join("; ") || undefined,
    });
  });

  findings.disputed_facts?.forEach((f) => {
    items.push({
      id: f.fact_id,
      label: f.description,
      category: "disputed",
      detail: f.supporting_evidence?.map((e) => e.description).join("; ") || undefined,
    });
  });

  findings.missing_facts?.forEach((f) => {
    items.push({
      id: f.fact_id,
      label: f.description,
      category: "missing",
      detail: f.supporting_evidence?.map((e) => e.description).join("; ") || undefined,
    });
  });

  return items;
}

export function buildFraudSignalsFromCaseResult(result: CaseResult): FraudSignal[] {
  const signals: FraudSignal[] = [];
  const fraud = result.bonus_modules?.fraud_assessment;
  if (!fraud) return signals;

  const risk = fraud.fraud_risk_score;
  const riskLabel: "low" | "medium" | "high" =
    risk >= 0.7 ? "high" : risk >= 0.4 ? "medium" : "low";

  signals.push({
    id: "fraud-risk",
    label: `Fraud risk score: ${(risk * 100).toFixed(0)}%`,
    risk: riskLabel,
    detail: fraud.risk_factors?.join("; ") || undefined,
  });

  if (fraud.abuse_pattern_detected) {
    signals.push({
      id: "abuse-pattern",
      label: fraud.abuse_pattern_description || "Abuse pattern detected",
      risk: riskLabel,
    });
  }

  return signals;
}

export function buildTribunalFixtureFromCaseResult(
  result: CaseResult,
  events: TribunalEvent[]
): TribunalFixture {
  const meta = result.case_metadata;
  const verdict = result.judge_verdict;
  const channel = meta.resolution_channel;

  let executionRoute: "automated" | "human_review" = "automated";
  if (channel === "ESCALATED_HUMAN_REVIEW") executionRoute = "human_review";
  if (verdict?.execution_payload?.execution_status === "PENDING_HUMAN_APPROVAL") {
    executionRoute = "human_review";
  }

  const policy = result.policy_consultation?.suggestion;
  const policyClause =
    policy?.applicable_clauses?.[0]?.clause_text_summary ||
    policy?.rationale ||
    "Policy consultation completed.";

  return {
    demoId: "1",
    caseId: meta.case_id,
    titleEn: meta.dispute_type.replace(/_/g, " "),
    titleZh: meta.dispute_type.replace(/_/g, " "),
    events,
    evidence: buildEvidenceFromCaseResult(result),
    fraudSignals: buildFraudSignalsFromCaseResult(result),
    policyClause,
    policyClauseZh: policyClause,
    judgeConfidence: verdict?.confidence_score ?? 0,
    executionRoute,
  };
}

export function mapCaseResultToTribunalDecision(
  result: CaseResult
): {
  status: "partial_refund" | "no_refund" | "human_review" | "incomplete";
  amount?: string;
  reasoning: string;
  executionRoute: "automated" | "human_review";
  explanationForRider: string;
  explanationForDriver: string;
} {
  const verdict = result.judge_verdict;
  const meta = result.case_metadata;
  const payload = verdict?.execution_payload;

  // C. Missing/incomplete/failed Judge result → NO DECISION
  if (!verdict || !verdict.ruling_type) {
    return {
      status: "incomplete",
      reasoning: "Judge result unavailable or incomplete.",
      executionRoute: "human_review",
      explanationForRider: "The tribunal could not reach a decision. A human review will be arranged.",
      explanationForDriver: "The tribunal could not reach a decision. A human review will be arranged.",
    };
  }

  const ruling = verdict.ruling_type;
  const channel = meta.resolution_channel;

  let status: "partial_refund" | "no_refund" | "human_review" | "incomplete" = "no_refund";
  if (ruling === "PARTIAL_REFUND" || ruling === "APPROVED") status = "partial_refund";
  else if (ruling === "ESCALATED") status = "human_review";

  const executionRoute: "automated" | "human_review" =
    channel === "ESCALATED_HUMAN_REVIEW" || payload?.execution_status === "PENDING_HUMAN_APPROVAL"
      ? "human_review"
      : "automated";

  const refundAmount = verdict.recommended_action?.refund_amount;
  const amount =
    refundAmount && refundAmount > 0 ? `S$${refundAmount.toFixed(2)}` : undefined;

  return {
    status,
    amount,
    reasoning: verdict.reasoning_summary || "Decision rendered.",
    executionRoute,
    explanationForRider: verdict.explanations?.explanation_for_rider || "",
    explanationForDriver: verdict.explanations?.explanation_for_driver || "",
  };
}
