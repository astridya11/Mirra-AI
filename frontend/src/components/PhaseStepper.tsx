/**
 * PhaseStepper — horizontal progress stepper for the 4 tribunal phases.
 */

interface PhaseStepperProps {
  currentPhase: string;
  className?: string;
}

const phases = [
  { id: "ROUND_1_PLEADINGS", label: "Pleadings", order: 1 },
  { id: "ROUND_2_PROSECUTOR_AUDIT", label: "Prosecutor Audit", order: 2 },
  { id: "POLICY_CONSULTATION", label: "Policy Lookup", order: 3 },
  { id: "JUDGE_DELIBERATION", label: "Judge Verdict", order: 4 },
];

const phaseOrder: Record<string, number> = {
  INIT_CLAIM: 0,
  ROUND_1_PLEADINGS: 1,
  ROUND_2_PROSECUTOR_AUDIT: 2,
  POLICY_CONSULTATION: 3,
  JUDGE_DELIBERATION: 4,
  EXECUTION_ROUTER: 4,
};

export function PhaseStepper({ currentPhase, className = "" }: PhaseStepperProps) {
  const currentOrder = phaseOrder[currentPhase] ?? 0;

  return (
    <div className={`flex items-center gap-1 sm:gap-2 ${className}`}>
      {phases.map((phase, idx) => {
        const isActive = currentOrder === phase.order;
        const isCompleted = currentOrder > phase.order;
        return (
          <div key={phase.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-300
                  ${isActive ? "bg-brand-green text-white ring-4 ring-brand-green/20 scale-110" : ""}
                  ${isCompleted ? "bg-brand-green/20 text-brand-green" : ""}
                  ${!isActive && !isCompleted ? "bg-slate-100 text-slate-400" : ""}
                `}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-9" />
                  </svg>
                ) : (
                  phase.order
                )}
              </div>
              <span
                className={`text-[10px] sm:text-xs font-medium text-center leading-tight ${
                  isActive ? "text-slate-900" : isCompleted ? "text-slate-600" : "text-slate-400"
                }`}
              >
                {phase.label}
              </span>
            </div>
            {idx < phases.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-1 rounded-full transition-all duration-300 ${
                  currentOrder > phase.order ? "bg-brand-green" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
