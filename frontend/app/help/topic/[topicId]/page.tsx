"use client";

/**
 * Help / Topic / [topicId] Page
 */

import { useParams, useRouter } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { IOSListItem } from "@/src/components/IOSListItem";

interface Topic {
  id: string;
  title: string;
  issues: string[];
}

const topics: Record<string, Topic> = {
  popular: {
    id: "popular",
    title: "Popular Topics",
    issues: [
      "How do I report a lost item?",
      "Refund processing times",
      "Driver rating and feedback",
      "Payment method not working",
      "Cancel a booking",
    ],
  },
  experience: {
    id: "experience",
    title: "Ryde Experience",
    issues: [
      "Track Your Ryde Trips With Apple Live Activity Feature",
      "Driver profile did not match on app",
      "I lost my item.",
      "Driver completed the trip without picking me up",
      "Report issue with pick-up & drop-off location / Route Deviation",
    ],
  },
  safety: {
    id: "safety",
    title: "Safety & Emergency",
    issues: [
      "Report unsafe driving behavior",
      "Emergency assistance during trip",
      "Harassment or inappropriate conduct",
      "Accident during trip",
    ],
  },
  fares: {
    id: "fares",
    title: "Fares and Charges",
    issues: [
      "Why was I charged a cancellation fee?",
      "Surge pricing explanation",
      "Toll charges on my trip",
      "Promo code not applied",
    ],
  },
  "ryde-plus": {
    id: "ryde-plus",
    title: "Ryde+ Subscription",
    issues: [
      "Ryde+ benefits and perks",
      "Manage subscription",
      "Ryde+ free cancellation",
    ],
  },
  cashbacks: {
    id: "cashbacks",
    title: "Ryde Cashbacks & Bonus",
    issues: ["Cashback not received", "Bonus ride credits", "Referral rewards"],
  },
  booking: {
    id: "booking",
    title: "Booking a Ryde",
    issues: ["How to book in advance", "RydePOOL sharing", "Schedule recurring trips"],
  },
  account: {
    id: "account",
    title: "Ryde Account & Privacy",
    issues: ["Update phone number", "Delete account", "Privacy settings", "Verify identity"],
  },
  business: {
    id: "business",
    title: "Ryde for Business",
    issues: ["Corporate billing", "Team management", "Expense reports"],
  },
};

export default function TopicPage() {
  const params = useParams();
  const router = useRouter();
  const topicId = params.topicId as string;
  const topic = topics[topicId] || topics.experience;

  return (
    <div className="min-h-screen bg-white">
      <IOSHeader title={topic.title} onBack={() => router.push("/help")} />

      <div className="px-5 pt-3 pb-1">
        <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide">Select Issue</p>
      </div>

      <div>
        {topic.issues.map((issue, idx) => (
          <IOSListItem
            key={idx}
            title={issue}
            onClick={() => router.push(`/help/select-trip?issue=${encodeURIComponent(issue)}`)}
            showDivider={idx < topic.issues.length - 1}
          />
        ))}
      </div>

      <div className="h-8" />
    </div>
  );
}
