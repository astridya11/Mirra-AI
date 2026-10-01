/**
 * AvatarPlaceholder — circular avatar with initials.
 */

interface AvatarPlaceholderProps {
  name: string;
  party?: "rider" | "driver" | "judge" | "system";
  size?: number;
  className?: string;
}

const partyColors: Record<string, string> = {
  rider: "bg-indigo-100 text-indigo-700",
  driver: "bg-teal-100 text-teal-700",
  judge: "bg-slate-200 text-slate-800",
  system: "bg-slate-100 text-slate-500",
};

export function AvatarPlaceholder({
  name,
  party = "system",
  size = 40,
  className = "",
}: AvatarPlaceholderProps) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`flex items-center justify-center rounded-full font-semibold ${partyColors[party]} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials || "?"}
    </div>
  );
}
