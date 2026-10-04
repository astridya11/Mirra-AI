"use client";

import { useParams, useRouter } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { IOSListItem } from "@/src/components/IOSListItem";
import { useAuth } from "@/src/context/AuthContext";
import { DisputeType } from "@/src/types";

export interface IssueItem {
  id: string;
  label: string;
  issue_type: DisputeType;
}

export interface Topic {
  id: string;
  title: string;
  riderIssues: IssueItem[];
  driverIssues: IssueItem[];
}

const topics: Record<string, Topic> = {
  popular: {
    id: "popular",
    title: "Popular Topics",
    riderIssues: [
      { id: "p1", label: "How do I report a lost item?", issue_type: "LOST_ITEM" },
      { id: "p2", label: "Driver took a longer or unexpected route", issue_type: "ROUTE_DEVIATION" },
      { id: "p3", label: "Incorrect fare or unexpected charges", issue_type: "FARE_DISPUTE" },
      { id: "p4", label: "Refund status and processing times", issue_type: "REFUND_REQUEST" },
      { id: "p5", label: "Cancel a booking or wrong charge", issue_type: "CANCELLED_BOOKING" },
    ],
    driverIssues: [
      { id: "dp1", label: "Passenger no-show charge request", issue_type: "NO_SHOW_CHARGE" },
      { id: "dp2", label: "Vehicle cleaning or mess fee", issue_type: "CLEANING_FEE" },
      { id: "dp3", label: "Earnings and weekly payout delays", issue_type: "PAYOUT_DELAY" },
      { id: "dp4", label: "Toll fee reimbursements", issue_type: "TOLL_REIMBURSEMENT" },
      { id: "dp5", label: "Report passenger behavior or incident", issue_type: "PASSENGER_CONDUCT" },
    ],
  },
  safety: {
    id: "safety",
    title: "Safety & Emergency",
    riderIssues: [
      { id: "s1", label: "Emergency assistance during trip", issue_type: "SAFETY_ALERT" },
      { id: "s2", label: "Report unsafe or reckless driving", issue_type: "UNSAFE_DRIVING" },
      { id: "s3", label: "Harassment or inappropriate conduct", issue_type: "HARASSMENT" },
      { id: "s4", label: "Vehicle accident or collision report", issue_type: "VEHICLE_ACCIDENT" },
    ],
    driverIssues: [
      { id: "ds1", label: "Emergency assistance during trip", issue_type: "SAFETY_ALERT" },
      { id: "ds2", label: "Report aggressive or abusive passenger", issue_type: "PASSENGER_CONDUCT" },
      { id: "ds3", label: "Vehicle accident or emergency report", issue_type: "VEHICLE_ACCIDENT" },
    ],
  },
  fares: {
    id: "fares",
    title: "Fares & Payouts",
    riderIssues: [
      { id: "f1", label: "Why was I charged a cancellation fee?", issue_type: "NO_SHOW_CHARGE" },
      { id: "f2", label: "Dispute incorrect fare or route taken", issue_type: "ROUTE_DEVIATION" },
      { id: "f3", label: "Surge pricing explanation", issue_type: "SURGE_PRICING" },
      { id: "f4", label: "Toll fee charges on my receipt", issue_type: "TOLL_REIMBURSEMENT" },
    ],
    driverIssues: [
      { id: "df1", label: "Weekly payout breakdown", issue_type: "PAYOUT_DELAY" },
      { id: "df2", label: "Incentives and bonus calculation", issue_type: "BONUS_INCENTIVE" },
      { id: "df3", label: "Fare adjustment or missing payment", issue_type: "FARE_DISPUTE" },
      { id: "df4", label: "Request cleaning / damage reimbursement", issue_type: "CLEANING_FEE" },
    ],
  },
  "ryde-plus": {
    id: "ryde-plus",
    title: "Ryde+ Subscription",
    riderIssues: [
      { id: "rp1", label: "Subscription billing issue or duplicate charge", issue_type: "SUBSCRIPTION_BILLING" },
      { id: "rp2", label: "Ryde+ perks not applied to trip", issue_type: "CASHBACK_PROMO" },
      { id: "rp3", label: "Cancel Ryde+ membership", issue_type: "SUBSCRIPTION_BILLING" },
    ],
    driverIssues: [
      { id: "drp1", label: "Ryde+ driver priority perks", issue_type: "BONUS_INCENTIVE" },
    ],
  },
  cashbacks: {
    id: "cashbacks",
    title: "Ryde Cashbacks & Bonus",
    riderIssues: [
      { id: "c1", label: "Missing cashback after trip completion", issue_type: "CASHBACK_PROMO" },
      { id: "c2", label: "Promo code or voucher failed to apply", issue_type: "PAYMENT_FAILED" },
    ],
    driverIssues: [
      { id: "dc1", label: "Referral bonus not credited", issue_type: "BONUS_INCENTIVE" },
    ],
  },
  booking: {
    id: "booking",
    title: "Booking a Ryde",
    riderIssues: [
      { id: "b1", label: "Driver did not arrive or picked up wrong person", issue_type: "NO_SHOW_CHARGE" },
      { id: "b2", label: "Scheduled trip booking error", issue_type: "CANCELLED_BOOKING" },
    ],
    driverIssues: [
      { id: "db1", label: "Unable to accept dispatch request", issue_type: "PAYMENT_FAILED" },
    ],
  },
  experience: {
    id: "experience",
    title: "Ryde Experience",
    riderIssues: [
      { id: "e1", label: "Poor vehicle condition or cleanliness", issue_type: "CLEANING_FEE" },
      { id: "e2", label: "Driver rating and feedback review", issue_type: "DRIVER_RATING" },
    ],
    driverIssues: [
      { id: "de1", label: "Unfair rider rating review request", issue_type: "PASSENGER_CONDUCT" },
    ],
  },
  account: {
    id: "account",
    title: "Ryde Account & Privacy",
    riderIssues: [
      { id: "a1", label: "Payment method failing or declined", issue_type: "PAYMENT_FAILED" },
      { id: "a2", label: "Account profile and privacy settings", issue_type: "ACCOUNT_PRIVACY" },
    ],
    driverIssues: [
      { id: "da1", label: "Vehicle registration / document pending approval", issue_type: "VEHICLE_DOCUMENTATION" },
      { id: "da2", label: "Update payout bank account details", issue_type: "PAYOUT_DELAY" },
    ],
  },
  business: {
    id: "business",
    title: "Dispute Escalations",
    riderIssues: [
      { id: "bus1", label: "Escalate unresolved dispute", issue_type: "DISPUTE_ESCALATION" },
    ],
    driverIssues: [
      { id: "dbus1", label: "Escalate unpaid fare dispute", issue_type: "DISPUTE_ESCALATION" },
    ],
  },
};

export default function TopicPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const topicId = params.topicId as string;

  // Fall back to popular if topicId isn't found
  const topic = topics[topicId] || topics.popular;

  const issues = user?.party === "DRIVER" ? topic.driverIssues : topic.riderIssues;

  const handleSelectIssue = (issue: IssueItem) => {
    // Pass the issue_type to the next step
    router.push(
      `/help/select-trip?issueType=${encodeURIComponent(issue.issue_type)}`
    );
  };

  return (
    <div className="min-h-screen bg-white">
      <IOSHeader title={topic.title} onBack={() => router.push("/help")} />

      <div>
        {issues.map((issue, idx) => (
          <IOSListItem
            key={issue.id}
            title={issue.label}
            onClick={() => handleSelectIssue(issue)}
            showDivider={idx < issues.length - 1}
          />
        ))}
      </div>

      <div className="h-8" />
    </div>
  );
}