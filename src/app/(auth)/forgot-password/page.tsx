"use client";

import React, { useState } from "react";
import Link from "next/link";
import NagrikLogo from "@/components/NagrikLogo";
import { sendPasswordReset } from "@/lib/auth-actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMessage("Please enter your registered email address.");
      return;
    }

    setIsLoading(true);

    const result = await sendPasswordReset(cleanEmail);

    setIsLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || "Failed to send reset link.");
      return;
    }

    setStatusMessage(
      result.message ||
        "If an account exists with this email, a password reset link has been dispatched to your inbox."
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200/90 p-8 sm:p-10 space-y-6">
        <div>
          <NagrikLogo showTagline size="md" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">
            Forgot your password?
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your account email and we will send you a secure link to reset your password.
          </p>
        </div>

        {/* Live notification region */}
        <div aria-live="polite">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 border border-red-200/80 p-3.5 flex items-start gap-3 text-xs sm:text-sm text-red-700"
            >
              <span className="text-base shrink-0 select-none">⚠️</span>
              <span className="leading-snug font-medium pt-0.5">{errorMessage}</span>
            </div>
          )}

          {statusMessage && (
            <div
              role="status"
              className="rounded-xl bg-emerald-50 border border-emerald-200/80 p-3.5 flex items-start gap-3 text-xs sm:text-sm text-emerald-800"
            >
              <span className="text-base shrink-0 select-none">✉️</span>
              <span className="leading-snug font-medium pt-0.5">{statusMessage}</span>
            </div>
          )}
        </div>

        {!statusMessage ? (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="reset-email"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Registered Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:outline-none focus:border-[#3B1A6E] focus:ring-2 focus:ring-[#3B1A6E]/20 transition-all min-h-[44px]"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center rounded-xl bg-[#3B1A6E] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#2F1458] active:bg-[#240c46] focus:outline-none focus:ring-2 focus:ring-[#3B1A6E] focus:ring-offset-2 transition-all min-h-[44px] disabled:opacity-60 cursor-pointer"
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>Sending reset link...</span>
                  </span>
                ) : (
                  <span>Send Reset Link</span>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="pt-2 text-center">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl bg-[#3B1A6E] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#2F1458] transition-colors"
            >
              Back to Sign In
            </Link>
          </div>
        )}

        <div className="text-center text-xs sm:text-sm text-slate-600 pt-2 border-t border-slate-100">
          <Link
            href="/login"
            className="font-semibold text-[#3B1A6E] hover:underline focus:outline-none focus:ring-1 focus:ring-[#3B1A6E] rounded px-1"
          >
            ← Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
