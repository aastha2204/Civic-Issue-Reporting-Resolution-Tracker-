"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NagrikLogo from "@/components/NagrikLogo";
import { supabase } from "@/lib/supabase/client";
import { signOutUser } from "@/lib/auth-actions";

export default function MyReportsPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    async function loadCitizenProfile() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;

        if (!user || user.is_anonymous) {
          router.replace("/login");
          return;
        }

        setUserEmail(user.email || null);

        // Fetch display name from profiles if exists
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.display_name) {
          setDisplayName(profile.display_name);
        }
      } catch (err) {
        console.error("Failed to load user profile:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCitizenProfile();
  }, [router]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOutUser();
    router.replace("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500 text-sm">
          <div className="w-8 h-8 border-2 border-[#3B1A6E] border-t-transparent rounded-full animate-spin" />
          <p className="font-medium text-xs tracking-wide uppercase text-slate-400">
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <NagrikLogo showTagline={false} size="sm" href="/" />

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-block text-xs text-slate-500 font-medium">
              Signed in as <strong className="text-slate-800">{displayName || userEmail}</strong>
            </span>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 transition-colors"
            >
              {isSigningOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="space-y-8">
          {/* Welcome Banner */}
          <div className="rounded-2xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 text-[#3B1A6E] text-xs font-semibold mb-3 border border-purple-200/60">
                Citizen Portal
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Welcome, {displayName || userEmail?.split("@")[0] || "Citizen"}
              </h1>
              <p className="mt-1 text-sm text-slate-500 max-w-2xl">
                Track your reported civic issues, monitor municipal prioritization scores, and verify completed fixes.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <Link
                href="/report"
                className="inline-flex items-center justify-center rounded-xl bg-[#3B1A6E] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#2F1458] transition-colors"
              >
                + Report New Issue
              </Link>
              <Link
                href="/tracker"
                className="inline-flex items-center justify-center rounded-xl bg-white border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Public Tracker
              </Link>
            </div>
          </div>

          {/* Quick Stats & Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-white border border-slate-200/80 p-6 shadow-xs space-y-2">
              <div className="text-2xl">📍</div>
              <h3 className="font-bold text-slate-900 text-base">Geo-Tagged Reports</h3>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                Every issue you report contains verified coordinates and photos, boosting community accountability.
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200/80 p-6 shadow-xs space-y-2">
              <div className="text-2xl">⚖️</div>
              <h3 className="font-bold text-slate-900 text-base">Mathematical Scoring</h3>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                Prioritization is calculated objectively based on hazard severity, vulnerable landmarks, and weather impact.
              </p>
              <Link
                href="/how-scoring-works"
                className="text-xs font-semibold text-[#3B1A6E] hover:underline inline-block pt-1"
              >
                Learn how scoring works →
              </Link>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200/80 p-6 shadow-xs space-y-2">
              <div className="text-2xl">✅</div>
              <h3 className="font-bold text-slate-900 text-base">Verified Resolution</h3>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                Municipal officers must upload GPS-verified after-photos before an issue can be marked resolved.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
