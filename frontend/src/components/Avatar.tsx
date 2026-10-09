"use client";

import { useState } from "react";

export type AvatarType = "bot" | "user" | "driver" | "rider" | "prosecutor" | "policy" | "judge";

interface AvatarProps {
  type?: AvatarType;
  speaker?: string;
}

export function Avatar({ type, speaker, }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  const s = speaker?.toUpperCase();

  let avatarSrc = "/avatars/bot.png";
  let initials = "M";
  let bgClass = "bg-gray-100";
  let textClass = "text-gray-600";

  if (type === "user" || s?.includes("RIDER")) {
    avatarSrc = "/avatars/rider.png";
    initials = "U";
    bgClass = "bg-[#FDF1F3]";
    textClass = "text-[#E84360]";
  } else if (s?.includes("DRIVER")) {
    avatarSrc = "/avatars/driver.png";
    initials = "DA";
    bgClass = "bg-gray-100";
    textClass = "text-[#0D9488]";
  } else if (s?.includes("PROSECUTOR")) {
    avatarSrc = "/avatars/prosecutor.png";
    initials = "PR";
    bgClass = "bg-[#FFF7ED]";
    textClass = "text-[#D97706]";
  } else if (s?.includes("POLICY")) {
    avatarSrc = "/avatars/policy.png";
    initials = "PA";
    bgClass = "bg-emerald-50";
    textClass = "text-emerald-700";
  } else if (s?.includes("JUDGE")) {
    avatarSrc = "/avatars/judge.png";
    initials = "JG";
    bgClass = "bg-[#EEF2FF]";
    textClass = "text-[#4338CA]";
  } else if (type === "bot" || s?.includes("MIORA") || s?.includes("BOT")) {
    avatarSrc = "/avatars/bot.png";
    initials = "M";
    bgClass = "bg-[#FDF1F3]";
    textClass = "text-[#E84360]"
  } else {
    initials = s?.split(/[\s_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "AG";
  }

  // 图片错误退回 (Fallback)
  if (imgError) {
    return (
      <div
        className={`w-8 h-8 rounded-full ${bgClass} flex items-center justify-center flex-shrink-0`}
      >
        <span className={`text-[10px] font-bold ${textClass}`}>{initials}</span>
      </div>
    );
  }

  return (
    <div
      className={`w-8 h-8 ${bgClass} rounded-full flex-shrink-0 overflow-hidden`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarSrc}
        alt={speaker}
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    </div>
  );
}