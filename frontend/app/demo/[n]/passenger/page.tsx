"use client";

import { useParams } from "next/navigation";
import { PartyTab } from "@/src/components/mobile/PartyTab";

export default function DemoPassengerTab() {
  const { n } = useParams<{ n: string }>();
  return <PartyTab party="passenger" demoId={n} backHref={`/demo/${n}`} />;
}
