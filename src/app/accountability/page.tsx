"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getScoreboard,
  getEquityStats,
  ScoreboardStats,
  EquityStats,
  ScoreboardGroup,
  formatPct,
  formatHours,
  formatRatePer1k,
} from "@/lib/transparency";
import DemoBanner from "@/components/DemoBanner";

export default function AccountabilityPage() {
  const [scoreboard, setScoreboard] = useState<ScoreboardStats | null>(null);
  const [equity, setEquity] = useState<EquityStats | null>(null);
  const [activeTab, setActiveTab] = useState<"ward" | "department">("ward");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    }
    setError(null);

    const [sbRes, eqRes] = await Promise.all([getScoreboard(), getEquityStats()]);

    if (sbRes.error || eqRes.error) {
      setError(sbRes.error || eqRes.error || "Failed to load accountability data");
    } else {
      setScoreboard(sbRes.data);
      setEquity(eqRes.data);
      setLastUpdated(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => {
      fetchData();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const overall = scoreboard?.overall;
  const groups: ScoreboardGroup[] =
    activeTab === "ward" ? scoreboard?.by_ward ?? [] : scoreboard?.by_department ?? [];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-8 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <DemoBanner />

        {/* Navigation Bar */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <Link
            href="/tracker"
            className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors py-2 min-h-[44px]"
          >
            ← Back to Public Tracker
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/how-scoring-works"
              className="text-xs sm:text-sm font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-4 inline-flex items-center min-h-[44px]"
            >
              How Scoring Works →
            </Link>

            <button
              type="button"
              onClick={() => fetchData(true)}
              disabled={isRefreshing || isLoading}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px]"
              aria-label="Refresh accountability data"
            >
              <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
              <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
          </div>
        </header>

        {/* Hero Section */}
        <section className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-semibold">
              <span>🏛️</span>
              <span>Municipal Performance Tracking</span>
            </div>
            {lastUpdated && (
              <span className="text-xs text-slate-400 font-medium">
                Updated {lastUpdated} • Auto-refreshes every 60s
              </span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
            Accountability scoreboard
          </h1>
          <p className="text-base sm:text-lg text-slate-600 font-normal">
            Who fixes things, how fast, and whether the fix holds.
          </p>
        </section>

        {/* Error State */}
        {error && (
          <div className="p-5 rounded-2xl bg-red-50 border border-red-200 text-red-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>⚠️</span>
              <span>Failed to load municipal accountability stats</span>
            </div>
            <p className="text-xs leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={() => fetchData(true)}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 min-h-[44px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Overall Strip */}
        <section aria-label="Citywide Performance Overview" className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Citywide Overview Strip
          </h2>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-100 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {/* Resolution Rate */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
                <span className="text-xs text-slate-500 font-medium">Resolution Rate</span>
                <div className="mt-2">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatPct(overall?.resolution_rate_pct)}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {overall?.resolved_issues ?? 0} of {overall?.total_issues ?? 0} resolved
                  </span>
                </div>
              </div>

              {/* Avg Turnaround Time */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
                <span className="text-xs text-slate-500 font-medium">Avg Time to Resolve</span>
                <div className="mt-2">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatHours(overall?.avg_resolution_hours)}
                  </div>
                  <span className="text-[11px] text-slate-500">for resolved issues</span>
                </div>
              </div>

              {/* Reopen Rate */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
                <span className="text-xs text-slate-500 font-medium">Reopen Rate</span>
                <div className="mt-2">
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {formatPct(overall?.reopen_rate_pct)}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {overall?.reopened_issues ?? 0} disputed fixes
                  </span>
                </div>
              </div>

              {/* SLA Compliance */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
                <span className="text-xs text-slate-500 font-medium">SLA Compliance</span>
                <div className="mt-2">
                  <div className="text-lg font-bold text-slate-900">
                    <span className="text-emerald-700">{overall?.sla_met ?? 0} Met</span>
                    {" / "}
                    <span className="text-rose-700">{overall?.sla_missed ?? 0} Missed</span>
                  </div>
                  <span className="text-[11px] text-slate-500">on resolved issues</span>
                </div>
              </div>

              {/* Overdue Now */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between col-span-2 sm:col-span-1">
                <span className="text-xs text-slate-500 font-medium">Overdue Now</span>
                <div className="mt-2">
                  <div
                    className={`text-2xl font-black tracking-tight ${
                      (overall?.overdue_now ?? 0) > 0 ? "text-red-700" : "text-slate-900"
                    }`}
                  >
                    {overall?.overdue_now ?? 0}
                  </div>
                  <span className="text-[11px] text-slate-500">open SLA breaches</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Breakdown Section: By Ward | By Department */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Breakdown Comparison</h2>
              <p className="text-xs text-slate-500">
                Compare fix rates and responsiveness across municipal divisions
              </p>
            </div>

            {/* Toggle Controls */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl self-start">
              <button
                type="button"
                onClick={() => setActiveTab("ward")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === "ward"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                By Ward
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("department")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === "department"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                By Department
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-28 bg-slate-100 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400">
              No division performance records available yet.
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((item, idx) => {
                const groupName =
                  activeTab === "ward"
                    ? item.ward_name ?? "Unassigned Ward"
                    : item.department_name ?? "Unassigned Department";

                // Ensure (simulated) label is visible for wards
                const displayName =
                  activeTab === "ward" && !groupName.toLowerCase().includes("simulated")
                    ? `${groupName} (simulated)`
                    : groupName;

                const resRate = item.resolution_rate_pct;
                const barWidth = resRate !== null ? `${Math.min(100, Math.max(0, resRate))}%` : "0%";

                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm text-slate-900">{displayName}</span>
                        <span className="text-xs text-slate-500">
                          ({item.total_issues} {item.total_issues === 1 ? "issue" : "issues"})
                        </span>
                      </div>

                      {/* SLA badges strip */}
                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold">
                          {item.sla_met} SLA Met
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-semibold">
                          {item.sla_missed} SLA Missed
                        </span>
                        {item.overdue_now > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold animate-pulse">
                            {item.overdue_now} Overdue
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Resolution Rate Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-600">Resolution Rate</span>
                        <span className="text-slate-900">{formatPct(resRate)}</span>
                      </div>
                      <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all duration-500"
                          style={{ width: barWidth }}
                        />
                      </div>
                    </div>

                    {/* Metrics Footer Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/60 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Open / Resolved</span>
                        <span className="font-semibold text-slate-800">
                          {item.open_issues} open • {item.resolved_issues} resolved
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 block text-[11px]">Avg Resolution Time</span>
                        <span className="font-semibold text-slate-800">
                          {formatHours(item.avg_resolution_hours)}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 block text-[11px]">Reopen Rate</span>
                        <span
                          className={`font-semibold ${
                            (item.reopen_rate_pct ?? 0) > 15 ? "text-rose-700" : "text-slate-800"
                          }`}
                        >
                          {formatPct(item.reopen_rate_pct)}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 block text-[11px]">Reopened Issues</span>
                        <span className="font-semibold text-slate-800">
                          {item.reopened_issues} {item.reopened_issues === 1 ? "issue" : "issues"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Equity View Section */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
              <span>⚖️</span>
              <span>Equity Analytics</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Equity View: Service Equality Across Wards
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Tracking disparity in municipal resolution speed and citizen reporting coverage.
              Always evaluated against citywide baselines.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <div className="h-32 bg-slate-100 animate-pulse rounded-xl" />
              <div className="h-32 bg-slate-100 animate-pulse rounded-xl" />
            </div>
          ) : !equity || equity.wards.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No equity metrics calculated yet.
            </div>
          ) : (
            <div className="space-y-8">
              {/* Chart 1: Average Resolution Time per Ward */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    1. Average Resolution Time by Ward
                  </h3>
                  <span className="text-xs text-slate-500">
                    City Average: <strong className="text-slate-800">{formatHours(equity.city.avg_resolution_hours)}</strong>
                  </span>
                </div>

                <div className="space-y-3 pt-2">
                  {equity.wards.map((ward) => {
                    const wardName = !ward.ward_name.toLowerCase().includes("simulated")
                      ? `${ward.ward_name} (simulated)`
                      : ward.ward_name;

                    // Compute scaled bar width relative to max of (ward hours, city avg * 1.5, or 100)
                    const maxHoursRef = Math.max(
                      ...(equity.wards.map((w) => w.avg_resolution_hours ?? 0)),
                      equity.city.avg_resolution_hours ?? 0,
                      24
                    );
                    const hoursVal = ward.avg_resolution_hours ?? 0;
                    const pct = Math.min(100, Math.max(0, (hoursVal / maxHoursRef) * 100));

                    return (
                      <div key={ward.ward_id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-900">{wardName}</span>
                          <span className="font-semibold text-slate-700">
                            {formatHours(ward.avg_resolution_hours)}
                          </span>
                        </div>

                        {/* Bar with relative indicator */}
                        <div className="relative w-full h-4 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              ward.long_wait ? "bg-amber-500" : "bg-indigo-600"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* Flag badge if long wait */}
                        {ward.long_wait && ward.wait_ratio && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold">
                            <span>⚠️</span>
                            <span>Waits {ward.wait_ratio}x the city average</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chart 2: Reports per 1,000 Residents */}
              <div className="space-y-3 border-t border-slate-100 pt-6">
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    2. Citizen Reporting Density (Reports per 1,000 Residents)
                  </h3>
                  <span className="text-xs text-slate-500">
                    City Median: <strong className="text-slate-800">{formatRatePer1k(equity.city.median_reports_per_1000)} per 1k</strong>
                  </span>
                </div>

                <div className="space-y-3 pt-2">
                  {equity.wards.map((ward) => {
                    const wardName = !ward.ward_name.toLowerCase().includes("simulated")
                      ? `${ward.ward_name} (simulated)`
                      : ward.ward_name;

                    const maxRepRef = Math.max(
                      ...(equity.wards.map((w) => w.reports_per_1000 ?? 0)),
                      equity.city.median_reports_per_1000 ?? 0,
                      5
                    );
                    const rateVal = ward.reports_per_1000 ?? 0;
                    const pct = Math.min(100, Math.max(0, (rateVal / maxRepRef) * 100));

                    return (
                      <div key={ward.ward_id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-slate-900">{wardName}</span>
                            <span className="text-[11px] text-slate-500 ml-2">
                              {ward.reports} reports • Pop: {ward.population ? ward.population.toLocaleString() : "N/A"}
                            </span>
                          </div>
                          <span className="font-semibold text-slate-700">
                            {formatRatePer1k(ward.reports_per_1000)} / 1,000 residents
                          </span>
                        </div>

                        {/* Bar */}
                        <div className="relative w-full h-4 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              ward.low_reporting ? "bg-rose-500" : "bg-emerald-600"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* Flag badge if low reporting */}
                        {ward.low_reporting && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-100 border border-rose-300 text-rose-900 text-xs font-bold">
                            <span>📢</span>
                            <span>Low reporting: possible under-reporting, not necessarily fewer problems</span>
                          </div>
                        )}

                        {/* Fairness boost available badge (Part B) */}
                        {ward.max_equity_boost != null && ward.max_equity_boost > 0 && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-100 border border-purple-300 text-purple-900 text-xs font-bold">
                            <span>⚖️</span>
                            <span>Fairness boost available: up to +{ward.max_equity_boost}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Note about simulated demographics */}
              <div className="p-3.5 rounded-xl bg-slate-100/80 text-[11px] text-slate-600 space-y-1">
                <span className="font-bold text-slate-800 block">Demonstration Demographics Note:</span>
                <p>
                  Population figures are simulated for this prototype. Map data: OpenStreetMap contributors.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-slate-400 pt-6 border-t border-slate-200 space-y-1">
          <div>Ward data is simulated. Map data: OpenStreetMap contributors.</div>
          <div>Civic Issue Tracker • Municipal Accountability Platform</div>
        </footer>
      </div>
    </main>
  );
}
