/**
 * ConfidenceMeter — radial gauge showing AI confidence percentage.
 */

interface ConfidenceMeterProps {
  score: number; // 0.0 - 1.0
  size?: number;
  className?: string;
}

export function ConfidenceMeter({ score, size = 120, className = "" }: ConfidenceMeterProps) {
  const percentage = Math.round(score * 100);
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score * circumference);

  const color = score >= 0.75 ? "#00b14f" : score >= 0.5 ? "#d97706" : "#dc2626";

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={8}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{percentage}%</span>
        <span className="text-xs text-slate-400 font-medium">AI Confidence</span>
      </div>
    </div>
  );
}
