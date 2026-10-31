"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NagrikLogo from "@/components/NagrikLogo";
import { updatePassword } from "@/lib/auth-actions";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    if (!password || password.length < 6) {
      setErrorMessage("New password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    const result = await updatePassword(password);

    setIsLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || "Failed to update password.");
      return;
    }

    setStatusMessage(
      result.message ||
        "Your password has been successfully updated. Redirecting to sign in..."
    );

    setTimeout(() => {
      router.push("/login");
    }, 2000);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200/90 p-8 sm:p-10 space-y-6">
        <div>
          <NagrikLogo showTagline size="md" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">
            Set new password
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create a secure password with at least 6 characters.
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
              <span className="text-base shrink-0 select-none">✓</span>
              <span className="leading-snug font-medium pt-0.5">{statusMessage}</span>
            </div>
          )}
        </div>

        {!statusMessage ? (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full rounded-xl border border-gray-300 pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:outline-none focus:border-[#3B1A6E] focus:ring-2 focus:ring-[#3B1A6E]/20 transition-all min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 rounded-lg cursor-pointer"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
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
                    <span>Saving password...</span>
                  </span>
                ) : (
                  <span>Update Password</span>
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
              Sign In Now
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
