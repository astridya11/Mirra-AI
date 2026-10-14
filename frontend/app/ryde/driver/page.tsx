"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RydeApp from "@/src/components/ryde/RydeApp";
import type { DemoId } from "@/src/types/session";

function DriverContent() {
  const searchParams = useSearchParams();
  const demo = (searchParams.get("demo") ?? "1") as DemoId;
  const session = searchParams.get("session") ?? "default-driver";

  return <RydeApp demoId={demo} sessionId={session} party="driver" />;
}

export default function DriverPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-sm text-[#9CA3AF]">Loading...</div>
        </div>
      }
    >
      <DriverContent />
    </Suspense>
  );
}
