export type TribunalAgentRole =
  | "rider_advocate"
  | "driver_advocate"
  | "initial_prosecutor"
  | "cross_examination"
  | "final_prosecutor"
  | "policy_consultant"
  | "ai_judge"
  | "execution_router";

export type TribunalEventType =
  | "statement"
  | "evidence_audit"
  | "targeted_question"
  | "claim_response"
  | "verified_summary"
  | "policy_application"
  | "decision"
  | "execution_route";

export type TribunalEventStatus = "pending" | "active" | "complete";

export interface TribunalEvent {
  id: string;
  role: TribunalAgentRole;
  type: TribunalEventType;
  title: string;
  content: string;
  timestamp: number;
  status: TribunalEventStatus;
}

export interface EvidenceItem {
  id: string;
  label: string;
  category: "verified" | "disputed" | "missing";
  detail?: string;
}

export interface FraudSignal {
  id: string;
  label: string;
  risk: "low" | "medium" | "high";
  detail?: string;
}

export interface TribunalFixture {
  demoId: "1" | "2" | "3";
  caseId: string;
  titleEn: string;
  titleZh: string;
  events: TribunalEvent[];
  evidence: EvidenceItem[];
  fraudSignals?: FraudSignal[];
  policyClause: string;
  policyClauseZh: string;
  judgeConfidence: number;
  executionRoute: "automated" | "human_review";
}
