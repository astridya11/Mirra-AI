/**
 * DisputeTypeIcon — simple SVG icon per dispute type.
 */

import type { DisputeType } from "@/src/types";

interface DisputeTypeIconProps {
  type: DisputeType;
  className?: string;
}

const iconPaths: Record<DisputeType, string> = {
  ROUTE_DEVIATION: "M9 20l-5.4-2.7a2 2 0 0 1-1.1-1.8V5a2 2 0 0 1 2.6-1.9L9 3.5m0 16.5V3.5m0 16.5l6-3m-6 3l6 3m0-16.5L9 3.5m6 0L21 5m-6-1.5v17m6-15.5v13.5l-6 3m6-16.5L9 3.5",
  NO_SHOW_CHARGE: "M12 9v3.75m-9.303 3.376c-.866 1.5.218 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
  CLEANING_FEE: "M9.75 3.104v5.914a.75.75 0 0 1-.399.668L4.5 12v6.75a.75.75 0 0 0 .75.75h13.5a.75.75 0 0 0 .75-.75V12l-4.851-2.314a.75.75 0 0 1-.399-.668V3.104a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75Z",
  SAFETY_ALERT: "M12 9v3.75m-9.303 3.376c-.866 1.5.218 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
};

export function DisputeTypeIcon({ type, className = "" }: DisputeTypeIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={iconPaths[type]} />
    </svg>
  );
}

export function disputeTypeLabel(type: DisputeType): string {
  const labels: Record<DisputeType, string> = {
    ROUTE_DEVIATION: "Route Deviation",
    NO_SHOW_CHARGE: "No-Show Charge",
    CLEANING_FEE: "Cleaning Fee",
    SAFETY_ALERT: "Safety / Behavior",
  };
  return labels[type] || type;
}
