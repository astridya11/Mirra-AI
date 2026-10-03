"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/context/AuthContext";
import { UserRole } from "@/src/types";

export default function SignUpPage() {
  const router = useRouter();
  const { signup } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [party, setParty] = useState<UserRole>("RIDER");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const success = await signup({ name, email, password, party });
      if (success) {
        router.push("/");
      } else {
        setError("Invalid email or password. Please try again.");
      }
    } catch (err) {
      setError("An unexpected error occurred during signup.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white px-6 pt-12 pb-6 flex flex-col justify-between max-w-md mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Create Account</h1>
        <p className="text-sm text-[#6B7280] mb-6">Select your role and sign up for Ryde</p>

        {error && <div className="mb-4 text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Account Role</label>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value as UserRole)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[15px] font-medium text-[#111827] focus:outline-none focus:border-[#E84360]"
            >
              <option value="RIDER">Rider</option>
              <option value="DRIVER">Driver</option>
              <option value="SUPPORT">Support</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#E84360] text-[15px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#E84360] text-[15px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-[#E84360] text-[15px]"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#E84360] px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-800 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? "Signing up..." : "Sign up"}
          </button>
        </form>
      </div>

      <div className="text-center pt-4">
        <p className="text-sm text-[#6B7280]">
          Already have an account?{" "}
          <button onClick={() => router.push("/login")} className="text-[#E84360] font-semibold underline">
            Log In
          </button>
        </p>
      </div>
    </div>
  );
}