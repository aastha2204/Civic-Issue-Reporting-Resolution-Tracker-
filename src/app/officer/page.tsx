"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  OfficerProfile,
  OfficerQueueItem,
  getMyProfile,
  fetchOfficerQueue,
  signOutOfficer,
} from "@/lib/officer";
import { getCategoryEmoji } from "@/lib/categories";
import SimulateRainToggle from "@/components/SimulateRainToggle";
import { getSlaOverview, SlaOverviewItem, formatHours } from "@/lib/sla";
import DemoBanner from "@/components/DemoBanner";
import { toCsv, downloadCsv, CsvColumn } from "@/lib/csv";

const STATUS_CONFIG: Record<
  string,
  { label: string; badgeStyle: string; dotColor: string }
> = {
  reported: {
    label: "Reported",
    badgeStyle: "bg-blue-100 text-blue-800 border-blue-200",
    dotColor: "bg-blue-500",
  },
  verified: {
    label: "Verified",
    badgeStyle: "bg-indigo-100 text-indigo-800 border-indigo-200",
    dotColor: "bg-indigo-500",
  },
  assigned: {
    label: "Assigned",
    badgeStyle: "bg-purple-100 text-purple-800 border-purple-200",
    dotColor: "bg-purple-500",
  },
  in_progress: {
    label: "In Progress",
    badgeStyle: "bg-amber-100 text-amber-800 border-amber-200",
    dotColor: "bg-amber-500",
  },
  resolved: {
    label: "Resolved",
    badgeStyle: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dotColor: "bg-emerald-500",
  },
  reopened: {
    label: "Reopened",
    badgeStyle: "bg-rose-100 text-rose-800 border-rose-200",
    dotColor: "bg-rose-500",
  },
};

const BAND_BADGES: Record<string, string> = {
  High: "bg-red-100 text-red-800 border-red-200",
  Medium: "bg-amber-100 text-amber-800 border-amber-200",
  Low: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function OfficerDashboardPage() {
  const router = useRouter();

  // Authentication & Profile State
  const [profile, setProfile] = useState<OfficerProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Queue Data State
  const [queue, setQueue] = useState<OfficerQueueItem[]>([]);
  const [slaMap, setSlaMap] = useState<Map<string, SlaOverviewItem>>(new Map());
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Filters State
  const [activeFilter, setActiveFilter] = useState<string>("all_open");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // 1. Guard check: load profile or redirect to /officer/login
  useEffect(() => {
    async function initOfficer() {
      setIsAuthLoading(true);
      try {
        const { data: userProfile, error } = await getMyProfile();
        if (
          error ||
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

  // 2. Fetch ranked queue and SLA overview
  const loadQueue = useCallback(
    async (showRefreshIndicator = false) => {
      if (!profile) return;
      if (showRefreshIndicator) setIsRefreshing(true);
      setQueueError(null);

      // Trigger fire-and-forget SLA escalation run on queue load
      fetch("/api/sla/run").catch(() => {});

      try {
        let statusesParam: string[] | null = null;
        if (activeFilter === "all_open" || activeFilter === "overdue_only") {
          statusesParam = null; // null uses database default (all except resolved)
        } else {
          statusesParam = [activeFilter];
        }

        const [queueRes, slaRes] = await Promise.all([
          fetchOfficerQueue(statusesParam),
          getSlaOverview(),
        ]);

        if (slaRes.data) {
          const sMap = new Map<string, SlaOverviewItem>();
          for (const s of slaRes.data) {
            sMap.set(s.issue_id, s);
          }
          setSlaMap(sMap);
        }

        if (queueRes.error) {
          setQueueError(queueRes.error.message);
        } else {
          setQueue(queueRes.data || []);
          setLastUpdated(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          );
        }
      } catch (err: any) {
        setQueueError(err?.message || "Failed to load officer queue.");
      } finally {
        setIsLoadingQueue(false);
        setIsRefreshing(false);
      }
    },
    [profile, activeFilter]
  );

  // Fetch when profile is ready or filter changes
  useEffect(() => {
    if (profile) {
      loadQueue();
    }
  }, [profile, activeFilter, loadQueue]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      loadQueue(false);
    }, 60000);

    return () => clearInterval(interval);
  }, [profile, loadQueue]);

  // Filtered queue (supporting client-side "Overdue only" filter)
  const displayedQueue = useMemo(() => {
    if (activeFilter === "overdue_only") {
      return queue.filter((item) => {
        const sla = slaMap.get(item.id);
        return (
          sla &&
          (sla.state === "overdue" || sla.state === "severely_overdue")
        );
      });
    }
    return queue;
  }, [queue, activeFilter, slaMap]);

  // Band counts calculation
  const bandCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 };
    for (const item of displayedQueue) {
      if (item.priority_band in counts) {
        counts[item.priority_band as keyof typeof counts]++;
      }
    }
    return counts;
  }, [displayedQueue]);

  const toggleCardExpand = (id: string) => {
    setExpandedCards((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleExportCsv = () => {
    if (displayedQueue.length === 0) return;

    const columns: CsvColumn<OfficerQueueItem>[] = [
      { header: "Rank", accessor: (_row, idx) => idx + 1 },
      { header: "ID", accessor: (row) => row.id },
      { header: "Category", accessor: (row) => row.category_label || row.category },
      { header: "Status", accessor: (row) => row.status },
      { header: "Priority Score", accessor: (row) => row.priority_score },
      { header: "Priority Band", accessor: (row) => row.priority_band },
      { header: "Reasons", accessor: (row) => row.reasons_text || "" },
      { header: "People Affected", accessor: (row) => row.unique_reporters },
      { header: "Ward", accessor: (row) => row.ward_name || "" },
      { header: "Department", accessor: (row) => row.department_name || "" },
      { header: "Assigned Officer", accessor: (row) => row.assigned_to_name || "Unassigned" },
      { header: "Latitude", accessor: (row) => row.lat },
      { header: "Longitude", accessor: (row) => row.lng },
      {
        header: "Google Maps Link",
        accessor: (row) => `https://www.google.com/maps?q=${row.lat},${row.lng}`,
      },
      { header: "Created At", accessor: (row) => row.created_at },
      { header: "Days Open", accessor: (row) => row.days_open },
      { header: "SLA Target Hours", accessor: (row) => row.sla_hours ?? "" },
      {
        header: "SLA State",
        accessor: (row) => {
          const sla = slaMap.get(row.id);
          return sla?.state || "";
        },
      },
      {
        header: "SLA Time Remaining",
        accessor: (row) => {
          const sla = slaMap.get(row.id);
          if (!sla || sla.hours_remaining === null || sla.hours_remaining === undefined) {
            return "";
          }
          return sla.hours_remaining;
        },
      },
    ];

    const todayStr = new Date().toISOString().split("T")[0];
    const filename = `civic-queue-${todayStr}.csv`;
    const csvContent = toCsv(displayedQueue, columns);
    downloadCsv(filename, csvContent);
  };

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

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        <DemoBanner />

        {/* Officer Header */}
        <header className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🏛️</span>
                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    {profile.display_name || "Municipal Officer"}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
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

            {/* Actions: Sign out, Escalations & Link to public tracker */}
            <div className="flex items-center gap-2 sm:self-center">
              <Link
                href="/officer/escalations"
                className="inline-flex items-center justify-center px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200 transition-colors min-h-[44px]"
              >
                Escalations ⚠️ →
              </Link>
              <Link
                href="/tracker"
                className="inline-flex items-center justify-center px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors min-h-[44px]"
              >
                Public Tracker →
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center justify-center px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 transition-colors min-h-[44px] cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Demo Control: Rain simulation toggle */}
        <SimulateRainToggle onToggleComplete={() => loadQueue(false)} />

        {/* Queue Controls & Filter Chips */}
        <section aria-label="Queue Controls" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                Ranked Jurisdiction Queue
              </h2>
              <p className="text-xs text-slate-500">
                Sorted strictly by priority score (high to low), then oldest first.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                  Updated {lastUpdated}
                </span>
              )}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={displayedQueue.length === 0}
                aria-label="Export filtered queue to CSV"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all shadow-2xs min-h-[44px] cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                <span>📥</span>
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() => loadQueue(true)}
                disabled={isRefreshing || isLoadingQueue}
                aria-label="Refresh officer queue"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all shadow-2xs min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Band Summary Strip */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
            <span className="text-slate-600">
              Total in scope: <strong className="text-slate-950">{displayedQueue.length}</strong>
            </span>
            <div className="flex items-center gap-3">
              <span className="text-red-700 font-bold">
                High: {bandCounts.High}
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-amber-700 font-bold">
                Med: {bandCounts.Medium}
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-emerald-700 font-bold">
                Low: {bandCounts.Low}
              </span>
            </div>
          </div>

          {/* Status Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
            {[
              { key: "all_open", label: "All Open" },
              { key: "overdue_only", label: "⚠️ Overdue only" },
              { key: "reported", label: "Reported" },
              { key: "verified", label: "Verified" },
              { key: "assigned", label: "Assigned" },
              { key: "in_progress", label: "In Progress" },
              { key: "reopened", label: "Reopened" },
              { key: "resolved", label: "Resolved" },
            ].map((chip) => {
              const isSelected = activeFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setActiveFilter(chip.key)}
                  className={`inline-flex items-center justify-center px-3.5 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap min-h-[44px] cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900 shadow-2xs"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Error Notice */}
        {queueError && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs text-rose-800 flex items-start gap-2.5">
            <span className="text-base shrink-0">⚠️</span>
            <p className="leading-relaxed font-medium">{queueError}</p>
          </div>
        )}

        {/* Queue Listing */}
        {isLoadingQueue ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-36 bg-white rounded-2xl border border-slate-200 animate-pulse p-5"
              />
            ))}
          </div>
        ) : displayedQueue.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-8 text-center space-y-2">
            <span className="text-3xl">🎉</span>
            <h3 className="text-base font-bold text-slate-900">
              {activeFilter === "overdue_only"
                ? "Nothing is overdue. 🎉"
                : "Queue is completely clear!"}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {activeFilter === "overdue_only"
                ? "All open issues in your jurisdiction are currently within their SLA target window."
                : "There are no matching issues requiring municipal attention in your assigned jurisdiction right now."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayedQueue.map((item, index) => {
              const rank = index + 1;
              const emoji = getCategoryEmoji(item.category);
              const statusCfg = STATUS_CONFIG[item.status] || {
                label: item.status,
                badgeStyle: "bg-slate-100 text-slate-800 border-slate-200",
                dotColor: "bg-slate-500",
              };
              const bandBadge =
                BAND_BADGES[item.priority_band] ||
                "bg-slate-100 text-slate-800 border-slate-200";
              const isExpanded = !!expandedCards[item.id];
              const sla = slaMap.get(item.id);

              return (
                <article
                  key={item.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all overflow-hidden"
                >
                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Top Row: Rank, Category, Status Badge, Score, SLA Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center font-black text-sm px-2.5 py-1 rounded-xl bg-slate-900 text-white min-w-[36px]">
                          #{rank}
                        </span>
                        <div>
                          <h3 className="text-base font-bold text-slate-950 flex items-center gap-1.5">
                            <span>{emoji}</span>
                            <span>{item.category_label || item.category}</span>
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${statusCfg.badgeStyle}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`}
                              />
                              {statusCfg.label}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-extrabold border ${bandBadge}`}
                            >
                              {item.priority_band} ({item.priority_score})
                            </span>
                            {sla && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
                                  sla.state === "severely_overdue"
                                    ? "bg-purple-100 text-purple-900 border-purple-300"
                                    : sla.state === "overdue"
                                    ? "bg-rose-100 text-rose-900 border-rose-300"
                                    : sla.state === "due_soon"
                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                    : sla.state === "met"
                                    ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                    : sla.state === "missed"
                                    ? "bg-slate-100 text-slate-800 border-slate-300"
                                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                }`}
                              >
                                <span>⏱️</span>
                                <span className="capitalize">
                                  {sla.state.replace("_", " ")}
                                  {sla.hours_remaining !== null
                                    ? ` (${formatHours(sla.hours_remaining)})`
                                    : ""}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Photo Thumbnail */}
                      {item.photo_url ? (
                        <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                          <img
                            src={item.photo_url}
                            alt="Issue evidence"
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center text-2xl text-slate-400">
                          {emoji}
                        </div>
                      )}
                    </div>

                    {/* Reasons Text */}
                    {item.reasons_text && (
                      <p className="text-xs sm:text-sm text-slate-700 font-medium bg-slate-50 rounded-xl p-3 border border-slate-200/60 leading-relaxed">
                        {item.reasons_text}
                      </p>
                    )}

                    {/* Metadata Strip */}
                    <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-600 font-medium">
                      <span>👥 {item.unique_reporters} affected</span>
                      <span>⏱️ Open {item.days_open}d</span>
                      <span>🏛️ {item.ward_name || "Unassigned Ward"}</span>
                      <span>👤 {item.assigned_to_name || "Unassigned"}</span>
                      {item.sla_hours && (
                        <span>⏳ SLA: {item.sla_hours}h</span>
                      )}
                    </div>

                    {/* Expandable "Why this rank" panel */}
                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => toggleCardExpand(item.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors min-h-[44px] cursor-pointer"
                      >
                        <span>{isExpanded ? "Hide" : "Why this rank"}</span>
                        <span>{isExpanded ? "▴" : "▾"}</span>
                      </button>

                      {isExpanded && item.score_breakdown && (
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
                          <div className="font-bold uppercase tracking-wider text-slate-500 text-[10px]">
                            Mathematical Score Breakdown (DB Engine)
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Severity
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.severity}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Location & Exposure
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.location}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Frequency
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.frequency}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Neglect / Age
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.age}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Context Boost
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.context_boost}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Equity Adj.
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.equity_adjustment ?? 0}
                              </strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block text-[11px]">
                                Reopen Urgency
                              </span>
                              <strong className="text-slate-900 text-sm">
                                +{item.score_breakdown.reopen_boost ?? 0}
                              </strong>
                            </div>
                            <div className="bg-blue-50 p-2 rounded-lg border border-blue-200">
                              <span className="text-blue-700 block text-[11px] font-bold">
                                Total Priority
                              </span>
                              <strong className="text-blue-900 text-sm font-black">
                                {item.priority_score} / 100
                              </strong>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action: Link to Detail & Resolve page */}
                    <div className="flex items-center justify-end pt-1">
                      <Link
                        href={`/officer/issue/${item.id}`}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold shadow-2xs transition-all min-h-[44px]"
                      >
                        <span>Manage & Act</span>
                        <span>→</span>
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
