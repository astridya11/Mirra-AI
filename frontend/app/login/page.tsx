"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/src/context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const success = await login(email, password);
      if (success) {
        router.push("/");
      } else {
        setError("Invalid email or password. Please try again.");
      }
    } catch (err) {
      setError("An unexpected error occurred during login.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white px-6 pt-12 pb-6 flex flex-col justify-between max-w-md mx-auto">
        <div>
            <h1 className="text-2xl font-bold text-[#111827] mb-2">Welcome Back</h1>
            <p className="text-sm text-[#6B7280] mb-6">Log in to access your Ryde account</p>

            {error && <div className="mb-4 text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="email-address" className="block text-xs font-semibold text-slate-700 mb-1">
                        Email
                    </label>
                    <input
                        id="email-address"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800"
                        placeholder="rider@ryde.com"
                    />
                </div>
                <div>
                    <label htmlFor="password" className="block text-xs font-medium text-slate-700 mb-1">
                        Password
                    </label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800"
                        placeholder="••••••••"
                    />
                </div>

                <div>
                    <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-md bg-[#E84360] px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50"
                    >
                    {isSubmitting ? "Signing in..." : "Sign in"}
                    </button>
                </div>
            </form>
        </div>
        <div className="text-center text-sm text-slate-600">
            Don't have an account?{" "}
            <Link href="/signup" className="font-medium text-black hover:underline">
                Sign up
            </Link>
        </div>
    </div>
  );
}