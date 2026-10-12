/**
 * ConfidenceMeter — radial gauge showing AI confidence percentage.
 *
 * Colours: >= 0.75 emerald-600, 0.5–0.74 amber-500, < 0.5 red-600.
 * A small tick on the ring marks the 75% auto-execution threshold.
 * Respects prefers-reduced-motion (no stroke animation).
 */

interface ConfidenceMeterProps {
  score: number; // 0.0 - 1.0
  size?: number; // default 64
  showLabel?: boolean; // default false
  /** Caption text (implies showLabel); defaults to "AI confidence". */
  label?: string;
  className?: string;
}

const THRESHOLD = 0.75;

export function ConfidenceMeter({
  score,
  size = 64,
  showLabel = false,
  label,
  className = "",
}: ConfidenceMeterProps) {
  const percentage = Math.round(score * 100);
  const thresholdPct = Math.round(THRESHOLD * 100);
  const stroke = Math.max(3, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - score * circumference;

  const color =
    score >= THRESHOLD ? "#059669" : score >= 0.5 ? "#F59E0B" : "#DC2626";

  // Tick mark at the 75% threshold position on the ring.
  // The arc starts at the top (12 o'clock) because the SVG is rotated -90°.
  // Tick angle measured clockwise from top: threshold * 360 degrees.
  const tickAngle = THRESHOLD * 360;
  const tickRad = (tickAngle * Math.PI) / 180;
  const tickInner = radius - stroke / 2 - 1;
  const tickOuter = radius + stroke / 2 + 1;
  const cx = size / 2;
  const cy = size / 2;
  // After the -90° rotation on the parent <svg>, angle 0 = top.
  // In unrotated coordinates, top = -90°, so we offset by -90°.
  const x1 = cx + tickInner * Math.cos(tickRad - Math.PI / 2);
  const y1 = cy + tickInner * Math.sin(tickRad - Math.PI / 2);
  const x2 = cx + tickOuter * Math.cos(tickRad - Math.PI / 2);
  const y2 = cy + tickOuter * Math.sin(tickRad - Math.PI / 2);

  const fontSize = Math.round(size / 3.5);

  const ariaLabel = `Verdict confidence ${percentage} percent; ${thresholdPct} percent needed to act without a human`;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: "stroke-dashoffset 0.8s ease-out",
          }}
        />
        {/* Threshold tick at 75% */}
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#6B7280"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums leading-none"
          style={{ fontSize, color }}
        >
          {percentage}%
        </span>
        {(showLabel || label) && (
          <span
            className="text-[#6B7280] font-medium leading-none mt-0.5"
            style={{ fontSize: Math.max(8, Math.round(size / 7)) }}
          >
            {label ?? "AI confidence"}
          </span>
        )}
      </div>
    </div>
  );
}
