"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/src/components/Drawer";
import { useAuth } from "@/src/context/AuthContext";

export default function Home() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="relative min-h-screen bg-white overflow-hidden">
      {/* Simulated Map Background */}
      <div className="absolute inset-0">
        <div
          className="w-full h-full"
          style={{
            background: `
              linear-gradient(135deg, #E8F0E3 0%, #D4E4D0 50%, #C8DCC4 100%)
            `,
          }}
        >
          {/* Grid lines to simulate map streets */}
          <svg className="w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#94A389" strokeWidth="0.5" />
              </pattern>
              <pattern id="grid-large" width="180" height="180" patternUnits="userSpaceOnUse">
                <path d="M 180 0 L 0 0 0 180" fill="none" stroke="#7A8B75" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <rect width="100%" height="100%" fill="url(#grid-large)" />
          </svg>
          {/* Simulated roads */}
          <div className="absolute top-[35%] left-0 right-0 h-3 bg-[#D4C9A8] -rotate-12" />
          <div className="absolute top-[60%] left-0 right-0 h-2.5 bg-[#D4C9A8] rotate-6" />
          <div className="absolute top-0 bottom-0 left-[40%] w-3 bg-[#D4C9A8] rotate-3" />
          <div className="absolute top-0 bottom-0 left-[70%] w-2.5 bg-[#D4C9A8] -rotate-6" />

          {/* Pickup pin */}
          <div className="absolute top-[30%] left-[35%]">
            <div className="relative">
              <div className="w-4 h-4 rounded-full bg-[#0D9488] ring-4 ring-white shadow-md" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-[#0D9488]" />
            </div>
          </div>
          {/* Dropoff pin */}
          <div className="absolute top-[65%] left-[68%]">
            <div className="w-4 h-4 rounded-full bg-[#E84360] ring-4 ring-white shadow-md flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          </div>
          {/* Route line */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
            <path
              d="M 35% 30% Q 50% 45%, 68% 65%"
              fill="none"
              stroke="#E84360"
              strokeWidth="3"
              strokeDasharray="6 4"
            />
          </svg>
        </div>
      </div>

      {/* Top Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 px-4 pt-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-sm active:scale-95 transition-transform"
          >
            <svg className="w-5 h-5 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <button className="flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-sm active:scale-95 transition-transform">
              <svg className="w-5 h-5 text-[#111827]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </button>
            
            {/* Dynamic User Avatar */}
            <button
              onClick={() => (user ? setDrawerOpen(true) : router.push("/login"))}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E84360] to-[#DE3557] flex items-center justify-center text-white text-sm font-bold shadow-sm"
            >
              {user ? user.name.charAt(0).toUpperCase() : "A"}
            </button>
          </div>
        </div>
      </header>

      {/* Bottom Booking Card */}
      <div className="absolute bottom-0 left-0 right-0 z-20 animate-slide-up">
        <div className="bg-white rounded-t-3xl px-5 pt-4 pb-8 shadow-[0_-2px_20px_rgba(0,0,0,0.08)]">
          {/* Grab handle */}
          <div className="flex justify-center mb-4">
            <div className="w-9 h-1 rounded-full bg-gray-200" />
          </div>

          {/* Tab selector */}
          <div className="flex bg-[#F3F4F6] rounded-lg p-1 mb-4">
            <button className="flex-1 py-2 rounded-md text-[14px] font-semibold bg-white text-[#111827] shadow-sm">
              Ryde
            </button>
            <button className="flex-1 py-2 rounded-md text-[14px] font-medium text-[#6B7280]">
              RydePOOL
            </button>
            <button className="flex-1 py-2 rounded-md text-[14px] font-medium text-[#6B7280]">
              RydeXL
            </button>
          </div>

          {/* Pickup location */}
          <button className="w-full flex items-center gap-3 py-3 border-b border-gray-100">
            <div className="w-2.5 h-2.5 rounded-full bg-[#0D9488] flex-shrink-0" />
            <span className="flex-1 text-left text-[15px] text-[#111827]">Marina Bay Sands</span>
            <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {/* Dropoff location */}
          <button className="w-full flex items-center gap-3 py-3 border-b border-gray-100">
            <div className="w-2.5 h-2.5 rounded-full bg-[#E84360] flex-shrink-0" />
            <span className="flex-1 text-left text-[15px] text-[#111827]">Jewel Changi Airport</span>
            <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Fare estimate */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-[13px] text-[#6B7280]">Estimated Fare</p>
              <p className="text-[22px] font-bold text-[#111827]">$24.50 <span className="text-[14px] font-normal text-[#6B7280]">SGD</span></p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-[#6B7280]">ETA</p>
              <p className="text-[15px] font-semibold text-[#111827]">18 min</p>
            </div>
          </div>

          {/* Book button */}
          <button className="w-full py-3.5 rounded-xl bg-[#E84360] text-white text-[17px] font-semibold active:bg-[#DE3557] transition-colors">
            Book Ryde
          </button>
        </div>
      </div>

      {/* Drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={(path) => router.push(path)} />
    </div>
  );
}
