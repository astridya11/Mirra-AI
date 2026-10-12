"use client";

import { useParams } from "next/navigation";
import { GuidedDemo } from "@/src/components/showcase/GuidedDemo";

export default function GuidedDemoPage() {
  const { n } = useParams<{ n: string }>();
  return <GuidedDemo n={n} />;
}
