"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import NagrikLogo from "@/components/NagrikLogo";
import CommunityNetworkGraphic from "@/components/CommunityNetworkGraphic";
import { BRAND_MISSION } from "@/lib/brand";
import {
  signInWithPassword,
  signInWithGoogle,
  checkActiveSession,
} from "@/lib/auth-actions";

const REMEMBER_EMAIL_STORAGE_KEY = "nagrik_remembered_email";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check if visitor is already signed in, and pre-fill remembered email
  useEffect(() => {
    let isMounted = true;

    // Load honestly remembered email on this device
    try {
      const savedEmail = localStorage.getItem(REMEMBER_EMAIL_STORAGE_KEY);
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch {
      // Storage unavailable or disabled
    }

    async function checkAuth() {
      try {
        const { signedIn, redirectUrl } = await checkActiveSession(nextParam);
        if (isMounted && signedIn && redirectUrl) {
          router.replace(redirectUrl);
          return;
        }
      } catch {
        // Continue to show login form
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router, nextParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setErrorMessage("Please enter both your email address and password.");
      return;
    }

    setIsLoading(true);

    // Save or clear remembered email on this device honestly
    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_EMAIL_STORAGE_KEY, cleanEmail);
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable
    }

    const result = await signInWithPassword(cleanEmail, password, nextParam);

    if (!result.success) {
      setErrorMessage(result.error || "Incorrect email or password.");
      setIsLoading(false);
      return;
    }

    if (result.redirectUrl) {
      router.push(result.redirectUrl);
    } else {
      router.push("/my-reports");
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);

    const result = await signInWithGoogle(nextParam);

    if (!result.success) {
      setErrorMessage(result.error || "Google sign-in is not set up yet.");
      setIsGoogleLoading(false);
      return;
    }

    if (result.redirectUrl) {
      window.location.href = result.redirectUrl;
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-slate-500 text-sm">
          <div className="w-8 h-8 border-2 border-[#3B1A6E] border-t-transparent rounded-full animate-spin" />
          <p className="font-medium text-xs tracking-wide uppercase text-slate-400">
            Checking session...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-white">
      {/* Mobile Top Branded Header Band (< 1024px) */}
      <header className="lg:hidden w-full bg-gradient-to-br from-[#3B1A6E] via-[#2F1458] to-[#1E0B38] text-white px-6 py-6 flex flex-col items-center justify-center text-center shadow-inner">
        <div className="scale-75 origin-center -my-14">
          <CommunityNetworkGraphic className="max-w-[280px]" />
        </div>
        <p className="mt-2 text-xs sm:text-sm font-medium tracking-wide text-white/90">
          {BRAND_MISSION}
        </p>
      </header>

      {/* Left 50%: Pure White Form Panel */}
      <main className="w-full lg:w-1/2 min-h-full flex flex-col justify-between p-6 sm:p-10 lg:p-12 xl:p-16">
        {/* Navigation link / back to public site */}
        <div className="w-full max-w-[420px] mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors inline-flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 rounded-md py-1"
          >
            ← Back to home
          </Link>
          <Link
            href="/tracker"
            className="text-xs font-medium text-slate-400 hover:text-[#3B1A6E] transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 rounded-md py-1"
          >
            Public tracker
          </Link>
        </div>

        {/* Vertically Centered Form Container (Max Width 420px) */}
        <div className="w-full max-w-[420px] mx-auto my-auto py-6">
          {/* Logo & Tagline at Top */}
          <div className="mb-8">
            <NagrikLogo showTagline size="lg" />
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">
              Sign in to your account
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back. Enter your details to continue.
            </p>
          </div>

          {/* Accessible Error Announcement Region */}
          <div aria-live="polite" className="mb-5">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 border border-red-200/80 p-3.5 flex items-start gap-3 text-xs sm:text-sm text-red-700 animate-in fade-in duration-200"
              >
                <span className="text-base shrink-0 select-none">⚠️</span>
                <span className="leading-snug font-medium pt-0.5">{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Email Field */}
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:outline-none focus:border-[#3B1A6E] focus:ring-2 focus:ring-[#3B1A6E]/20 transition-all min-h-[44px]"
              />
            </div>

            {/* Password Field with Show/Hide Toggle */}
            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-gray-300 pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:outline-none focus:border-[#3B1A6E] focus:ring-2 focus:ring-[#3B1A6E]/20 transition-all min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 rounded-lg transition-colors cursor-pointer"
                >
                  {showPassword ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password Row */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#3B1A6E] focus:ring-[#3B1A6E]/30 accent-[#3B1A6E] cursor-pointer"
                />
                <span className="text-xs sm:text-sm text-slate-600">
                  Remember my email
                </span>
              </label>

              <Link
                href="/forgot-password"
                className="text-xs sm:text-sm font-semibold text-[#3B1A6E] hover:text-[#280f50] focus:outline-none focus:underline"
              >
                Forgot password?
              </Link>
            </div>

            {/* Primary Sign In Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading || isGoogleLoading}
                className="w-full inline-flex items-center justify-center rounded-xl bg-[#3B1A6E] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#2F1458] active:bg-[#240c46] focus:outline-none focus:ring-2 focus:ring-[#3B1A6E] focus:ring-offset-2 transition-all min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    <span>Signing in...</span>
                  </span>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </div>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 font-semibold text-gray-400">
                or
              </span>
            </div>
          </div>

          {/* Sign in with Google Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading}
            className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/20 transition-all min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {isGoogleLoading ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4 text-slate-600"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                <span>Connecting to Google...</span>
              </span>
            ) : (
              <>
                <svg
                  className="w-5 h-5 shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    fill="#EA4335"
                  />
                </svg>
                <span>Sign in with Google</span>
              </>
            )}
          </button>

          {/* Create an Account Link */}
          <div className="mt-8 text-center text-xs sm:text-sm text-slate-600">
            <span>New to Nagrik? </span>
            <Link
              href="/signup"
              className="font-semibold text-[#3B1A6E] hover:underline focus:outline-none focus:ring-1 focus:ring-[#3B1A6E] rounded px-1"
            >
              Create an account
            </Link>
          </div>
        </div>

        {/* Form Footer */}
        <div className="w-full max-w-[420px] mx-auto text-center text-xs text-slate-400 py-2">
          Protected by Nagrik security protocols. Transparent civic governance.
        </div>
      </main>

      {/* Right 50%: Visual Panel in App's Deep Purple (#3B1A6E) Gradient (Desktop >= 1024px) */}
      <aside
        className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#3B1A6E] via-[#2F1458] to-[#1E0B38] text-white flex-col justify-between p-12 xl:p-16 relative overflow-hidden"
        aria-label="Community Collaboration Visual"
      >
        {/* Subtle decorative background glow */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#54259A]/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-[#138808]/10 blur-3xl pointer-events-none" />

        {/* Top spacer or brand marker */}
        <div className="relative z-10 flex items-center justify-end">
          <span className="text-xs uppercase tracking-widest text-white/50 font-semibold">
            Civic Collaboration Hub
          </span>
        </div>

        {/* Minimalist Geometric Graphic of Community Collaboration */}
        <div className="relative z-10 my-auto flex flex-col items-center justify-center text-center px-4">
          <CommunityNetworkGraphic className="w-full max-w-[440px]" />
          
          {/* Tagline Copy below graphic */}
          <p className="mt-8 text-xl xl:text-2xl font-bold tracking-tight text-white drop-shadow-sm max-w-md">
            {BRAND_MISSION}
          </p>
          <p className="mt-2 text-xs sm:text-sm text-white/70 max-w-sm leading-relaxed">
            Connecting citizens, municipal officers, and wards for verified civic resolution.
          </p>
        </div>

        {/* Bottom subtle copyright */}
        <div className="relative z-10 flex items-center justify-between text-xs text-white/40">
          <span>Verified geo-tagged resolutions</span>
          <span>Open Governance</span>
        </div>
      </aside>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="w-8 h-8 border-2 border-[#3B1A6E] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
