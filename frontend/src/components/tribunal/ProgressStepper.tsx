/**
 * ProgressStepper — icon-only horizontal stepper for the tribunal process.
 *
 * 6 nodes: Filing → Statements → Investigation → Policy → Verdict → Execution.
 * No visible text labels (accessibility via aria-label / title).
 *
 * States: idle (gray), active (brand color + pulse), done (filled check).
 * Connector lines fill as progress advances.
 *
 * The "Investigation" node optionally shows 3 sub-dots for
 * INITIAL_AUDIT → CROSS_EXAM → FINAL_REPORT.
 */

"use client";

import { memo, type ReactElement } from "react";

export type StepperPhase =
  | "INIT_CLAIM"
  | "ROUND_1_PLEADINGS"
  | "ROUND_2_PROSECUTOR_AUDIT"
  | "POLICY_CONSULTATION"
  | "JUDGE_DELIBERATION"
  | "EXECUTION_ROUTER";

export type StepStatus = "idle" | "active" | "done";

interface ProgressStepperProps {
  currentPhase: StepperPhase;
  completedPhases: Set<StepperPhase>;
  /** Sub-phase progress for the investigation node (0 = none, 1–3 = active sub-step). */
  investigationSubStep?: number;
}

const PHASE_ORDER: StepperPhase[] = [
  "INIT_CLAIM",
  "ROUND_1_PLEADINGS",
  "ROUND_2_PROSECUTOR_AUDIT",
  "POLICY_CONSULTATION",
  "JUDGE_DELIBERATION",
  "EXECUTION_ROUTER",
];

const ARIA_LABELS: Record<StepperPhase, string> = {
  INIT_CLAIM: "Filing",
  ROUND_1_PLEADINGS: "Statements",
  ROUND_2_PROSECUTOR_AUDIT: "Investigation",
  POLICY_CONSULTATION: "Policy review",
  JUDGE_DELIBERATION: "Verdict",
  EXECUTION_ROUTER: "Execution",
};

function getStatus(
  phase: StepperPhase,
  currentPhase: StepperPhase,
  completedPhases: Set<StepperPhase>
): StepStatus {
  if (completedPhases.has(phase)) return "done";
  if (phase === currentPhase) return "active";
  return "idle";
}

// --- Inline SVG icons (24x24, stroke-based, consistent style) ---

function FilingIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6l4 4v14a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z" />
      <path d="M14 2v4h4" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function StatementsIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 8h10M7 12h7" />
      <path d="M17.5 2.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 13.5-13.5z" />
    </svg>
  );
}

function InvestigationIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function PolicyIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v16a1 1 0 001 1h12V5a1 1 0 00-1-1H4z" />
      <path d="M4 4l1-1h12" opacity="0" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}

function VerdictIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v10M8 9l4 4 4-4" />
      <path d="M5 17h14v3H5z" />
    </svg>
  );
}

function ExecutionIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
      <path d="M5 5v14" opacity="0.3" />
    </svg>
  );
}

const PHASE_ICONS: Record<StepperPhase, (p: { className: string }) => ReactElement> = {
  INIT_CLAIM: FilingIcon,
  ROUND_1_PLEADINGS: StatementsIcon,
  ROUND_2_PROSECUTOR_AUDIT: InvestigationIcon,
  POLICY_CONSULTATION: PolicyIcon,
  JUDGE_DELIBERATION: VerdictIcon,
  EXECUTION_ROUTER: ExecutionIcon,
};

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ProgressStepperImpl({
  currentPhase,
  completedPhases,
  investigationSubStep = 0,
}: ProgressStepperProps) {
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);

  return (
    <nav
      aria-label="Dispute resolution progress"
      className="flex items-center w-full px-5 py-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      {PHASE_ORDER.map((phase, i) => {
        const status = getStatus(phase, currentPhase, completedPhases);
        const Icon = PHASE_ICONS[phase];
        const isInvestigation = phase === "ROUND_2_PROSECUTOR_AUDIT";
        const showSubDots =
          isInvestigation &&
          (status === "active" || status === "done") &&
          investigationSubStep > 0;

        return (
          <div
            key={phase}
            className="flex items-center"
            style={{ flex: i < PHASE_ORDER.length - 1 ? "1 1 0" : "0 0 auto" }}
          >
            {/* Node */}
            <div className="flex flex-col items-center gap-1 relative">
              <div
                role="img"
                aria-label={`${ARIA_LABELS[phase]} — ${status}`}
                title={`${ARIA_LABELS[phase]} — ${status}`}
                className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
                  status === "done"
                    ? "bg-[#E84360] text-white"
                    : status === "active"
                    ? "bg-[#FDF1F3] text-[#E84360]"
                    : "bg-[#F3F4F6] text-[#9CA3AF]"
                }`}
              >
                {status === "done" ? (
                  <CheckIcon />
                ) : (
                  <Icon className={status === "active" ? "animate-pulse-dot" : ""} />
                )}
              </div>

              {/* Sub-dots for investigation node */}
              {showSubDots && (
                <div className="flex items-center gap-1 absolute -bottom-1">
                  {[1, 2, 3].map((dot) => (
                    <span
                      key={dot}
                      className={`w-1 h-1 rounded-full transition-colors duration-200 ${
                        dot <= investigationSubStep
                          ? "bg-[#E84360]"
                          : "bg-[#E5E7EB]"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Connector line */}
            {i < PHASE_ORDER.length - 1 && (
              <div className="flex-1 h-0.5 mx-1 bg-[#E5E7EB] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    i < currentIndex ? "bg-[#E84360] w-full" : "w-0"
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export const ProgressStepper = memo(ProgressStepperImpl);
