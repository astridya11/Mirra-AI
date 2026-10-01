/**
 * Placeholder component — neutral gray block with rounded corners and centered label.
 * Used in place of real images, maps, and photos.
 */

interface PlaceholderProps {
  name: string;
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function Placeholder({
  name,
  width = "100%",
  height = 150,
  className = "",
}: PlaceholderProps) {
  const w = typeof width === "number" ? `${width}px` : width;
  const h = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-slate-100 border border-slate-200 text-slate-400 text-xs font-medium ${className}`}
      style={{ width: w, height: h, minHeight: h }}
    >
      <span className="text-center px-2">{name}</span>
    </div>
  );
}
