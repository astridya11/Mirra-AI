/**
 * Shared demo session — pure state + reducer + privacy selectors.
 *
 * No imports on purpose: `node src/demo/session.check.mjs` runs this file directly.
 * Persistence / cross-tab sync lives in useDemoSession.ts.
 *
 * PRIVACY RULE: party apps must only ever read passengerView() / driverView().
 * Those selectors never include the other party's private assistance state, so a
 * private MIRRA chat cannot change anything the other party renders.
 *
 * FREEZE RULE: once `frozen` is true the reducer rejects every evidence mutation
 * (submitFinal, uploadEvidence). Cross-examination responses are stored in `claims`
 * only — they never become evidence. Uploads also close once the claim is submitted.
 */

export type Party = "passenger" | "driver";
export type Stage =
  | "TRIP"
  | "PRIVATE_ASSIST"
  | "FORMAL_COMPLAINT"
  | "EVIDENCE_INTAKE"
  | "EVIDENCE_FROZEN"
  | "TRIBUNAL"
  | "DECISION"
  | "HUMAN_REVIEW";
export type TripStatus = "ACTIVE" | "COMPLETED" | "NO_SHOW_CANCELLED";

export interface ChatMsg {
  from: "user" | "mirra";
  text: string;
  map?: boolean;
  /** Follow-up suggestion labels offered with this MIRRA reply (own party's chat only). */
  suggest?: string[];
  /** User message produced by a suggestion: its stable id (language-independent). */
  actionId?: string;
}

export interface Claim {
  party: Party;
  text: string;
}

export type UploadKind = "photo" | "receipt";
/** Live backend pipeline state (Milestone 4). OFF = fixture mode. */
export type LiveStatus = "OFF" | "CREATING" | "CREATED" | "RUNNING" | "DONE" | "ERROR";

export interface DemoSession {
  version: 4;
  demoId: string;
  caseId: string;
  variant: "A" | "B" | null;
  sessionId: string;
  stage: Stage;
  /** First party to open private MIRRA assistance (internal only). */
  privateBy: Party | null;
  formalBy: Party | null;
  /** Final statement + evidence submitted during the evidence window. */
  submitted: Record<Party, boolean>;
  frozen: boolean;
  /** Number of tribunal events revealed so far. */
  revealed: number;
  /** Round-2 / cross-exam responses. Claims only — never verified evidence. */
  claims: Claim[];
  /** Normal Ryde trip state — visible to both parties. */
  tripStatus: TripStatus;
  /** Claim evidence prepared by `uploadedBy` before submission (Demo 3). Private to the uploader until the claim is filed. */
  photoUploaded: boolean;
  receiptUploaded: boolean;
  evidenceSubmissionCompleted: boolean;
  uploadNames: Record<UploadKind, string | null>;
  uploadedBy: Party | null;
  /** Backend case created for this claim (live mode); null = fixture mode. */
  liveCaseId: string | null;
  liveStatus: LiveStatus;
  /** Private MIRRA transcripts; null = never opened. Internal only, never cross-party. */
  privateChats: Record<Party, ChatMsg[] | null>;
}

export type Action =
  | { type: "openPrivate"; party: Party; greeting: string }
  | { type: "privateMessage"; party: Party; text: string; reply: ChatMsg; actionId?: string }
  | { type: "tripStatus"; status: TripStatus }
  | { type: "submitFormal"; party: Party }
  | { type: "submitFinal"; party: Party }
  | { type: "uploadEvidence"; party: Party; kind: UploadKind; name: string }
  | { type: "live"; status: LiveStatus; caseId?: string }
  | { type: "finishTribunal"; escalate: boolean }
  | { type: "goOffline" }
  | { type: "startTribunal" }
  | { type: "reveal"; total: number; escalate: boolean; claim?: Claim }
  | { type: "reset" };

export const SESSION_VERSION = 4;

/** Namespaced per demo (scenario) AND session so demos/sessions never share state. */
export const sessionKey = (demoId: string, sessionId: string) => `mirra.demo.v${SESSION_VERSION}.${demoId}.${sessionId}`;

/** Default shared session id per demo, e.g. "001" — what the briefing links open. */
export const defaultSession = (demoId: string) => `00${demoId}`;

export function initialSession(init: {
  demoId: string;
  caseId: string;
  sessionId: string;
  tripStatus: TripStatus;
  variant?: "A" | "B" | null;
}): DemoSession {
  return {
    version: SESSION_VERSION,
    demoId: init.demoId,
    caseId: init.caseId,
    variant: init.variant ?? null,
    sessionId: init.sessionId,
    stage: "TRIP",
    privateBy: null,
    formalBy: null,
    submitted: { passenger: false, driver: false },
    frozen: false,
    revealed: 0,
    claims: [],
    tripStatus: init.tripStatus,
    photoUploaded: false,
    receiptUploaded: false,
    evidenceSubmissionCompleted: false,
    uploadNames: { photo: null, receipt: null },
    uploadedBy: null,
    liveCaseId: null,
    liveStatus: "OFF",
    privateChats: { passenger: null, driver: null },
  };
}

export function reduce(s: DemoSession, a: Action, initial: DemoSession = s): DemoSession {
  switch (a.type) {
    case "openPrivate":
      if (s.privateChats[a.party]) return s;
      return {
        ...s,
        stage: s.stage === "TRIP" ? "PRIVATE_ASSIST" : s.stage,
        privateBy: s.privateBy ?? a.party,
        privateChats: { ...s.privateChats, [a.party]: [{ from: "mirra", text: a.greeting }] },
      };
    case "privateMessage":
      return {
        ...s,
        privateChats: {
          ...s.privateChats,
          [a.party]: [...(s.privateChats[a.party] ?? []), { from: "user", text: a.text, ...(a.actionId ? { actionId: a.actionId } : {}) }, a.reply],
        },
      };
    case "tripStatus":
      return { ...s, tripStatus: a.status };
    case "submitFormal":
      if (s.formalBy) return s;
      return { ...s, stage: "FORMAL_COMPLAINT", formalBy: a.party, evidenceSubmissionCompleted: true };
    case "uploadEvidence":
      // Evidence mutation: rejected once frozen, once the claim is submitted, or from a second party.
      if (s.frozen || s.evidenceSubmissionCompleted || (s.uploadedBy && s.uploadedBy !== a.party)) return s;
      return {
        ...s,
        uploadedBy: a.party,
        photoUploaded: s.photoUploaded || a.kind === "photo",
        receiptUploaded: s.receiptUploaded || a.kind === "receipt",
        uploadNames: { ...s.uploadNames, [a.kind]: a.name },
      };
    case "submitFinal":
      // Evidence mutation: only inside the open evidence window.
      if (!s.formalBy || s.frozen || s.submitted[a.party]) return s;
      return { ...s, stage: "EVIDENCE_INTAKE", submitted: { ...s.submitted, [a.party]: true } };
    case "startTribunal":
      if (!s.formalBy || s.frozen) return s;
      return { ...s, frozen: true, stage: "EVIDENCE_FROZEN" };
    case "reveal": {
      if (!s.frozen || s.revealed >= a.total) return s;
      const revealed = s.revealed + 1;
      return {
        ...s,
        revealed,
        claims: a.claim ? [...s.claims, a.claim] : s.claims,
        stage: revealed >= a.total ? (a.escalate ? "HUMAN_REVIEW" : "DECISION") : "TRIBUNAL",
      };
    }
    case "live":
      // The backend case id is fixed once created.
      return {
        ...s,
        liveStatus: a.status,
        liveCaseId: s.liveCaseId ?? a.caseId ?? null,
        stage: a.status === "RUNNING" && s.frozen && s.stage === "EVIDENCE_FROZEN" ? "TRIBUNAL" : s.stage,
      };
    case "goOffline":
      // Presenter fallback: drop the live case; the session continues on the offline reference story.
      return { ...s, liveCaseId: null, liveStatus: "ERROR" };
    case "finishTribunal":
      // Live pipeline completed: the stage follows the real Execution Router outcome.
      if (!s.frozen) return s;
      return { ...s, stage: a.escalate ? "HUMAN_REVIEW" : "DECISION" };
    case "reset":
      return initial;
  }
}

// ---------------------------------------------------------------------------
// View selectors
// ---------------------------------------------------------------------------

export type DisputePhase = "EVIDENCE" | "FROZEN" | "TRIBUNAL" | "DECIDED" | "HUMAN_REVIEW";

export interface PartyView {
  party: Party;
  caseId: string;
  tripStatus: TripStatus;
  /** This party's OWN private chat only. */
  chat: ChatMsg[] | null;
  /** Claim evidence this party prepared itself; null for the other party. */
  uploads: Record<UploadKind, string | null> | null;
  /** Non-null only once a formal complaint exists — the first moment the other party may learn of a dispute. */
  dispute: null | {
    role: "complainant" | "respondent";
    caseId: string;
    phase: DisputePhase;
    submitted: boolean;
    /** Whether the claim was filed with all required evidence — a fact of the formal claim, shared after filing. */
    evidenceProvided: boolean;
    /** Backend case id when the claim runs through the live pipeline. */
    liveCaseId: string | null;
  };
}

const PHASE: Partial<Record<Stage, DisputePhase>> = {
  FORMAL_COMPLAINT: "EVIDENCE",
  EVIDENCE_INTAKE: "EVIDENCE",
  EVIDENCE_FROZEN: "FROZEN",
  TRIBUNAL: "TRIBUNAL",
  DECISION: "DECIDED",
  HUMAN_REVIEW: "HUMAN_REVIEW",
};

function partyView(s: DemoSession, party: Party): PartyView {
  return {
    party,
    caseId: s.caseId,
    tripStatus: s.tripStatus,
    chat: s.privateChats[party],
    uploads: s.uploadedBy === party ? s.uploadNames : null,
    dispute: s.formalBy
      ? {
          role: s.formalBy === party ? "complainant" : "respondent",
          caseId: s.caseId,
          phase: PHASE[s.stage] ?? "EVIDENCE",
          submitted: s.submitted[party],
          evidenceProvided: s.photoUploaded && s.receiptUploaded,
          liveCaseId: s.liveCaseId,
        }
      : null,
  };
}

export const passengerView = (s: DemoSession) => partyView(s, "passenger");
export const driverView = (s: DemoSession) => partyView(s, "driver");

/** Demo-observer view. Private sessions are listed but explicitly labelled as hidden from the other party. */
export function internalView(s: DemoSession) {
  const privateSessions = (["passenger", "driver"] as const)
    .filter((p) => s.privateChats[p])
    .map((p) => ({
      party: p,
      messages: s.privateChats[p]!.length,
      label: `PRIVATE SESSION — not visible to the ${p === "passenger" ? "driver" : "passenger"}`,
    }));
  return {
    version: s.version,
    demoId: s.demoId,
    caseId: s.caseId,
    variant: s.variant,
    sessionId: s.sessionId,
    stage: s.stage,
    privateBy: s.privateBy,
    formalBy: s.formalBy,
    submitted: s.submitted,
    frozen: s.frozen,
    revealed: s.revealed,
    claims: s.claims,
    tripStatus: s.tripStatus,
    photoUploaded: s.photoUploaded,
    receiptUploaded: s.receiptUploaded,
    evidenceSubmissionCompleted: s.evidenceSubmissionCompleted,
    uploadNames: s.uploadNames,
    uploadedBy: s.uploadedBy,
    liveCaseId: s.liveCaseId,
    liveStatus: s.liveStatus,
    privateSessions,
  };
}
