"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  TrackerIssue,
  TrackerSummary,
  WardOption,
  listPublicIssues,
  getTrackerSummary,
  fetchWardsList,
} from "@/lib/tracker";
import { Category, fetchCategories } from "@/lib/reports";
import { getCategoryEmoji } from "@/lib/categories";
import DemoBanner from "@/components/DemoBanner";

// Dynamically import Leaflet TrackerMap with SSR disabled
const TrackerMap = dynamic(() => import("@/components/TrackerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[450px] w-full bg-slate-100 animate-pulse rounded-2xl flex items-center justify-center text-slate-400 text-sm border border-slate-200">
      <div className="flex items-center gap-2">
        <span className="animate-spin text-lg">⏳</span>
        <span>Loading interactive tracker map...</span>
      </div>
    </div>
  ),
});

// Six pipeline statuses in exact sequence
const PIPELINE_STATUSES: Array<{
  key: "reported" | "verified" | "assigned" | "in_progress" | "resolved" | "reopened";
  label: string;
  badgeStyle: string;
  dotColor: string;
}> = [
  {
    key: "reported",
    label: "Reported",
    badgeStyle: "bg-blue-100 text-blue-800 border-blue-200",
    dotColor: "bg-blue-500",
  },
  {
    key: "verified",
    label: "Verified",
    badgeStyle: "bg-indigo-100 text-indigo-800 border-indigo-200",
    dotColor: "bg-indigo-500",
  },
  {
    key: "assigned",
    label: "Assigned",
    badgeStyle: "bg-purple-100 text-purple-800 border-purple-200",
    dotColor: "bg-purple-500",
  },
  {
    key: "in_progress",
    label: "In progress",
    badgeStyle: "bg-amber-100 text-amber-800 border-amber-200",
    dotColor: "bg-amber-500",
  },
  {
    key: "resolved",
    label: "Resolved",
    badgeStyle: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dotColor: "bg-emerald-500",
  },
  {
    key: "reopened",
    label: "Reopened",
    badgeStyle: "bg-rose-100 text-rose-800 border-rose-200",
    dotColor: "bg-rose-500",
  },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function TrackerContent() {
  const searchParams = useSearchParams();

  // Core Data State
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [summary, setSummary] = useState<TrackerSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [wards, setWards] = useState<WardOption[]>([]);

  // UI & Loading State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  // Filters State initialized from URL query params
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() => {
    const raw = searchParams.get("status");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    const raw = searchParams.get("category");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [selectedWardId, setSelectedWardId] = useState<number | null>(() => {
    const raw = searchParams.get("ward");
    return raw ? parseInt(raw, 10) : null;
  });

  // Sync URL query string when filters change
  const updateUrlParams = useCallback(
    (statuses: string[], cats: string[], ward: number | null) => {
      const params = new URLSearchParams();
      if (statuses.length > 0) params.set("status", statuses.join(","));
      if (cats.length > 0) params.set("category", cats.join(","));
      if (ward !== null && !isNaN(ward)) params.set("ward", ward.toString());

      const newQuery = params.toString();
      const newUrl = newQuery ? `?${newQuery}` : window.location.pathname;
      window.history.replaceState(null, "", newUrl);
    },
    []
  );

  // 1. Initial Reference Data Load (Categories & Wards)
  useEffect(() => {
    async function loadReferenceData() {
      try {
        const [catRes, wardRes] = await Promise.all([
          fetchCategories(),
          fetchWardsList(),
        ]);
        if (catRes.data) setCategories(catRes.data);
        if (wardRes.data) setWards(wardRes.data);
      } catch (err) {
        console.error("Failed to load reference data:", err);
      }
    }
    loadReferenceData();
  }, []);

  // 2. Main Data Loader (Issues & Summary)
  const loadData = useCallback(
    async (isManualRefresh: boolean = false) => {
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const [issuesRes, summaryRes] = await Promise.all([
          listPublicIssues({
            statuses: selectedStatuses,
            categories: selectedCategories,
            wardId: selectedWardId,
            limit: 200,
          }),
          getTrackerSummary(),
        ]);

        if (issuesRes.error) {
          throw issuesRes.error;
        }
        if (summaryRes.error) {
          throw summaryRes.error;
        }

        setIssues(issuesRes.data || []);
        if (summaryRes.data) setSummary(summaryRes.data);
        setLastUpdated(formatTime(new Date()));
      } catch (err: any) {
        console.error("Tracker load error:", err);
        setError(err?.message || "Failed to load public civic issues.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedStatuses, selectedCategories, selectedWardId]
  );

  // Fetch when filters change
  useEffect(() => {
    loadData();
    updateUrlParams(selectedStatuses, selectedCategories, selectedWardId);
  }, [loadData, selectedStatuses, selectedCategories, selectedWardId, updateUrlParams]);

  // 3. Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      loadData(true);
    }, 60000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Filter Toggles
  const toggleStatusFilter = (statusKey: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(statusKey) ? prev.filter((s) => s !== statusKey) : [...prev, statusKey]
    );
  };

  const toggleCategoryFilter = (catKey: string) => {
    setSelectedCategories((prev) =>
      prev.includes(catKey) ? prev.filter((c) => c !== catKey) : [...prev, catKey]
    );
  };

  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedCategories([]);
    setSelectedWardId(null);
  };

  const hasActiveFilters =
    selectedStatuses.length > 0 || selectedCategories.length > 0 || selectedWardId !== null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col justify-between">
      <div className="space-y-6">
        <DemoBanner />

        {/* Navigation & Header */}
        <header className="space-y-3">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors py-2 px-1 -ml-1 min-h-[44px]"
            >
              ← Back to home
            </Link>

            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-500 font-medium">
                  Updated {lastUpdated}
                </span>
              )}
              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={isRefreshing || isLoading}
                aria-label="Refresh issues"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px]"
              >
                <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                Public tracker
              </h1>
              <p className="text-sm sm:text-base text-slate-600 mt-1">
                Every issue, ranked by a transparent score.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/how-scoring-works"
                className="text-xs sm:text-sm font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-4 inline-flex items-center min-h-[44px]"
              >
                How scoring works →
              </Link>
              <span className="text-slate-300">|</span>
              <Link
                href="/accountability"
                className="text-xs sm:text-sm font-semibold text-purple-600 hover:text-purple-800 underline underline-offset-4 inline-flex items-center min-h-[44px]"
              >
                Accountability →
              </Link>
              <span className="text-slate-300">|</span>
              <Link
                href="/officer/login"
                className="text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 underline underline-offset-4 inline-flex items-center min-h-[44px]"
              >
                Officer login →
              </Link>
            </div>
          </div>
        </header>

        {/* Summary Strip */}
        <section aria-label="Tracker Summary" className="space-y-2">
          <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Live Status Breakdown
              </span>
              {summary && (
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <span className="text-slate-600">
                    Total: <strong className="text-slate-950">{summary.total}</strong>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-red-700 font-bold">
                    High: {summary.by_band.High}
                  </span>
                  <span className="text-amber-700 font-bold">
                    Med: {summary.by_band.Medium}
                  </span>
                  <span className="text-emerald-700 font-bold">
                    Low: {summary.by_band.Low}
                  </span>
                </div>
              )}
            </div>

            {/* Status Pipeline Chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
              {PIPELINE_STATUSES.map((statusItem) => {
                const count = summary ? summary.by_status[statusItem.key] ?? 0 : 0;
                const isSelected = selectedStatuses.includes(statusItem.key);

                return (
                  <button
                    key={statusItem.key}
                    type="button"
                    onClick={() => toggleStatusFilter(statusItem.key)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap min-h-[44px] cursor-pointer ${
                      isSelected
                        ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${statusItem.dotColor} ${
                        isSelected ? "ring-2 ring-white" : ""
                      }`}
                    />
                    <span>{statusItem.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isSelected
                          ? "bg-slate-800 text-slate-200"
                          : "bg-slate-200/80 text-slate-700"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Filter Controls Bar */}
        <section aria-label="Filters" className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Filters
              </span>
              {hasActiveFilters && (
                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
                  Active
                </span>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 hover:underline min-h-[44px] px-2 py-1 inline-flex items-center"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Category Chips */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Categories:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {categories.map((cat) => {
                const isSelected = selectedCategories.includes(cat.key);
                const emoji = getCategoryEmoji(cat.key);

                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => toggleCategoryFilter(cat.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all min-h-[44px] cursor-pointer ${
                      isSelected
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ward Dropdown */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 border-t border-slate-100">
            <label htmlFor="ward-select" className="text-xs font-medium text-slate-500 shrink-0">
              Ward jurisdiction:
            </label>
            <div className="relative flex-1 max-w-sm">
              <select
                id="ward-select"
                value={selectedWardId ?? ""}
                onChange={(e) =>
                  setSelectedWardId(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all cursor-pointer"
              >
                <option value="">All Wards</option>
                {wards.map((w) => {
                  const displayName = w.name.includes("(simulated)") || w.name.includes("(Simulated)")
                    ? w.name
                    : `${w.name} (simulated)`;
                  return (
                    <option key={w.id} value={w.id}>
                      {displayName}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </section>

        {/* View Toggle on Mobile & Result Count */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-xs sm:text-sm font-semibold text-slate-600">
            {isLoading ? (
              <span>Loading civic issues...</span>
            ) : (
              <span>
                Showing <strong className="text-slate-900">{issues.length}</strong> issue
                {issues.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {/* Mobile View Toggle (hidden on large desktop screens where both are shown side-by-side) */}
          <div className="lg:hidden inline-flex p-1 bg-slate-200/80 rounded-xl border border-slate-300">
            <button
              type="button"
              onClick={() => setViewMode("map")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] min-w-[70px] ${
                viewMode === "map"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              🗺️ Map
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] min-w-[70px] ${
                viewMode === "list"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              📋 List
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center justify-between gap-4">
            <div>
              <p className="font-bold">Could not load tracker issues</p>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => loadData(true)}
              className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 min-h-[44px] shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="space-y-4">
            <div className="h-64 w-full bg-slate-200/60 animate-pulse rounded-2xl" />
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-28 w-full bg-slate-200/60 animate-pulse rounded-2xl" />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && issues.length === 0 && (
          <div className="p-8 sm:p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-2xs space-y-4 max-w-lg mx-auto">
            <div className="text-4xl">🔍</div>
            <h3 className="text-lg font-bold text-slate-900">No civic issues match your filters</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
              There are currently no reported issues matching this combination of status, category, or ward.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 min-h-[44px]"
                >
                  Clear filters
                </button>
              )}
              <Link
                href="/report"
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 shadow-xs min-h-[44px] inline-flex items-center justify-center"
              >
                Report a new issue
              </Link>
            </div>
          </div>
        )}

        {/* Data Display: Mobile view toggle (Map OR List), Desktop view (Side-by-Side) */}
        {!isLoading && !error && issues.length > 0 && (
          <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
            {/* List Column (Col-span 7 on desktop) */}
            <div
              className={`space-y-3 lg:col-span-7 ${
                viewMode === "list" ? "block" : "hidden lg:block"
              }`}
            >
              {issues.map((issue) => {
                const categoryEmoji = getCategoryEmoji(issue.category);
                const categoryLabel = issue.category_label || issue.category;
                const wardDisplay = issue.ward_name
                  ? issue.ward_name.includes("(simulated)") || issue.ward_name.includes("(Simulated)")
                    ? issue.ward_name
                    : `${issue.ward_name} (simulated)`
                  : "Unassigned";
                const departmentDisplay = issue.department_name || "Unassigned";

                const bandBadgeClass =
                  issue.priority_band === "High"
                    ? "bg-red-100 text-red-800 border-red-200"
                    : issue.priority_band === "Medium"
                    ? "bg-amber-100 text-amber-800 border-amber-200"
                    : "bg-emerald-100 text-emerald-800 border-emerald-200";

                const statusCfg = PIPELINE_STATUSES.find((s) => s.key === issue.status);

                return (
                  <article
                    key={issue.id}
                    className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-all flex flex-col sm:flex-row gap-4 justify-between"
                  >
                    <div className="flex gap-3.5 flex-1">
                      {/* Photo Thumbnail or Category Emoji Placeholder */}
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200 flex items-center justify-center">
                        {issue.photo_url ? (
                          <img
                            src={issue.photo_url}
                            alt={categoryLabel}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-2xl sm:text-3xl">{categoryEmoji}</span>
                        )}
                      </div>

                      {/* Content details */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-900 truncate">
                            {categoryEmoji} {categoryLabel}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold border ${bandBadgeClass}`}
                          >
                            {issue.priority_score} pts • {issue.priority_band}
                          </span>
                        </div>

                        {/* Status badge & Ward */}
                        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-md font-semibold text-[11px] border ${
                              statusCfg?.badgeStyle || "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {statusCfg?.label || issue.status}
                          </span>
                          <span>•</span>
                          <span className="truncate">{wardDisplay}</span>
                          <span>•</span>
                          <span className="text-slate-400 truncate">{departmentDisplay}</span>
                        </div>

                        {/* Reasons text */}
                        {issue.reasons_text && (
                          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed pt-0.5">
                            {issue.reasons_text}
                          </p>
                        )}

                        {/* Signals: reporters & age */}
                        <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500 pt-1">
                          <span>
                            👥 {issue.unique_reporters} {issue.unique_reporters === 1 ? "person" : "people"} affected
                          </span>
                          <span>
                            ⏱️ Open {issue.days_open} day{issue.days_open === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* View issue link button */}
                    <div className="sm:self-center shrink-0 pt-2 sm:pt-0">
                      <Link
                        href={`/issue/${issue.id}`}
                        className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold transition-all shadow-xs min-h-[44px]"
                      >
                        View issue →
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Map Column (Col-span 5 on desktop, sticky) */}
            <div
              className={`lg:col-span-5 lg:sticky lg:top-6 ${
                viewMode === "map" ? "block" : "hidden lg:block"
              }`}
            >
              <TrackerMap issues={issues} className="h-[460px] sm:h-[540px] w-full rounded-2xl border border-slate-200 shadow-2xs" />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-500 space-y-1">
        <p>Ward data is simulated. Map data: OpenStreetMap contributors.</p>
        <p className="text-slate-400">Civic Issue Tracker • Radical transparency in civic governance</p>
      </footer>
    </main>
  );
}

export default function TrackerPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center text-slate-400">
          <div className="flex items-center gap-2">
            <span className="animate-spin text-xl">⏳</span>
            <span>Loading public tracker...</span>
          </div>
        </main>
      }
    >
      <TrackerContent />
    </Suspense>
  );
}
