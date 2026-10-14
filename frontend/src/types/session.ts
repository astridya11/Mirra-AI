export type Party = "passenger" | "driver";

export type DemoId = "1" | "2" | "3";

export type TripStatus =
  | "idle"
  | "requested"
  | "driver_assigned"
  | "pickup"
  | "en_route"
  | "completed"
  | "cancelled";

export type DisputeStage =
  | "none"
  | "private_support"
  | "formal_filed"
  | "under_review"
  | "resolved";

export type DecisionStatus =
  | "pending"
  | "partial_refund"
  | "no_refund"
  | "human_review";

export interface ChatMessage {
  id: string;
  sender: "user" | "mirra";
  text: string;
  timestamp: number;
}

export interface PrivateChat {
  messages: ChatMessage[];
  suggestions: string[];
  complaintDrafted: boolean;
}

export interface TripInfo {
  pickup: string;
  dropoff: string;
  fare: string;
  eta: string;
  status: TripStatus;
  driverName?: string;
  passengerName?: string;
  vehicle?: string;
  licensePlate?: string;
}

export interface FormalComplaint {
  category: string;
  description: string;
  filedAt: number;
  filedBy: Party;
}

export interface TribunalDecision {
  status: DecisionStatus;
  amount?: string;
  reasoning: string;
  executionRoute: "automated" | "human_review";
}

export interface DemoSession {
  demoId: DemoId;
  sessionId: string;
  stage: DisputeStage;
  tripStatus: TripStatus;
  formalComplaint?: FormalComplaint;
  evidenceFrozen: boolean;
  tribunalStarted: boolean;
  tribunalCompleted: boolean;
  decision?: TribunalDecision;
  trip: TripInfo;
  passengerChat: PrivateChat;
  driverChat: PrivateChat;
  updatedAt: number;
}

export interface PartyView {
  demoId: DemoId;
  sessionId: string;
  stage: DisputeStage;
  tripStatus: TripStatus;
  formalComplaint?: FormalComplaint;
  evidenceFrozen: boolean;
  tribunalStarted: boolean;
  tribunalCompleted: boolean;
  decision?: TribunalDecision;
  trip: TripInfo;
  myChat: PrivateChat;
  otherPartyHasComplaint: boolean;
}
