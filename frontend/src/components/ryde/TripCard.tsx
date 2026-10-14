"use client";

import type { TripInfo } from "@/src/types/session";
import { useTranslation } from "@/src/hooks/useTranslation";

interface TripCardProps {
  trip: TripInfo;
  variant?: "passenger" | "driver";
}

export default function TripCard({ trip, variant = "passenger" }: TripCardProps) {
  const t = useTranslation();
  const isDriver = variant === "driver";

  const statusColor: Record<string, string> = {
    completed: "text-[#0D9488]",
    cancelled: "text-[#E84360]",
    en_route: "text-[#D97706]",
    pickup: "text-[#D97706]",
    driver_assigned: "text-[#D97706]",
    requested: "text-[#6B7280]",
    idle: "text-[#6B7280]",
  };

  const statusLabel: Record<string, string> = {
    completed: "Completed",
    cancelled: "Cancelled",
    en_route: "En route",
    pickup: "At pickup",
    driver_assigned: "Driver assigned",
    requested: "Requested",
    idle: "Idle",
  };

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
          {t("rydeApp.status")}
        </span>
        <span className={`text-xs font-bold ${statusColor[trip.status] ?? "text-[#6B7280]"}`}>
          {statusLabel[trip.status] ?? trip.status}
        </span>
      </div>

      {/* Locations */}
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0D9488]/10">
            <div className="h-2 w-2 rounded-full bg-[#0D9488]" />
          </div>
          <div>
            <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.pickup")}</p>
            <p className="text-sm font-semibold text-[#111827]">{trip.pickup}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E84360]/10">
            <div className="h-2 w-2 rounded-full bg-[#E84360]" />
          </div>
          <div>
            <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.dropoff")}</p>
            <p className="text-sm font-semibold text-[#111827]">{trip.dropoff}</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-50" />

      {/* Details */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.fare")}</p>
          <p className="text-sm font-bold text-[#111827]">{trip.fare}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.eta")}</p>
          <p className="text-sm font-semibold text-[#111827]">{trip.eta}</p>
        </div>
        {isDriver ? (
          <>
            <div>
              <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.passenger")}</p>
              <p className="text-sm font-semibold text-[#111827]">{trip.passengerName ?? "—"}</p>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.driver")}</p>
              <p className="text-sm font-semibold text-[#111827]">{trip.driverName ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.vehicle")}</p>
              <p className="text-sm font-semibold text-[#111827]">{trip.vehicle ?? "—"}</p>
            </div>
          </>
        )}
        {trip.licensePlate && (
          <div>
            <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.licensePlate")}</p>
            <p className="text-sm font-semibold text-[#111827]">{trip.licensePlate}</p>
          </div>
        )}
      </div>
    </div>
  );
}
