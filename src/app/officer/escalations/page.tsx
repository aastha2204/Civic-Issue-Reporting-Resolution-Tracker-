"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  OfficerProfile,
  getMyProfile,
  signOutOfficer,
} from "@/lib/officer";
import {
  EscalationQueueItem,
  listEscalations,
  formatHours,
} from "@/lib/sla";
import { getCategoryEmoji } from "@/lib/categories";

const BAND_BADGES: Record<string, string> = {
  High: "bg-red-100 text-red-800 border-red-200",
  Medium: "bg-amber-100 text-amber-800 border-amber-200",
  Low: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function OfficerEscalationsPage() {
  const router = useRouter();

  // Authentication & Profile State
  const [profile, setProfile] = useState<OfficerProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  // Escalations List State
  const [escalations, setEscalations] = useState<EscalationQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // 1. Guard check: load profile or redirect to /officer/login
  useEffect(() => {
    async function initOfficer() {
      setIsAuthLoading(true);
      try {
        const { data: userProfile, error: profileErr } = await getMyProfile();
        if (
          profileErr ||
          !userProfile ||
          (userProfile.role !== "officer" && userProfile.role !== "admin")
        ) {
          router.replace("/officer/login");
          return;
        }
        setProfile(userProfile);
      } catch {
        router.replace("/officer/login");
      } finally {
        setIsAuthLoading(false);
      }
    }
    initOfficer();
  }, [router]);

  // 2. Fetch escalated issues
  const loadEscalations = useCallback(
    async (showRefreshIndicator = false) => {
      if (!profile) return;
      if (showRefreshIndicator) setIsRefreshing(true);
      setError(null);

      // Trigger fire-and-forget SLA escalation run
      fetch("/api/sla/run").catch(() => {});

      try {
        const { data, error: escErr } = await listEscalations();

        if (escErr) {
          setError(escErr.message);
        } else {
          setEscalations(data || []);
          setLastUpdated(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          );
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load escalations list.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [profile]
  );

  // Fetch when profile is confirmed
  useEffect(() => {
    if (profile) {
      loadEscalations();
    }
  }, [profile, loadEscalations]);

  const handleSignOut = async () => {
    await signOutOfficer();
    router.replace("/officer/login");
  };

  if (isAuthLoading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-500 font-medium text-sm">
          <span className="animate-spin text-xl">⏳</span>
          <span>Verifying officer credentials...</span>
        </div>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  const level1Count = escalations.filter((item) => item.level === 1).length;
  const level2Count = escalations.filter((item) => item.level === 2).length;

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/officer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
          >
            <span>←</span>
            <span>Back to Queue</span>
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs font-bold text-rose-700 hover:text-rose-800 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Officer Header */}
        <header className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🚨</span>
                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    SLA Escalations
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                      {profile.role}
                    </span>
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                      🏢 {profile.department_name || "All Departments"}
                    </span>
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                      📍 {profile.ward_name || "All Wards"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/officer"
                className="inline-flex items-center justify-center px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors min-h-[44px]"
              >
                Jurisdiction Queue →
              </Link>
            </div>
          </div>
        </header>

        {/* Escalation Summary & Controls */}
        <section aria-label="Escalation Summary" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                Active Breach Incidents
              </h2>
              <p className="text-xs text-slate-500">
                Sorted by escalation severity (Level 2 first), then most overdue.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-500 font-medium">
                  Updated {lastUpdated}
                </span>
              )}
              <button
                type="button"
                onClick={() => loadEscalations(true)}
                disabled={isRefreshing || isLoading}
                aria-label="Refresh escalations"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all shadow-2xs min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Counts Strip */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
            <span className="text-slate-600">
              Total escalated: <strong className="text-slate-950">{escalations.length}</strong>
            </span>
            <div className="flex items-center gap-3">
              <span className="text-purple-700 font-bold">
                Level 2 (City Admin): {level2Count}
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-amber-700 font-bold">
                Level 1 (Dept Head): {level1Count}
              </span>
            </div>
          </div>
        </section>

        {/* Error Notice */}
        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs text-rose-800 flex items-start gap-2.5">
            <span className="text-base shrink-0">⚠️</span>
            <p className="leading-relaxed font-medium">{error}</p>
          </div>
        )}

        {/* Escalation Cards Listing */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-36 bg-white rounded-2xl border border-slate-200 animate-pulse p-5"
              />
            ))}
          </div>
        ) : escalations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center space-y-2">
            <span className="text-3xl">🎉</span>
            <h3 className="text-base font-bold text-slate-900">
              Nothing is overdue. 🎉
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              All open civic issues in your assigned jurisdiction are within their SLA response windows.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {escalations.map((item) => {
              const emoji = getCategoryEmoji(item.category);
              const bandBadge =
                BAND_BADGES[item.priority_band] ||
                "bg-slate-100 text-slate-800 border-slate-200";

              return (
                <article
                  key={item.issue_id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all overflow-hidden"
                >
                  <div className="p-4 sm:p-5 space-y-3.5">
                    {/* Header Row: Level Badge, Escalation Label & Overdue duration */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider border ${
                            item.level === 2
                              ? "bg-purple-100 text-purple-900 border-purple-300"
                              : "bg-amber-100 text-amber-900 border-amber-300"
                          }`}
                        >
                          Level {item.level}
                        </span>
                        <span className="text-xs font-extrabold text-slate-900">
                          {item.label}
                        </span>
                      </div>

                      {/* Overdue hours tag */}
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
                        <span>⚠️</span>
                        <span>{formatHours(-item.hours_overdue)}</span>
                      </span>
                    </div>

                    {/* Middle Row: Category Title & Priority */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-950 flex items-center gap-1.5">
                          <span>{emoji}</span>
                          <span>{item.category_label || item.category}</span>
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-extrabold border ${bandBadge}`}
                          >
                            {item.priority_band} ({item.priority_score} pts)
                          </span>
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Status: {item.status}
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/officer/issue/${item.issue_id}`}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-2xs shrink-0 min-h-[38px]"
                      >
                        Manage Issue →
                      </Link>
                    </div>

                    {/* Details Strip */}
                    <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-600 font-medium bg-slate-50/75 rounded-xl p-3 border border-slate-100">
                      <span>
                        ⏱️ Deadline:{" "}
                        <strong className="text-slate-900 font-semibold">
                          {item.due_at
                            ? new Date(item.due_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </strong>
                      </span>
                      <span>🏛️ {item.ward_name || "All Wards"}</span>
                      <span>🏢 {item.department_name || "All Departments"}</span>
                      <span>
                        👤 Assigned:{" "}
                        <strong className="text-slate-900 font-semibold">
                          {item.assigned_to_name || "Unassigned"}
                        </strong>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Prototype Footnote */}
        <footer className="text-center pt-2 pb-6">
          <p className="text-xs text-slate-400">
            The escalation hierarchy is simulated in this prototype.
          </p>
        </footer>
      </div>
    </main>
  );
}
