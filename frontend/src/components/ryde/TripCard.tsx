"use client";

import type { TripInfo } from "@/src/types/session";
import { useI18n } from "@/src/context/I18nContext";

interface TripCardProps {
  trip: TripInfo;
  variant?: "passenger" | "driver";
}

/** Trip summary in the Ryde app style (presentation after the prototype PassengerApp / DriverApp). */
export default function TripCard({ trip, variant = "passenger" }: TripCardProps) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const cancelled = trip.status === "cancelled";
  const other = variant === "passenger" ? trip.driverName : trip.passengerName;
  const otherSub =
    variant === "passenger"
      ? [trip.vehicle, trip.licensePlate].filter(Boolean).join(" · ")
      : zh
      ? "乘客"
      : "Passenger";

  return (
    <div className="rounded-2xl bg-white border border-line p-3 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          {cancelled ? (zh ? "行程已取消" : "Trip cancelled") : zh ? "行程已完成" : "Trip completed"}
        </p>
        <span
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
            cancelled ? "text-warn bg-amber-50" : "text-ok bg-green-50"
          }`}
        >
          {cancelled ? (zh ? "已收取未到场费" : "No-show fee") : zh ? "已支付" : "Paid"}
        </span>
      </div>
      <div className="space-y-1.5 text-xs">
        <p className="flex items-center gap-2 text-body">
          <span className="h-2 w-2 rounded-full bg-ink shrink-0" />
          <span className="truncate">{trip.pickup}</span>
        </p>
        <p className="flex items-center gap-2 text-body">
          <span className="h-2 w-2 rounded-full bg-mirra shrink-0" />
          <span className="truncate">{trip.dropoff}</span>
        </p>
      </div>
      {other && (
        <div className="flex items-center gap-3">
          <span
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              variant === "passenger" ? "bg-blue-50 text-info" : "bg-mirra-soft text-mirra"
            }`}
          >
            {other
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{other}</p>
            <p className="text-[11px] text-muted truncate">{otherSub}</p>
          </div>
        </div>
      )}
      <div className="border-t border-line pt-2 flex justify-between text-sm font-bold text-ink">
        <span>{cancelled ? (zh ? "费用" : "Charged") : zh ? "车费" : "Fare"}</span>
        <span>{trip.fare}</span>
      </div>
    </div>
  );
}
