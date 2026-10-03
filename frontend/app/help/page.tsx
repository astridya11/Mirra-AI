"use client";

import { useRouter } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { IOSListItem } from "@/src/components/IOSListItem";
import { useAuth } from "@/src/context/AuthContext";

const riderTopics = [
  { id: "popular", label: "Popular Topics", icon: "flame" },
  { id: "ryde-plus", label: "Ryde+ Subscription", icon: "plus" },
  { id: "safety", label: "Safety & Emergency", icon: "shield" },
  { id: "fares", label: "Fares and Charges", icon: "dollar" },
  { id: "cashbacks", label: "Ryde Cashbacks & Bonus", icon: "gift" },
  { id: "booking", label: "Booking a Ryde", icon: "car" },
  { id: "experience", label: "Ryde Experience", icon: "star" },
  { id: "account", label: "Ryde Account & Privacy", icon: "user" },
];

const driverTopics = [
  { id: "popular", label: "Driver Essentials", icon: "flame" },
  { id: "fares", label: "Earnings & Payouts", icon: "dollar" },
  { id: "experience", label: "Ryde Experience", icon: "star" },
  { id: "safety", label: "Safety & Emergency", icon: "shield" },
  { id: "account", label: "Vehicle & Account", icon: "user" },
];

const supportTopics = [
  { id: "popular", label: "Open Tickets Queue", icon: "flame" },
  { id: "safety", label: "Safety Incidents Review", icon: "shield" },
  { id: "business", label: "Dispute Escalations", icon: "briefcase" },
];

const iconMap: Record<string, string> = {
  flame: "M15.362 5.214A8.252 8.252 0 0112 21a8.25 8.25 0 01-5.362-15.775c.478-.233 1.04.186.865.674a7.07 7.07 0 00-1.012 3.532.75.75 0 01-.75.75c-.474 0-.763-.474-.636-.93a8.25 8.25 0 00-1.49 4.293c-.234 1.59.388 3.162 1.613 4.225.89.773 2.103 1.215 3.364 1.215a3.864 3.864 0 003.864-3.864 3.86 3.86 0 00-1.726-3.224c-.45-.305-.405-.945-.005-1.293z",
  plus: "M12 4.5v15m7.5-7.5h-15",
  shield: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.207-2.571-.598-3.752h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  dollar: "M12 6v12m-3-2.818l.879.58c1.171.781 2.893.781 4.064 0 1.171-.781 1.171-2.548 0-3.329-.727-.485-1.561-.58-2.336-.58-.775 0-1.609.095-2.336.58-1.171.781-1.171 2.548 0 3.329M12 6l.439-.146c1.172-.78 2.894-.78 4.064 0 1.171.781 1.171 2.548 0 3.329-.727.485-1.561.58-2.336.58-.775 0-1.609-.095-2.336-.58M12 6l-.439-.146c-1.171-.78-2.893-.78-4.064 0-1.171.781-1.171 2.548 0 3.329.727.485 1.561.58 2.336.58.775 0 1.609-.095 2.336-.58",
  gift: "M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0-2.625V7.5m0 0v6.75m0 0l3-3m-3 3l-3-3",
  car: "M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.5 1.5 0 01-1.5-1.5V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.013-10.054A1.5 1.5 0 0014.79 6.5H12m-3 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  star: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.854.606l-4.782-2.863a.562.562 0 00-.568 0L9.027 21.3a.562.562 0 01-.854-.606l1.285-5.385a.563.563 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  user: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
  briefcase: "M20.25 14.15v4.298c0 .414-.336.75-.75.75H4.5a.75.75 0 01-.75-.75V14.15M16.5 5.25h-9a1.5 1.5 0 00-1.5 1.5v3H18v-3a1.5 1.5 0 00-1.5-1.5zM18 9.75h-3v1.5h3v-1.5zm-3 0H6v1.5h9v-1.5z",
};

export default function HelpPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Role-based topic selection
  const helpTopics =
    user?.party === "DRIVER"
      ? driverTopics
      : user?.party === "SUPPORT"
      ? supportTopics
      : riderTopics;

  return (
    <div className="min-h-screen bg-white">
      <IOSHeader title="RydeHELP" onBack={() => router.push("/")} />

      {/* Search Bar */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 bg-[#F3F4F6] rounded-lg px-3 py-2.5">
          <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="What can we help you with?"
            className="flex-1 bg-transparent text-[15px] text-[#111827] placeholder:text-[#9CA3AF] outline-none"
          />
        </div>
      </div>

      {/* Section label */}
      <div className="px-5 pt-2 pb-1">
        <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide">Browse by Topic</p>
      </div>

      {/* Topics List */}
      <div>
        {helpTopics.map((topic) => (
          <IOSListItem
            key={topic.id}
            icon={
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={iconMap[topic.icon]} />
              </svg>
            }
            title={topic.label}
            onClick={() => router.push(`/help/topic/${topic.id}`)}
            showDivider={true}
          />
        ))}
      </div>

      <div className="h-8" />
    </div>
  );
}