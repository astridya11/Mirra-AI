import type { PresenterStep } from "./PresenterGuide";

export const presenterSteps: Record<
  string,
  Record<string, PresenterStep>
> = {
  "1": {
    trip: {
      say: "A passenger has completed a trip from Marina Bay Sands to Jewel Changi Airport. The fare is S$24.50.",
      watch: "Both Passenger and Driver see the same trip summary.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No dispute is visible yet.",
      next: "Open Private MIRRA on the Passenger side.",
    },
    private_support: {
      say: "The passenger is currently asking MIRRA for help privately. This is not yet a formal complaint.",
      watch: "The Driver App remains unchanged.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No dispute is visible to the Driver yet.",
      next: "Submit the formal complaint.",
    },
    formal_filed: {
      say: "The passenger has now filed a formal complaint. The shared dispute state is visible to both parties.",
      watch: "Both apps now show the formal complaint banner.",
      proves: "The boundary between private support and formal dispute is explicit.",
      expected: "Driver sees 'Dispute received' with the claim category.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal is now in session. Evidence is frozen. No new evidence can be added.",
      watch: "The Tribunal Board shows agents processing evidence, policy and cross-examination.",
      proves: "MIRRA enforces evidence freeze and structured deliberation.",
      expected: "Agent timeline progresses from Pending to Complete.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "The AI Judge has reached a decision: partial refund of S$3.25. The Execution Router has automated the outcome.",
      watch: "Both parties see the same underlying ruling, expressed in role-appropriate language.",
      proves: "MIRRA can safely automate low-risk, evidence-backed financial outcomes.",
      expected: "Passenger sees 'S$3.25 refund'. Driver sees 'S$3.25 refund issued to rider'.",
      next: "Request Human Review if desired, or reset and replay.",
    },
  },
  "2": {
    trip: {
      say: "A ride from Orchard Road to Tampines Mall was cancelled. A S$5 no-show fee was applied.",
      watch: "Both Passenger and Driver see the cancelled trip with the fee.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No dispute is visible yet.",
      next: "Open Private MIRRA on the Passenger side.",
    },
    private_support: {
      say: "The passenger privately asks MIRRA about the cancellation fee. MIRRA reviews the waiting timeline.",
      watch: "The Driver App remains unchanged.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No dispute is visible to the Driver yet.",
      next: "Submit the formal complaint.",
    },
    formal_filed: {
      say: "The passenger has filed a formal dispute. Both parties now see the shared claim.",
      watch: "Both apps show the formal complaint banner.",
      proves: "The boundary between private support and formal dispute is explicit.",
      expected: "Driver sees 'Dispute received'.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal reviews driver arrival time, notifications and waiting timer.",
      watch: "The Tribunal Board processes evidence and policy.",
      proves: "MIRRA evaluates current-case evidence, not just who complained.",
      expected: "Evidence audit confirms driver followed procedure.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "The AI Judge decided: No refund. The driver followed procedure and the fee is valid.",
      watch: "Both parties see the same ruling in role-appropriate language.",
      proves: "MIRRA does not automatically side with the complainant.",
      expected: "Passenger sees 'No refund'. Driver sees 'No refund issued'.",
      next: "Request Human Review if desired, or reset and replay.",
    },
  },
  "3": {
    trip: {
      say: "A driver submits a S$100 cleaning fee claim after a trip from Clarke Quay to Sentosa Cove.",
      watch: "Both Passenger and Driver see the trip with the extra charge.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No dispute is visible yet.",
      next: "Open Private MIRRA on the Driver side.",
    },
    private_support: {
      say: "The driver privately asks MIRRA about the cleaning fee claim. MIRRA explains evidence requirements.",
      watch: "The Passenger App remains unchanged.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No dispute is visible to the Passenger yet.",
      next: "Driver files formal complaint with evidence.",
    },
    formal_filed: {
      say: "The driver has filed a formal cleaning-fee claim. Both parties now see the shared dispute.",
      watch: "Both apps show the formal complaint banner.",
      proves: "The boundary between private support and formal dispute is explicit.",
      expected: "Passenger sees 'Dispute received'.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal examines photo, receipt, EXIF and OCR. Fraud signals are detected.",
      watch: "The Tribunal Board shows disputed evidence and high fraud risk.",
      proves: "MIRRA understands when evidence is insufficient or suspicious.",
      expected: "Photo shows reuse risk. Receipt is valid but amount differs from claim.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "The AI Judge stopped automation. Human review is required due to insufficient and suspicious evidence.",
      watch: "Both parties see the same escalation outcome.",
      proves: "MIRRA knows when NOT to automate.",
      expected: "Passenger sees 'Under human review — no fee charged'. Driver sees 'Under human review — no payout'.",
      next: "Open Human Review, or reset and replay.",
    },
  },
};

export function getPresenterStep(demoId: string, stage: string): PresenterStep | undefined {
  return presenterSteps[demoId]?.[stage];
}
