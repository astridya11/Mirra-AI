"use client";

import { useParams } from "next/navigation";
import PartyPage from "@/src/components/demo/PartyPage";
import type { DemoId } from "@/src/types/session";

export default function DemoPassengerPage() {
  const { id } = useParams<{ id: string }>();
  return <PartyPage demoId={id as DemoId} party="passenger" />;
}
