/**
 * Type definitions derived from shared/types.ts and backend schemas.
 * These mirror the exact field names from the backend pipeline.
 */

export type DisputeType = 
  | "LOST_ITEM"
  | "REFUND_REQUEST"
  | "DRIVER_RATING"
  | "PAYMENT_FAILED"
  | "CANCELLED_BOOKING"
  | "NO_SHOW_CHARGE"
  | "CLEANING_FEE"
  | "TOLL_REIMBURSEMENT"
  | "PASSENGER_CONDUCT"
  | "UNSAFE_DRIVING"
  | "SAFETY_ALERT"
  | "HARASSMENT"
  | "VEHICLE_ACCIDENT"
  | "ROUTE_DEVIATION"
  | "SURGE_PRICING"
  | "FARE_DISPUTE"
  | "PAYOUT_DELAY"
  | "BONUS_INCENTIVE"
  | "SUBSCRIPTION_BILLING"
  | "CASHBACK_PROMO"
  | "ACCOUNT_PRIVACY"
  | "VEHICLE_DOCUMENTATION"
  | "DISPUTE_ESCALATION";

export type PipelineState =
  | "INIT_CLAIM"
  | "ROUND_1_PLEADINGS"
  | "ROUND_2_PROSECUTOR_AUDIT"
  | "POLICY_CONSULTATION"
  | "JUDGE_DELIBERATION"
  | "EXECUTION_ROUTER";

export type ResolutionChannel = "FULLY_AUTOMATED" | "ESCALATED_HUMAN_REVIEW";

export type RulingType = "APPROVED" | "PARTIAL_REFUND" | "REJECTED" | "ESCALATED";

export type ActionType =
  | "FULL_REFUND"
  | "PARTIAL_REFUND"
  | "CLEANING_FEE_CHARGE"
  | "NO_REFUND"
  | "PENALTY_ONLY"
  | "ESCALATED_NO_ACTION";

export type ExecutionStatus =
  | "AUTO_EXECUTED"
  | "PENDING_HUMAN_APPROVAL"
  | "HUMAN_CONFIRMED"
  | "HUMAN_OVERRIDDEN";

export type CaseFinalStatus = "AUTO_RESOLVED" | "HUMAN_RESOLVED" | "HUMAN_OVERRIDDEN" | "PENDING";

export type HumanReviewDecision = "CONFIRMED_AUTO" | "MODIFIED" | "OVERRIDDEN" | "REJECTED_AUTO";

// ---------------------------------------------------------------------------
// Case Metadata
// ---------------------------------------------------------------------------

export interface CaseMetadata {
  case_id: string;
  dispute_type: DisputeType;
  dispute_claim_description: string;
  current_state: PipelineState;
  current_round: 1 | 2;
  resolution_channel: ResolutionChannel;
  trip_id?: string;
  rider_id?: string;
  driver_id?: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

export interface GPSCoordinate {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed_kmh?: number;
  status?: "en_route" | "arrived" | "waiting" | "cancelled" | "completed";
}

export interface TripData {
  trip_id: string;
  rider_id?: string;
  driver_id?: string;
  pickup_location: { name: string; lat: number; lng: number };
  dropoff_location: { name: string; lat: number; lng: number };
  scheduled_time?: string;
  driver_arrival_time?: string;
  driver_wait_start?: string;
  cancellation_time?: string;
  cancellation_fee?: number;
  cancellation_reason?: string;
  /**
   * Time the trip was completed (drop-off). Used by POL-4 for the photo time window.
   */
  trip_end_time?: string;
}

export interface AppEvent {
  timestamp: string;
  event_type: string;
  details: string;
}

export interface ChatMessage {
  message_id: string;
  sender: string;
  content: string;
  timestamp: string;
  sentiment_score?: number;
  type?: string;
  safety_threat_keywords?: string[];
}

export interface ChatCommunication {
  transcript: ChatMessage[];
  overall_sentiment_score: number;
  safety_threat_keywords_detected: boolean;
}

export interface FareBreakdown {
  base_fare: number;
  distance_fare: number;
  time_fare: number;
  surge_multiplier?: number;
  total_fare: number;
  currency: string;
}

export interface PaymentFareData {
  original_fare: FareBreakdown;
  disputed_amount: number;
  disputed_amount_currency: string;
  payment_method?: string;
}

export interface HistoricalProfile {
  party: string;
  party_id?: string;
  name?: string;
  account_age_days?: number;
  total_trips?: number;
  avg_rating?: number;
  risk_score: number;
  dispute_history_30d: number;
  dispute_history_90d: number;
  bad_faith_flag: boolean;
  bad_faith_reason?: string;
}

/**
 * Contains details of the initial dispute claim submitted by a party, including any attached image or receipt evidence.
 */
export interface DisputeClaim {
  /**
   * Unique identifier for the dispute case.
   */
  case_id: string;
  /**
   * Reference identifier for the trip associated with this dispute claim.
   */
  trip_id: string;
  /**
   * Category of the dispute claim.
   */
  dispute_type: DisputeType;
  /**
   * Description of the dispute claim submitted by the party.
   */
  description: string;
  /**
   * Party who filed the dispute claim.
   */
  filed_by: "RIDER" | "DRIVER";
  /**
   * ISO 8601 timestamp of when the dispute claim was filed.
   */
  filed_at: string;
  /**
   * Optional structured image evidence submitted for this case. Omitted or empty when no images are available.
   *
   * @minItems 0
   */
  image_evidence?: ImageEvidenceInput[];
  /**
   * Optional cleaning receipts submitted for this case. Omitted or empty when no receipt is available.
   *
   * @minItems 0
   */
  receipt_evidence?: ReceiptEvidenceInput[];
}
/**
 * A single image submitted as evidence.  The presence of this object does not guarantee that an ExifAnalysis can be emitted; required EXIF or provider fields may still be missing.
 */
export interface ImageEvidenceInput {
  /**
   * Unique identifier for the submitted image (e.g., 'IMG-001').
   */
  image_id: string;
  /**
   * URL or storage path to the image.
   */
  image_url: string;
  /**
   * EXIF-embedded timestamp of when the photo was taken, normalized to ISO-8601 by the provider adapter.
   */
  exif_timestamp?: string;
  exif_gps_location?: ImageExifGpsLocation;
  provider_result?: ProviderImageResult;
  /**
   * Perceptual or cryptographic hash of the image for recycled-image detection.
   */
  image_hash?: string;
  /**
   * Optional corpus mapping image_hash to a prior case_id for recycled-image comparison.
   */
  known_matches?: {
    [k: string]: string;
  };
}
/**
 * GPS coordinates extracted from image EXIF metadata.  Unlike GPSCoordinate, this does not require a timestamp.
 */
export interface ImageExifGpsLocation {
  /**
   * Latitude in decimal degrees.
   */
  latitude: number;
  /**
   * Longitude in decimal degrees.
   */
  longitude: number;
}
/**
 * Visual-analysis output from an actual model / vision provider.  These fields are NEVER inferred from chat text or trip data.
 */
export interface ProviderImageResult {
  /**
   * Whether the image is detected as AI-generated (synthetic/fabricated).
   */
  is_ai_generated: boolean;
  /**
   * Confidence score (0.0-1.0) for the AI-generated detection result.
   */
  ai_generated_confidence: number;
  /**
   * Classification of the stain or damage type detected in the image.
   */
  stain_damage_classification:
    "LIQUID_SPILL" | "VOMIT" | "FOOD_RESIDUE" | "PHYSICAL_DAMAGE" | "DIRT_MUD" | "NO_DAMAGE_DETECTED" | "OTHER";
  /**
   * Estimated severity of the detected damage.
   */
  damage_severity?: "MINOR" | "MODERATE" | "SEVERE";
}
/**
 * A single receipt submitted as evidence.  The presence of this object does not guarantee that a ReceiptOcrResult can be emitted; the receipt image may be unreadable.
 */
export interface ReceiptEvidenceInput {
  /**
   * Unique identifier for the submitted receipt (e.g., 'RCP-001').
   */
  receipt_id: string;
  /**
   * URL or storage path to the receipt image.
   */
  receipt_url: string;
  /**
   * ISO 8601 timestamp of when the receipt was uploaded.
   */
  uploaded_at?: string;
  ocr_result?: ReceiptOcrResult;
  /**
   * True when this receipt was matched to a receipt already submitted in a different case.
   */
  recycled_receipt_detected?: boolean;
  /**
   * Case ID of the prior case that already submitted an identical or near-duplicate receipt.
   */
  recycled_receipt_match_case_id?: string;
  /**
   * Why the receipt matched: IDENTICAL_FILE, NEAR_DUPLICATE_IMAGE, or SAME_MERCHANT_AMOUNT_DATE.
   */
  recycled_receipt_match_reason?:
    | 'IDENTICAL_FILE'
    | 'NEAR_DUPLICATE_IMAGE'
    | 'SAME_MERCHANT_AMOUNT_DATE';
}
/**
 * Structured OCR result.  Omitted when the receipt could not be read.
 */
export interface ReceiptOcrResult {
  /**
   * Monetary amount read from the receipt by OCR.
   */
  amount: number;
  /**
   * ISO 4217 currency code read from the receipt.
   */
  currency: string;
  /**
   * Merchant or vendor name printed on the receipt, if legible.
   */
  merchant_name?: string;
  /**
   * Date printed on the receipt, normalized to ISO-8601 by the OCR adapter.
   */
  receipt_date?: string;
  /**
   * Confidence score (0.0-1.0) for the overall OCR read result.
   */
  ocr_confidence?: number;
}

export interface DataSources {
  trip_data?: TripData;
  app_events?: AppEvent[];
  gps_telemetry: {
    actual_route: GPSCoordinate[];
    optimal_route: GPSCoordinate[];
    deviation_distance_km: number;
    unexpected_stops: unknown[];
    trip_duration_seconds: number;
    optimal_duration_seconds?: number;
  };
  chat_communication: ChatCommunication;
  payment_fare_data: PaymentFareData;
  historical_profiles: HistoricalProfile[];
}

// ---------------------------------------------------------------------------
// Agent Statements & Cross-Exam
// ---------------------------------------------------------------------------

export interface EvidenceReference {
  evidence_id: string;
  source_type: string;
  description: string;
}

export interface AgentStatement {
  party: "RIDER" | "DRIVER";
  agent_role: string;
  argument_summary?: string;
  content?: string;
  detailed_argument?: string;
  requested_outcome?: string;
  requested_amount?: number;
  currency?: string;
  evidence_references?: EvidenceReference[];
  submitted_at: string;
  [key: string]: unknown;
}

export interface TargetedQuestion {
  question_id: string;
  directed_to: "RIDER" | "DRIVER" | "BOTH";
  question_text: string;
  evidence_context: string;
  category: string;
  asked_at: string;
}

export interface TargetedResponse {
  response_id: string;
  question_id: string;
  responding_party: "RIDER" | "DRIVER";
  response_text: string;
  responded_at: string;
}

export interface Round2CrossExam {
  targeted_questions?: TargetedQuestion[];
  targeted_responses?: TargetedResponse[];
  round2_completed?: boolean;
  completed_at?: string;
}

// ---------------------------------------------------------------------------
// Bonus Modules & Prosecutor Findings
// ---------------------------------------------------------------------------

export interface ExifAnalysis {
  image_id: string;
  exif_timestamp?: string;
  is_ai_generated?: boolean;
  ai_generated_confidence?: number;
  stain_damage_classification?: string;
  damage_severity?: string;
  exif_consistent_with_trip?: boolean;
  recycled_image_detected?: boolean;
  recycled_image_match_case_id?: string | null;
}

export interface FraudAssessment {
  fraud_risk_score: number;
  risk_factors: string[];
  collusion_warning_flag: boolean;
  collusion_evidence?: string;
  abuse_pattern_detected: boolean;
  abuse_pattern_description?: string;
  recommended_fraud_action?: string;
}

export interface EscalationProtocol {
  safety_threat_detected: boolean;
  fraud_risk_level: "LOW" | "MEDIUM" | "HIGH";
  escalation_reasons: string[];
  is_escalated: boolean;
  priority_level: "STANDARD" | "HIGH_PRIORITY" | "URGENT";
  missing_crucial_evidence?: boolean;
  party_requested_human?: boolean;
}

export interface BonusModules {
  image_exif_analyses?: ExifAnalysis[];
  fraud_assessment?: FraudAssessment;
  escalation_protocol?: EscalationProtocol;
}

export interface Fact {
  fact_id: string;
  description: string;
  supporting_evidence: EvidenceReference[];
  party_relevance?: string;
  policy_clause_reference?: string;
  confidence_level?: number;
}

export interface ProsecutorReport {
  verified_facts: Fact[];
  disputed_facts: Fact[];
  missing_facts: Fact[];
  prosecutor_summary?: string;
  report_submitted_at?: string;
}

// ---------------------------------------------------------------------------
// Policy Consultation
// ---------------------------------------------------------------------------

export interface PolicyClauseReference {
  clause_id: string;
  clause_title: string;
  clause_text_summary?: string;
  relevance_summary: string;
}

export interface PrecedentReference {
  precedent_id: string;
  similarity_summary: string;
  prior_ruling_type: RulingType;
}

export interface RecommendedAction {
  action_type: ActionType;
  refund_amount: number;
  cleaning_fee_amount?: number;
  currency: string;
  penalty_target?: string;
  account_action?: string;
}

export interface PolicySuggestion {
  suggestion_id: string;
  request_id: string;
  applicable_clauses: PolicyClauseReference[];
  matched_precedents?: PrecedentReference[];
  suggested_ruling_type: RulingType;
  suggested_recommended_action: RecommendedAction;
  policy_confidence: number;
  rationale: string;
  suggested_at: string;
}

export interface PolicyConsultation {
  request: {
    request_id: string;
    dispute_type: DisputeType;
    verified_fact_ids: string[];
    prosecutor_summary: string;
    requested_at: string;
  };
  suggestion: PolicySuggestion;
}

// ---------------------------------------------------------------------------
// Judge Verdict
// ---------------------------------------------------------------------------

export interface ExecutionPayload {
  execution_status: ExecutionStatus;
  transaction_id?: string | null;
  auto_executed_at?: string | null;
  case_final_status?: CaseFinalStatus;
  human_confirmation_details?: {
    reviewer_id?: string;
    approval_timestamp?: string;
    approval_decision?: HumanReviewDecision;
    override_reason?: string;
    modified_action?: RecommendedAction | null;
  };
  party_decision?: PartyDecision;
  resolved_at: string;
}

export interface JudgeVerdict {
  ruling_type: RulingType;
  confidence_score: number;
  reasoning_summary: string;
  verified_fact_references?: string[];
  policy_clauses_applied?: string[];
  precedent_references?: string[];
  recommended_action: RecommendedAction;
  explanations: {
    explanation_for_rider: string;
    explanation_for_driver: string;
  };
  execution_payload?: ExecutionPayload;
  deliberated_at: string;
}

// ---------------------------------------------------------------------------
// Full Case Result
// ---------------------------------------------------------------------------

export interface CaseResult {
  case_metadata: CaseMetadata;
  dispute_claim?: DisputeClaim;
  data_sources?: DataSources;
  user_account?: UserAccount;
  round_1_statements?: {
    rider_statement?: AgentStatement;
    driver_statement?: AgentStatement;
  };
  round_2_cross_exam?: Round2CrossExam;
  agent_conversation?: AgentConversationMessage[];
  bonus_modules?: BonusModules;
  prosecutor_findings?: ProsecutorReport;
  policy_consultation?: PolicyConsultation;
  judge_verdict?: JudgeVerdict;
  policy_kb_update?: unknown;
}

// ---------------------------------------------------------------------------
// Agent Conversation Event (SSE)
// ---------------------------------------------------------------------------

export interface AgentConversationMessage {
  message_id: string;
  speaker: string;
  message_type: "STATEMENT" | "QUESTION" | "RESPONSE";
  target: string;
  content: string;
  turn: number;
  status: string;
  agent_output: Record<string, unknown>;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// SSE Event Shapes
// ---------------------------------------------------------------------------

export interface PipelineEvent {
  phase: string;
  label: string;
  data: Record<string, unknown>;
  timestamp: string;
  event_type?: string;
  speaker?: string;
  message_type?: string;
}

export interface PipelineCompleteEvent {
  result: CaseResult | null;
}

// ---------------------------------------------------------------------------
// Trips Listing (from GET /api/v1/30-days-trips/${party_id})
// ---------------------------------------------------------------------------

export interface Past30DaysTripListItem {
  party_id: string;
  total_trips: number;
  trips: {
    trip_id: string;
    trip_data: TripData;
    payment_fare_data: PaymentFareData;
    historical_profiles: HistoricalProfile[];
  }[];
}

// ---------------------------------------------------------------------------
// Case Listing (from GET /api/disputes)
// ---------------------------------------------------------------------------

export interface CaseListItem {
  case_id: string;
  dispute_type: DisputeType;
  current_state: PipelineState;
  trip_id?: string;
  rider_id?: string;
  driver_id?: string;
  has_completed_result: boolean;
}

// ---------------------------------------------------------------------------
// Raw Case Data (from GET /api/disputes/{id})
// ---------------------------------------------------------------------------

export interface RawCaseData {
  case_metadata: CaseMetadata;
  dispute_claim: DisputeClaim;
  data_sources: DataSources;
  user_account?: UserAccount;
}

// ---------------------------------------------------------------------------
// Human Review Request
// ---------------------------------------------------------------------------

export interface HumanReviewRequest {
  reviewer_id: string;
  reviewer_name: string;
  approval_decision: HumanReviewDecision;
  override_reason?: string;
  modified_action?: RecommendedAction | null;
  review_notes?: string;
}

// ---------------------------------------------------------------------------
// Party Decision (terminal-user accept / request human review)
// ---------------------------------------------------------------------------

export type PartyDecisionType = "ACCEPT" | "REQUEST_HUMAN_REVIEW";

export interface PartyDecisionRequest {
  decision: PartyDecisionType;
  comment?: string;
}

export interface PartyDecision {
  decision: PartyDecisionType;
  decided_at: string;
  comment?: string;
}

export type UserRole = "RIDER" | "DRIVER" | "SUPPORT";

/**
 * User account schema stored in users.json for backend authentication and historical profile mapping.
 */
export interface UserAccount {
  party: UserRole;
  /**
   * Primary key / unique ID (e.g., R-1092, D-5541, S-0001).
   */
  party_id: string;
  name: string;
  email: string;
  /**
   * Hashed password string (or plaintext in development).
   */
  password: string;
  account_age_days: number;
  total_trips: number;
  /**
   * @minItems 0
   */
  trips_past_30_days: string[];
  avg_rating: number;
  risk_score: number;
  dispute_history_30d: number;
  dispute_history_90d: number;
  bad_faith_flag: boolean;
  bad_faith_reason?: string;
}