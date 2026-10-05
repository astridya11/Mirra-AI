"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/src/context/AuthContext";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  showDivider?: boolean;
}

function MenuItem({ icon, label, onClick, showDivider = true }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-5 py-3.5 active:bg-gray-50 transition-colors ${
        showDivider ? "border-b border-gray-100" : ""
      }`}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 flex-shrink-0">
        {icon}
      </div>
      <span className="flex-1 text-left text-[14px] text-[#111827]">{label}</span>
      {/* <svg className="w-4 h-4 text-[#C7C7CC]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg> */}
    </button>
  );
}

export function Drawer({ open, onClose, onNavigate }: DrawerProps) {
  const { user, logout } = useAuth();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const handleLogout = () => {
    if (user) logout();
    onClose();
    onNavigate("/login");
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="absolute top-0 bottom-0 left-0 w-[85%] max-w-[340px] bg-white shadow-xl animate-slide-in-left flex flex-col">
        {/* Profile Header */}
        <div className="px-5 pt-10 pb-10 bg-gradient-to-br from-[#E84360] to-[#DE3557]">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-white text-xl font-bold backdrop-blur-sm uppercase">
              {user ? user.name.charAt(0) : "A"}
            </div>
            <div>
              <p className="text-white text-[15px] font-bold">{user ? user.name : "Guest"}</p>
              <p className="text-white/80 text-[14px] flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="#FFD700" viewBox="0 0 24 24">
                  <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.854.606l-4.782-2.863a.562.562 0 00-.568 0L9.027 21.3a.562.562 0 01-.854-.606l1.285-5.385a.563.563 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                {user?.avg_rating || "5.00"}
              </p>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex-1 overflow-y-auto pt-2">
          <MenuItem
            icon={
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h4.5v7.5h-4.5v-7.5zM6.75 8.25h4.5v7.5h-4.5v-7.5zM11.25 8.25h4.5v7.5h-4.5v-7.5zM15.75 8.25h4.5v7.5h-4.5v-7.5z" />
              </svg>
            }
            label="Payment methods"
            onClick={() => onNavigate("/")}
          />
          <MenuItem
            icon={
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l-1.486 1.486a.75.75 0 01-1.06 0L7.5 14.25m0 0L3 9.75M7.5 14.25V4.5" />
              </svg>
            }
            label="Trips"
            onClick={() => onNavigate("/")}
          />
          <MenuItem
            icon={
              <svg className="w-4 h-4 text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.724.361-1.194.983-1.194 1.666v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            }
            label="RydeHELP"
            onClick={() => onNavigate("/help")}
          />
          <MenuItem
            icon={
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.646.643.826a8.28 8.28 0 01.855.443c.315.187.68.238.987.081l1.174-.56c.485-.232 1.062-.067 1.343.406l1.297 2.246c.282.473.146 1.062-.323 1.343l-1.03.595a1.2 1.2 0 00-.564.813c-.088.428-.136.867-.136 1.306s.048.878.136 1.306a1.2 1.2 0 00.564.813l1.03.595c.469.281.605.87.323 1.343l-1.297 2.246c-.281.473-.858.638-1.343.406l-1.174-.56a1.2 1.2 0 00-.987.081 8.28 8.28 0 01-.855.443c-.33.18-.58.452-.643.826l-.213 1.281c-.09.542-.56.94-1.11.94h-2.593c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.646-.643-.826a8.28 8.28 0 01-.855-.443 1.2 1.2 0 00-.987-.081l-1.174.56c-.485.232-1.062.067-1.343-.406L3.12 14.246c-.282-.473-.146-1.062.323-1.343l1.03-.595a1.2 1.2 0 00.564-.813c.088-.428.136-.867.136-1.306s-.048-.878-.136-1.306a1.2 1.2 0 00-.564-.813l-1.03-.595c-.469-.281-.605-.87-.323-1.343L6.36 4.346c.281-.473.858-.638 1.343-.406l1.174.56c.307.157.672.106.987-.081.271-.156.558-.31.855-.443.33-.18.58-.452.643-.826l.213-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            label="Settings"
            onClick={() => onNavigate("/")}
            showDivider={false}
          />
        </div>

        {/* Bottom Log In/Out Button */}
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full py-2.5 rounded-lg bg-[#E84360] text-[14px] font-semibold text-white hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            {user ? "Log Out" : "Log In"}
          </button>
        </div>
      </div>
    </div>
  );
}