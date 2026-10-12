"use client";

import { useParams } from "next/navigation";
import { PartyTab } from "@/src/components/mobile/PartyTab";

export default function DemoDriverTab() {
  const { n } = useParams<{ n: string }>();
  return <PartyTab party="driver" demoId={n} backHref={`/demo/${n}`} />;
}
