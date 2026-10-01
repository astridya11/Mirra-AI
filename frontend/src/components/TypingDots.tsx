/**
 * ProgressDots — iOS-style typing indicator with animated dots.
 */

export function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]"
          style={{
            animation: "typing-bounce 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * LiveDot — pulsing red/green dot for live status.
 */
export function LiveDot({ color = "#E84360" }: { color?: string }) {
  return (
    <span className="relative inline-flex w-2 h-2">
      <span
        className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-pulse-dot"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex rounded-full w-2 h-2"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}
