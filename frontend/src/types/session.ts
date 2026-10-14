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

export interface DemoSession {
  demoId: DemoId;
  sessionId: string;
  stage: DisputeStage;
  tripStatus: TripStatus;
  formalComplaint?: FormalComplaint;
  evidenceFrozen: boolean;
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
  trip: TripInfo;
  myChat: PrivateChat;
  otherPartyHasComplaint: boolean;
}
