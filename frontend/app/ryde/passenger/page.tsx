"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RydeApp from "@/src/components/ryde/RydeApp";
import type { DemoId } from "@/src/types/session";

function PassengerContent() {
  const searchParams = useSearchParams();
  const demo = (searchParams.get("demo") ?? "1") as DemoId;
  const session = searchParams.get("session") ?? "default-passenger";

  return <RydeApp demoId={demo} sessionId={session} party="passenger" />;
}

export default function PassengerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-sm text-[#9CA3AF]">Loading...</div>
        </div>
      }
    >
      <PassengerContent />
    </Suspense>
  );
}
