"use client";

/**
 * Help / Topic / [topicId] Page
 */

import { useParams, useRouter } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { IOSListItem } from "@/src/components/IOSListItem";
import { useAuth } from "@/src/context/AuthContext";

interface Topic {
  id: string;
  title: string;
  riderIssues: string[];
  driverIssues: string[];
}

const topics: Record<string, Topic> = {
  popular: {
    id: "popular",
    title: "Popular Topics",
    riderIssues: [
      "How do I report a lost item?",
      "Refund processing times",
      "Driver rating and feedback",
      "Payment method not working",
      "Cancel a booking",
    ],
    driverIssues: [
      "Fares and payout delays",
      "Passenger no-show policy",
      "Toll fee reimbursements",
      "Report passenger behavior",
    ],
  },
  safety: {
    id: "safety",
    title: "Safety & Emergency",
    riderIssues: [
      "Report unsafe driving behavior",
      "Emergency assistance during trip",
      "Harassment or inappropriate conduct",
    ],
    driverIssues: [
      "Report aggressive passenger",
      "Vehicle emergency assistance",
      "Safety policy violation report",
    ],
  },
  fares: {
    id: "fares",
    title: "Fares & Payouts",
    riderIssues: [
      "Why was I charged a cancellation fee?",
      "Surge pricing explanation",
      "Toll charges on my trip",
    ],
    driverIssues: [
      "Weekly payout breakdown",
      "Incentives and bonus calculation",
      "Fare adjustment request",
    ],
  },
};

export default function TopicPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const topicId = params.topicId as string;
  const topic = topics[topicId] || topics.popular;

  const issues = user?.party === "DRIVER" ? topic.driverIssues : topic.riderIssues;

  return (
    <div className="min-h-screen bg-white">
      <IOSHeader title={topic.title} onBack={() => router.push("/help")} />

      <div className="px-5 pt-3 pb-1">
        <p className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-wide">Select Issue</p>
      </div>

      <div>
        {issues.map((issue, idx) => (
          <IOSListItem
            key={idx}
            title={issue}
            onClick={() => router.push(`/help/select-trip?issue=${encodeURIComponent(issue)}`)}
            showDivider={idx < issues.length - 1}
          />
        ))}
      </div>

      <div className="h-8" />
    </div>
  );
}