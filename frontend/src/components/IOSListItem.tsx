/**
 * iOSListItem — clean list row with optional chevron, icon, and subtitle.
 * Follows iOS HIG: generous padding, thin divider, right chevron.
 */

import type { ReactNode } from "react";

interface IOSListItemProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  chevron?: boolean;
  onClick?: () => void;
  isDestructive?: boolean;
  showDivider?: boolean;
}

export function IOSListItem({
  icon,
  title,
  subtitle,
  value,
  chevron = true,
  onClick,
  isDestructive = false,
  showDivider = true,
}: IOSListItemProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-5 py-3.5 ${onClick ? "active:bg-gray-50 cursor-pointer" : ""} ${
        showDivider ? "border-b border-gray-100" : ""
      }`}
    >
      {icon && (
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
          isDestructive ? "bg-red-50" : "bg-gray-100"
        }`}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-[14px] ${isDestructive ? "text-red-500" : "text-[#111827]"}`}>
          {title}
        </p>
        {subtitle && (
          <p className="text-[12px] text-[#6B7280] truncate mt-0.5">{subtitle}</p>
        )}
      </div>
      {value && (
        <span className="text-[15px] text-[#6B7280] flex-shrink-0">{value}</span>
      )}
      {chevron && (
        <svg className="w-5 h-5 text-[#C7C7CC] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
}
