"use client";

/**
 * Help / Select-trip Page
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { useAuth } from "@/src/context/AuthContext";
import { listPast30DaysTrips } from "@/src/lib/api";
import type { Past30DaysTripListItem } from "@/src/types";

function SelectTripContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const issueType = searchParams.get("issueType") || "Issue Type";

  const [pastTrips, setPastTrips] = useState<Past30DaysTripListItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTrips() {
      try {
        setLoading(true);
        setError(null);

        const result = await listPast30DaysTrips(user!.party_id); 

        if (!cancelled) {
          setPastTrips(result);
        }
      } 
      catch (err) {
        console.error("Failed to load trips:", err);

        if (!cancelled) {
          // setError("Unable to load trips.");
          router.push(`/login`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTrips();

    return () => {
      cancelled = true;
    };
  }, []);

  // Pass caseId, tripId AND the selected issue on to the chat page.
  const goToChat = (tripId: string, driverId: string, riderId: string) => {
    const filedBy = user!.party;
    
    const query = new URLSearchParams({
      tripId,
      driverId,
      riderId,
      filedBy,
      issueType,
    });
    router.push(`/help/chat?${query.toString()}`);
  };

  return (
    <div className="min-h-screen bg-white">
      <IOSHeader
        title="RydeHELP"
        onBack={() => router.push("/help")}
      />

      <div className="px-5 pt-3 pb-2">
        <p className="text-[13px] text-[#111827] font-medium">
          Which Trip?
        </p>

        <p className="text-[12px] text-[#6B7280] mt-0.5">
          Select the trip you have had an issue with from the past 30 days.
        </p>
      </div>

      <div className="px-4 pt-2 space-y-3">
        {loading && (
          <div className="py-8 text-center text-[14px] text-[#6B7280]">
            Loading trips...
          </div>
        )}

        {error && (
          <div className="py-8 text-center text-[14px] text-red-500">
            {error}
          </div>
        )}

        {!loading && !error && pastTrips!.total_trips === 0 && (
          <div className="py-8 text-center text-[14px] text-[#6B7280]">
            You have no trips from the past 30 days!
          </div>
        )}

        {!loading &&
          !error &&
          pastTrips!.trips.map((trip) => {
            const driver = trip.historical_profiles[1];
            const rider = trip.historical_profiles[0];

            return (
              <button
                key={trip.trip_id}
                onClick={() => goToChat(trip.trip_id, driver.party_id!, rider.party_id!)}
                className="w-full text-left rounded-xl border border-gray-200 p-4 active:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-[12px] text-[#6B7280]">
                      {trip.trip_data?.scheduled_time ?? "Unknown time"}
                    </p>

                    <p className="text-[14px] font-semibold text-[#111827] mt-1">
                      {trip.trip_data?.pickup_location?.name ?? "Unknown pickup"}
                      {" → "}
                      {trip.trip_data?.dropoff_location?.name ?? "Unknown dropoff"}
                    </p>
                  </div>

                  <p className="text-[15px] font-bold text-[#111827]">
                    $
                    {trip.payment_fare_data.original_fare.total_fare.toFixed(
                      2
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                  <div className="w-7 h-7 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[11px] font-bold text-[#6B7280]">
                    {driver?.name?.charAt(0) ?? "?"}
                  </div>

                  <span className="text-[14px] text-[#111827]">
                    {driver?.name}
                  </span>
                </div>
              </button>
            );
          })}
      </div>

      <div className="h-8" />
    </div>
  );
}

export default function SelectTripPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <SelectTripContent />
    </Suspense>
  );
}