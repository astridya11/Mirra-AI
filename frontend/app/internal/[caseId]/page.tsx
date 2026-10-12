"use client";

import { useParams } from "next/navigation";
import { InternalConsole } from "@/src/components/internal/InternalConsole";

export default function InternalConsolePage() {
  const { caseId } = useParams<{ caseId: string }>();
  return <InternalConsole caseId={caseId} />;
}
