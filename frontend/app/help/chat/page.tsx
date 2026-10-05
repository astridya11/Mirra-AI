"use client";

/**
 * Help / Chat Page
 *
 * A single continuous conversation that combines two phases:
 *   1. Issue-submission flow — user describes their issue, bot confirms,
 *      redirects to tribunal.
 *   2. Verdict flow (from=process) — after the tribunal completes, the user
 *      returns here. The original issue-submission conversation is preserved
 *      and the verdict is appended below as a continuation.
 *
 * Verdict presentation:
 *   - If ESCALATED_HUMAN_REVIEW: only says case is under human review,
 *     no verdict details shown.
 *   - If FULLY_AUTOMATED: shows a verdict card with the ruling and
 *     recommended action, plus "Accept" and "Not happy, request human
 *     review" buttons. Decision persists to backend via
 *     submitPartyDecision().
 *
 * A "View AI Tribunal" link appears above the verdict card and redirects
 * to /tribunal/[caseId].
 *
 * Evidence collection (cleaning-fee claims):
 *   The selected issue is received via the `issue` query param. If it is a
 *   cleaning-fee claim (see isCleaningFeeIssue), then after the user describes
 *   the issue the bot asks for (1) a photo of the car's condition and
 *   (2) a cleaning receipt, each with an "Upload" button. Only after both are
 *   collected does the flow continue to the AI Tribunal as usual.
 *   Files are only held in memory for now (no upload API yet).
 */

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { TypingDots } from "@/src/components/TypingDots";
import { createDispute, CreateDisputePayload, getCompletedResult, submitPartyDecision } from "@/src/lib/api";
import type { CaseResult, JudgeVerdict, RecommendedAction } from "@/src/types";

// ==========================================
// Issue helpers
// ==========================================

/**
 * Identify a "claim cleaning fee" issue from the selected issueType.
 */

function isCleaningFeeIssue(issueType: string): boolean {
  const text = issueType.trim();
  if (!text) return false;
  return text === "CLEANING_FEE" || text === "cleaning_fee";
}

type EvidenceStep = "PHOTO" | "RECEIPT";

const EVIDENCE_COPY: Record<
  EvidenceStep,
  { prompt: string; button: string; hint: string; userCaption: string }
> = {
  PHOTO: {
    prompt:
      "Thanks for the details. To support your cleaning fee claim, please upload a photo showing the mess in the car.",
    button: "Upload photo",
    hint: "Take a clear photo or choose one from your library",
    userCaption: "Photo of the car condition",
  },
  RECEIPT: {
    prompt: "Got it, thank you. Now please upload your cleaning receipt.",
    button: "Upload receipt",
    hint: "Make sure the amount and date are readable",
    userCaption: "Cleaning receipt",
  },
};

// Helper: Convert File object to Base64 String for JSON transmission
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

// ==========================================
// Verdict helpers
// ==========================================

function isEscalated(result: CaseResult): boolean {
  const meta = result.case_metadata;
  const ep = result.judge_verdict?.execution_payload;
  return (
    meta.resolution_channel === "ESCALATED_HUMAN_REVIEW" ||
    ep?.execution_status === "PENDING_HUMAN_APPROVAL"
  );
}

function isAutomated(result: CaseResult): boolean {
  const meta = result.case_metadata;
  const ep = result.judge_verdict?.execution_payload;
  return (
    meta.resolution_channel === "FULLY_AUTOMATED" ||
    ep?.execution_status === "AUTO_EXECUTED"
  );
}

/** Get the user-facing explanation text from the judge verdict. */
function getVerdictExplanation(verdict: JudgeVerdict | undefined): string {
  if (!verdict?.explanations) return "";
  return verdict.explanations.explanation_for_rider || "";
}

/** Format the recommended action for user display. */
function formatAction(action: RecommendedAction | undefined): string {
  if (!action) return "";
  const { action_type, refund_amount, currency, cleaning_fee_amount } = action;
  const cur = currency || "SGD";

  switch (action_type) {
    case "FULL_REFUND":
      return `A full refund of ${cur} ${refund_amount.toFixed(2)} will be credited to your account.`;
    case "PARTIAL_REFUND":
      return `A partial refund of ${cur} ${refund_amount.toFixed(2)} will be credited to your account.`;
    case "NO_REFUND":
      return "No refund will be issued.";
    case "CLEANING_FEE_CHARGE":
      return `A cleaning fee of ${cur} ${(cleaning_fee_amount ?? 0).toFixed(2)} will be charged.`;
    case "PENALTY_ONLY":
      return "Appropriate account action will be taken. No refund will be issued.";
    case "ESCALATED_NO_ACTION":
      return "No automatic action will be taken. The case requires further review.";
    default:
      return "Action details will be confirmed.";
  }
}

/** One-line verdict summary for the user. */
function verdictSummary(verdict: JudgeVerdict | undefined): string {
  if (!verdict) return "Your case has been reviewed.";
  switch (verdict.ruling_type) {
    case "APPROVED":
      return "Your claim has been approved.";
    case "PARTIAL_REFUND":
      return "You will receive a partial refund.";
    case "REJECTED":
      return "Your claim has been reviewed.";
    case "ESCALATED":
      return "Your case requires further review.";
    default:
      return "Your case has been reviewed.";
  }
}

// ==========================================
// Verdict Card Component
// ==========================================

interface VerdictCardProps {
  verdict: JudgeVerdict;
  caseId: string;
  onDecisionChange: (decided: boolean) => void;
}

function VerdictCard({ verdict, caseId, onDecisionChange }: VerdictCardProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<"ACCEPT" | "REQUEST_HUMAN_REVIEW" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for existing party_decision on mount
  useEffect(() => {
    const existing = verdict.execution_payload?.party_decision;
    if (existing) {
      setDecision(existing.decision);
      onDecisionChange(true);
    }
  }, [verdict, onDecisionChange]);

  const handleAccept = useCallback(async () => {
    if (decision || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPartyDecision(caseId, { decision: "ACCEPT" });
      setDecision("ACCEPT");
      onDecisionChange(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [caseId, decision, submitting, onDecisionChange]);

  const handleReject = useCallback(async () => {
    if (decision || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPartyDecision(caseId, { decision: "REQUEST_HUMAN_REVIEW" });
      setDecision("REQUEST_HUMAN_REVIEW");
      onDecisionChange(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [caseId, decision, submitting, onDecisionChange]);

  const explanation = getVerdictExplanation(verdict);
  const actionText = formatAction(verdict.recommended_action);
  const summary = verdictSummary(verdict);

  return (
    <div className="space-y-3">
      {/* Bot message introducing the verdict */}
      <div className="flex items-end gap-2 justify-start animate-slide-up">
        <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-[#E84360]">M</span>
        </div>
        <div className="max-w-[75%]">
          <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[14px] leading-5 text-[#111827]">
            Your case has been reviewed. Here's the outcome:
          </div>
        </div>
      </div>

      {/* "View AI Tribunal" link above the verdict card */}
      <div className="ml-9">
        <button
          onClick={() => router.push(`/tribunal/${caseId}`)}
          className="inline-flex items-center gap-1 text-[12px] font-normal text-slate-700 active:opacity-60 transition-opacity"
        >
          View AI Tribunal
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Verdict card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 animate-slide-up ml-9">
        {/* Summary line */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#FDF1F3] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E84360" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <span className="text-[14px] font-semibold text-[#111827]">{summary}</span>
        </div>

        {/* Action */}
        <p className="text-[14px] text-[#6B7280] leading-5">{actionText}</p>

        {/* Explanation */}
        {explanation && (
          <p className="text-[12px] text-[#9CA3AF] leading-5">{explanation}</p>
        )}

        {/* Error */}
        {error && (
          <p className="text-[13px] text-[#E84360]">{error}</p>
        )}

        {/* Decision buttons — only if not yet decided */}
        {!decision && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="flex-1 h-10 rounded-md bg-[#E84360] text-white font-normal text-[13px] active:scale-95 transition-transform disabled:opacity-50"
            >
              {submitting ? "…" : "Accept"}
            </button>
            <button
              onClick={handleReject}
              disabled={submitting}
              className="flex-1 h-10 rounded-md bg-[#F3F4F6] text-[#111827] font-normal text-[13px] active:scale-95 transition-transform disabled:opacity-50"
            >
              {submitting ? "…" : "Decline"}
            </button>
          </div>
        )}

        {/* Post-decision confirmation */}
        {decision === "ACCEPT" && (
          <div className="pt-1">
            <div className="flex items-center gap-2 rounded-md bg-[#F0FDFA] px-4 py-2.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[12px] font-normal text-[#0D9488]">
                Your case is now closed.
              </span>
            </div>
          </div>
        )}

        {decision === "REQUEST_HUMAN_REVIEW" && (
          <div className="pt-1">
            <div className="rounded-2xl bg-[#FFFBEB] px-4 py-2.5">
              <span className="text-[14px] text-[#D97706]">
                Your case has been escalated to our human review team. We'll get back to you soon.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// Escalated Message Component
// ==========================================

function EscalatedMessage({ caseId }: { caseId: string }) {
  const router = useRouter();
  return (
    <div className="space-y-3 animate-slide-up">
      {/* "View AI Tribunal" link above the escalated message */}
      <div className="ml-9">
        <button
          onClick={() => router.push(`/tribunal/${caseId}`)}
          className="inline-flex items-center gap-1 text-[12px] font-normal text-slate-700 active:opacity-60 transition-opacity"
        >
          View AI Tribunal
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="flex items-end gap-2 justify-start">
        <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-[#E84360]">M</span>
        </div>
        <div className="max-w-[75%]">
          <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[14px] leading-5 text-[#111827]">
            Your case has been escalated to our human review team. They'll examine the details carefully and get back to you via email as soon as possible.
          </div>
        </div>
      </div>
      <div className="flex justify-center pt-2">
        <button
          onClick={() => { if (typeof window !== "undefined") window.location.href = "/"; }}
          className="text-[14px] font-medium text-[#E84360] active:opacity-60"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Chat Bubble Component
// ==========================================

function ChatBubble({
  message,
}: {
  message: { sender: "bot" | "user"; text: string; imageUrl?: string };
}) {
  const isBot = message.sender === "bot";
  const hasImage = Boolean(message.imageUrl);
  return (
    <div className={`flex items-end gap-2 ${isBot ? "justify-start" : "justify-end"} animate-slide-up`}>
      {isBot && (
        <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-[#E84360]">M</span>
        </div>
      )}
      <div
        className={`max-w-[75%] ${hasImage ? "p-1.5" : "px-4 py-2.5"} text-[14px] leading-5 ${
          isBot
            ? "bg-[#F3F4F6] text-[#111827] rounded-2xl rounded-tl-sm"
            : "bg-[#E84360] text-white rounded-2xl rounded-tr-sm"
        }`}
      >
        {hasImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.imageUrl}
            alt={message.text || "Uploaded evidence"}
            className="w-full max-h-56 rounded-xl object-cover"
          />
        )}
        {message.text && (
          <div className={hasImage ? "px-2 pt-1.5 pb-1 text-[13px]" : ""}>{message.text}</div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// Main Chat Content
// ==========================================

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read query params
  const paramCaseId = searchParams.get("caseId") || "";
  const paramTripId = searchParams.get("tripId") || "";
  const fromProcess = searchParams.get("from") === "process";
  const issueType = searchParams.get("issueType") || "";
  const driverId = searchParams.get("driverId") || "";
  const riderId = searchParams.get("riderId") || "";
  const filedBy = searchParams.get("filedBy") || "";

  // Initialize caseId immediately from URL or fallback to sessionStorage
  const [caseId, setCaseId] = useState<string>(() => {
    if (paramCaseId) return paramCaseId;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("latest-case-id") || "";
    }
    return "";
  });

  const [tripId, setTripId] = useState<string>(() => {
    if (paramTripId) return paramTripId;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("latest-trip-id") || "";
    }
    return "";
  });


  // Keep caseId and tripId synchronized when searchParams load
  useEffect(() => {
    if (paramCaseId) {
      setCaseId(paramCaseId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("latest-case-id", paramCaseId);
      }
    }
    if (paramTripId) {
      setTripId(paramTripId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("latest-trip-id", paramTripId);
      }
    }
  }, [paramCaseId, paramTripId]);

  const needsCleaningEvidence = isCleaningFeeIssue(issueType);
  const [disputeClaimDescription, setDisputeClaimDescription] = useState<string>("");

  // --- Verdict mode state ---
  const [verdictResult, setVerdictResult] = useState<CaseResult | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(fromProcess);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [decisionMade, setDecisionMade] = useState(false);

  // --- Issue submission mode state ---
  const [messages, setMessages] = useState<
    { id: string; sender: "bot" | "user"; text: string; imageUrl?: string }[]
  >([
    {
      id: "m1",
      sender: "bot",
      text: `Thank you for selecting your trip (${tripId}). Please describe your issue in detail in a single message so our Miora AI Tribunal can assist you.`,
    },
  ]);
  const [input, setInput] = useState("");
  // descriptionSent: the user's one-message description has been sent.
  // submitted: the flow is complete and the tribunal is being launched.
  const [descriptionSent, setDescriptionSent] = useState(fromProcess);
  const [submitted, setSubmitted] = useState(fromProcess);
  const [botTyping, setBotTyping] = useState(false);

  // --- Evidence collection state (cleaning-fee claims) ---
  // evidenceStep is the step currently being collected (null = not in this flow).
  // awaitingUpload is true only once the bot has asked, so the button is enabled.
  const [evidenceStep, setEvidenceStep] = useState<EvidenceStep | null>(null);
  const [awaitingUpload, setAwaitingUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const evidenceRef = useRef<{ photo: File | null; receipt: File | null }>({
    photo: null,
    receipt: null,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  // Clear pending timers and release preview URLs on unmount.
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, botTyping, verdictResult, decisionMade]);

  // --- Restore issue-submission conversation when returning from tribunal ---
  useEffect(() => {
    if (!fromProcess) return;

    let storedIssue = "";
    if (caseId) {
      storedIssue = sessionStorage.getItem(`chat-issue-${caseId}`) || "";
    }
    if (!storedIssue && tripId) {
      storedIssue = sessionStorage.getItem(`chat-issue-${tripId}`) || "";
    }
    if (!storedIssue) {
      storedIssue = sessionStorage.getItem("latest-chat-issue") || "";
    }

    if (storedIssue) {
      setMessages((prev) => {
        // Avoid duplicates if the effect runs twice
        if (prev.some((m) => m.sender === "user")) return prev;
        return [
          ...prev,
          { id: `u-restored`, sender: "user" as const, text: storedIssue },
          {
            id: `b-restored`,
            sender: "bot" as const,
            text: "Dispute Logged. Your case is now being reviewed by our multi-agent AI system. Please wait while the tribunal deliberates.",
          },
        ];
      });
    }
  }, [caseId, tripId, fromProcess]);

  // --- Load verdict result on mount (from=process mode) ---
  useEffect(() => {
    if (!fromProcess || !caseId) return;
    let cancelled = false;

    (async () => {
      try {
        setVerdictLoading(true);
        const result = await getCompletedResult(caseId);
        if (cancelled) return;

        if (!result) {
          setVerdictError("No result found for this case.");
          setVerdictLoading(false);
          return;
        }

        setVerdictResult(result);
        setVerdictLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("Error fetching verdict result:", err);
          setVerdictError("Could not load the result. Please try again.");
          setVerdictLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [caseId, fromProcess]);

  // --- Launch AI Tribunal and post payload ---
  const launchTribunal = async (customDescription?: string) => {
    setSubmitted(true);
    setBotTyping(true);

    later(() => {
      setBotTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `b${Date.now()}`,
          sender: "bot",
          text: "Dispute Logged. Your case is now being reviewed by our multi-agent AI system. Please wait while the tribunal deliberates.",
        },
      ]);
    }, 1500);

    // Convert evidence files to Base64 arrays
    const imageEvidence: string[] = [];
    const receiptEvidence: string[] = [];

    if (evidenceRef.current.photo) {
      try {
        const photoBase64 = await fileToBase64(evidenceRef.current.photo);
        imageEvidence.push(photoBase64);
      } catch (e) {
        console.error("Failed to convert photo file:", e);
      }
    }

    if (evidenceRef.current.receipt) {
      try {
        const receiptBase64 = await fileToBase64(evidenceRef.current.receipt);
        receiptEvidence.push(receiptBase64);
      } catch (e) {
        console.error("Failed to convert receipt file:", e);
      }
    }

    // Construct full payload
    const claimText = customDescription || disputeClaimDescription;

    const formData: CreateDisputePayload = {
      trip_id: tripId,
      dispute_type: issueType,
      dispute_claim_description: claimText,
      filed_by: filedBy,
      rider_id: riderId,
      driver_id: driverId,
      image_evidence: imageEvidence,
      receipt_evidence: receiptEvidence,
    };

    try {
      const result = await createDispute(formData);
      const newCaseId = result.case_id;

      setCaseId(newCaseId);

      // Store issue history under multiple key fallbacks
      sessionStorage.setItem("latest-case-id", newCaseId);
      sessionStorage.setItem("latest-chat-issue", claimText);
      sessionStorage.setItem(`case-id-${tripId}`, newCaseId);
      sessionStorage.setItem(`chat-issue-${tripId}`, claimText);
      sessionStorage.setItem(`chat-issue-${newCaseId}`, claimText);

      later(() => {
        router.push(`/tribunal/${newCaseId}`);
      }, 3500);
    } catch (error) {
      console.error("Error creating dispute:", error);
      setBotTyping(false);
    }
  };

  // --- Issue submission handler (non-verdict mode) ---
  const handleSend = () => {
    if (!input.trim() || descriptionSent) return;
    const currentInput = input;
    const userMsg = { id: `u${Date.now()}`, sender: "user" as const, text: currentInput };

    setMessages((prev) => [...prev, userMsg]);
    setDisputeClaimDescription(currentInput);

    try {
      sessionStorage.setItem("latest-chat-issue", currentInput);
      sessionStorage.setItem(`chat-issue-${tripId}`, currentInput);
    } catch {
      // Ignore session storage errors
    }

    setInput("");
    setDescriptionSent(true);

    if (needsCleaningEvidence) {
      // Cleaning-fee claim: collect photo + receipt before launching the tribunal.
      setEvidenceStep("PHOTO");
      setAwaitingUpload(false);
      setBotTyping(true);
      later(() => {
        setBotTyping(false);
        setMessages((prev) => [
          ...prev,
          { id: `b-photo-${Date.now()}`, sender: "bot", text: EVIDENCE_COPY.PHOTO.prompt },
        ]);
        setAwaitingUpload(true);
      }, 1200);
      return;
    }

    launchTribunal(currentInput);
  };

  // --- Evidence Upload Pickers ---
  const handlePickFile = () => {
    if (!awaitingUpload) return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !evidenceStep || !awaitingUpload) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    setUploadError(null);

    const step = evidenceStep;
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);

    // Save File reference inside mutable ref
    if (step === "PHOTO") {
      evidenceRef.current.photo = file;
    } else {
      evidenceRef.current.receipt = file;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `u-${step.toLowerCase()}-${Date.now()}`,
        sender: "user",
        text: EVIDENCE_COPY[step].userCaption,
        imageUrl: url,
      },
    ]);
    setAwaitingUpload(false);
    setBotTyping(true);

    if (step === "PHOTO") {
      later(() => {
        setBotTyping(false);
        setMessages((prev) => [
          ...prev,
          { id: `b-receipt-${Date.now()}`, sender: "bot", text: EVIDENCE_COPY.RECEIPT.prompt },
        ]);
        setEvidenceStep("RECEIPT");
        setAwaitingUpload(true);
      }, 1000);
    } else {
      later(() => {
        setBotTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `b-evidence-done-${Date.now()}`,
            sender: "bot",
            text: "Thank you, I've received your photo and receipt. Passing everything to our AI Tribunal now.",
          },
        ]);
        launchTribunal();
      }, 1000);
    }
  };

  // --- Unified render: issue-submission flow + verdict (if fromProcess) ---
  // In fromProcess mode, the issue-submission conversation is preserved and
  // the verdict is appended below as a continuous conversation. The input bar
  // is hidden in fromProcess mode (treated as already submitted).
  const showInput = !descriptionSent && !fromProcess;
  const showUploadBar = !fromProcess && !submitted && evidenceStep !== null;

  return (
    <div className="flex flex-col h-screen bg-white">
      <IOSHeader
        title="Ryde AI Support"
        onBack={() => router.push("/help")}
        rightAction={
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />
          </div>
        }
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-[560px] w-full mx-auto">
        {/* Issue-submission conversation (always shown) */}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {botTyping && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#E84360]">M</span>
            </div>
            <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-3">
              <TypingDots />
            </div>
          </div>
        )}

        {submitted && !botTyping && !fromProcess && (
          <div className="flex justify-center pt-2">
            <div className="flex items-center gap-2 rounded-full bg-[#FDF1F3] px-4 py-2 animate-fade-in">
              <span className="w-2 h-2 rounded-full bg-[#E84360] animate-pulse-dot" />
              <span className="text-[12px] font-normal text-[#E84360]">
                Dispute Logged — Miora AI Tribunal Session Active
              </span>
            </div>
          </div>
        )}

        {/* Verdict section (fromProcess mode) — appears below the conversation */}
        {fromProcess && (
          <>
            {verdictLoading && (
              <div className="flex items-end gap-2 justify-start">
                <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-[#E84360]">M</span>
                </div>
                <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-3">
                  <TypingDots />
                </div>
              </div>
            )}

            {verdictError && (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <div className="text-[14px] text-[#6B7280] text-center px-8">
                  {verdictError}
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="px-5 py-2.5 rounded-2xl bg-[#E84360] text-white font-semibold text-[13px] active:scale-95 transition-transform"
                >
                  Retry
                </button>
              </div>
            )}

            {verdictResult && !verdictLoading && !verdictError && (
              <>
                {isEscalated(verdictResult) ? (
                  <EscalatedMessage caseId={caseId} />
                ) : isAutomated(verdictResult) && verdictResult.judge_verdict ? (
                  <VerdictCard
                    verdict={verdictResult.judge_verdict}
                    caseId={caseId}
                    onDecisionChange={setDecisionMade}
                  />
                ) : (
                  <>
                    {/* "View AI Tribunal" link above the still-processing message */}
                    <div className="ml-9">
                      <button
                        onClick={() => router.push(`/tribunal/${caseId}`)}
                        className="inline-flex items-center gap-1 text-[12px] font-normal text-slate-700 active:opacity-60 transition-opacity"
                      >
                        View AI Tribunal
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-end gap-2 justify-start animate-slide-up">
                      <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[#E84360]">M</span>
                      </div>
                      <div className="max-w-[75%]">
                        <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[14px] leading-5 text-[#111827]">
                          Your case is still being processed. Please check back shortly.
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Secondary "Back to home" after decision */}
                {decisionMade && (
                  <div className="flex justify-center pt-2 animate-fade-in">
                    <button
                      onClick={() => { if (typeof window !== "undefined") window.location.href = "/"; }}
                      className="text-[14px] font-medium text-[#E84360] active:opacity-60"
                    >
                      Back to home
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer / input bar */}
      {showInput ? (
        <div className="border-t border-gray-100 px-4 py-3 bg-white">
          <div className="flex items-end gap-2 max-w-[560px] w-full mx-auto">
            <div className="flex-1 flex items-center gap-2 bg-[#F3F4F6] rounded-2xl px-3 py-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Type your message..."
                className="flex-1 bg-transparent text-[14px] text-[#111827] placeholder:text-[#9CA3AF] outline-none"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-[#E84360] text-white disabled:bg-gray-200 disabled:text-gray-400 active:scale-95 transition-transform"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.11A20.45 20.45 0 0021.5 12 20.45 20.45 0 003.27 20.89L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      ) : fromProcess ? (
        <div className="border-t border-gray-100 px-4 py-3 bg-white">
          <div className="flex items-center justify-center text-[12px] text-[#9CA3AF] font-normal">
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            AI-powered dispute resolution
          </div>
        </div>
      ) : showUploadBar && evidenceStep ? (
        <div className="border-t border-gray-100 px-4 py-3 bg-white">
          <div className="max-w-[560px] w-full mx-auto space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={handlePickFile}
              disabled={!awaitingUpload}
              className="w-full h-10 rounded-md bg-[#E84360] px-4 py-2.5 text-sm font-medium text-white shadow flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h1.5l1.2-2h8.6l1.2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              {EVIDENCE_COPY[evidenceStep].button}
            </button>
            <p className={`text-center text-[12px] font-normal ${uploadError ? "text-[#E84360]" : "text-[#9CA3AF]"}`}>
              {uploadError ?? EVIDENCE_COPY[evidenceStep].hint}
            </p>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 px-4 py-3.5 bg-white">
          <div className="flex items-center justify-center text-[14px] text-[#6B7280]">
            <svg className="w-4 h-4 mr-2 animate-spin text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Launching AI Tribunal...
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <ChatContent />
    </Suspense>
  );
}