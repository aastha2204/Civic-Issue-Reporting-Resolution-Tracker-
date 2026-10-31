"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInOfficer, getMyProfile } from "@/lib/officer";

export default function OfficerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function checkExistingAuth() {
      try {
        const { data: profile } = await getMyProfile();
        if (profile && (profile.role === "officer" || profile.role === "admin")) {
          router.replace("/officer");
          return;
        }
      } catch {
        // ignore and let officer log in
      } finally {
        setIsCheckingSession(false);
      }
    }
    checkExistingAuth();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage("Please enter both your officer email and password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const { data: profile, error } = await signInOfficer(email, password);

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
      return;
    }

    if (profile && (profile.role === "officer" || profile.role === "admin")) {
      router.push("/officer");
    } else {
      setErrorMessage("Access denied: Officer or administrator account required.");
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-500 font-medium text-sm">
          <span className="animate-spin text-xl">⏳</span>
          <span>Checking authorization...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Navigation Link */}
        <div>
          <Link
            href="/tracker"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 min-h-[44px] transition-colors"
          >
            ← Back to Public Tracker
          </Link>
        </div>

        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600 text-white text-2xl shadow-sm">
            🏛️
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Municipal Officer Portal
          </h1>
          <p className="text-sm text-slate-600">
            Sign in to inspect jurisdiction queue, assign tasks, and verify fixes.
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200/90 rounded-2xl sm:px-10 space-y-6">
          {/* Officer access notice */}
          <div className="rounded-xl bg-amber-50 border border-amber-200/80 p-3.5 flex items-start gap-3 text-xs text-amber-900">
            <span className="text-base shrink-0 mt-0.5">🔒</span>
            <div>
              <strong className="font-bold">Officer and admin access only.</strong>
              <p className="mt-0.5 text-amber-800 leading-relaxed">
                Citizens do not need an account to file or track civic issues publicly.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-3 text-xs text-rose-800"
            >
              <span className="text-base shrink-0">⚠️</span>
              <div className="leading-relaxed font-medium">{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="officer-email"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Official Email
              </label>
              <input
                id="officer-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer1@civic.test"
                className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
              />
            </div>

            <div>
              <label
                htmlFor="officer-password"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="officer-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 active:scale-98 transition-all min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <>
                  <span className="animate-spin text-base">⏳</span>
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <span>Sign in as Officer</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
