"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  PublicIssue,
  getPublicIssue,
  affectedToo,
  signInAnonymouslyIfNeeded,
} from "@/lib/reports";

import { CATEGORY_EMOJIS } from "@/lib/categories";
import FixConfirmation from "@/components/FixConfirmation";
import SlaCard from "@/components/SlaCard";
import {
  useLanguage,
  getCategoryTranslation,
  getStatusTranslation,
  getPriorityBandTranslation,
} from "@/i18n/LanguageContext";
import TextToSpeechButton from "@/components/TextToSpeechButton";

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

export default function IssueDetailPage() {
  const { locale, t } = useLanguage();
  const params = useParams();
  const issueId = params?.id as string;

  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isUpvoting, setIsUpvoting] = useState<boolean>(false);
  const [upvoteMessage, setUpvoteMessage] = useState<string | null>(null);

  // Fetch issue on load or after status transitions
  const loadIssue = useCallback(async (showSkeleton: boolean = true) => {
    if (!issueId) return;
    if (showSkeleton) setIsLoading(true);
    setError(null);

    // Trigger fire-and-forget weather cache refresh and SLA escalation check
    fetch("/api/weather/refresh").catch(() => {});
    fetch("/api/sla/run").catch(() => {});

    // Ensure user session exists to resolve i_support_this correctly
    await signInAnonymouslyIfNeeded();

    const { data, error: fetchErr } = await getPublicIssue(issueId);
    if (fetchErr) {
      setError(fetchErr.message);
    } else if (!data) {
      setError("Issue not found.");
    } else {
      setIssue(data);
    }
    if (showSkeleton) setIsLoading(false);
  }, [issueId]);

  useEffect(() => {
    loadIssue(true);
  }, [loadIssue]);

  // Handle "I'm affected too" click
  const handleAffectedToo = async () => {
    if (!issue || isUpvoting || issue.status === "resolved") return;

    setIsUpvoting(true);
    setUpvoteMessage(null);

    try {
      // Ensure user is signed in
      const { error: authErr } = await signInAnonymouslyIfNeeded();
      if (authErr) {
        throw new Error("Unable to establish user session. Please try again.");
      }

      const { data, error: upvoteErr } = await affectedToo(issue.id);
      if (upvoteErr) {
        throw upvoteErr;
      }

      if (data) {
        // Update live issue state with fresh metrics from database
        setIssue((prev) =>
          prev
            ? {
                ...prev,
                unique_reporters: data.unique_reporters,
                priority_score: data.priority_score,
                priority_band: data.priority_band,
                reasons_text: data.reasons_text,
                i_support_this: true,
              }
            : null
        );

        if (data.already_counted) {
          setUpvoteMessage("You were already counted for this issue.");
        } else {
          setUpvoteMessage("Thank you! Your support has been recorded.");
        }
      }
    } catch (err: any) {
      setUpvoteMessage(err?.message || "Failed to record support.");
    } finally {
      setIsUpvoting(false);
    }
  };

  // --------------------------------------------------------------------------
  // LOADING SKELETON
  // --------------------------------------------------------------------------
  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 max-w-md mx-auto space-y-4">
        <div className="h-6 w-24 bg-slate-200 animate-pulse rounded-md" />
        <div className="h-60 bg-slate-200 animate-pulse rounded-2xl" />
        <div className="h-32 bg-slate-200 animate-pulse rounded-2xl" />
        <div className="h-44 bg-slate-200 animate-pulse rounded-2xl" />
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // ERROR STATE
  // --------------------------------------------------------------------------
  if (error || !issue) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-8 max-w-md mx-auto flex flex-col justify-between">
        <div className="space-y-4 text-center py-12">
          <span className="text-4xl">⚠️</span>
          <h1 className="text-xl font-bold text-slate-800">
            {error || "Issue Not Found"}
          </h1>
          <p className="text-xs text-slate-500">
            The civic issue you are looking for may have been archived or does not exist.
          </p>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-white text-xs font-semibold shadow-xs"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Visual styles according to priority band
  const isHigh = issue.priority_band === "High";
  const isMedium = issue.priority_band === "Medium";

  const bandBadgeStyle = isHigh
    ? "bg-red-100 text-red-800 border-red-300"
    : isMedium
    ? "bg-amber-100 text-amber-800 border-amber-300"
    : "bg-emerald-100 text-emerald-800 border-emerald-300";

  const scoreCardBorder = isHigh
    ? "border-red-400 bg-red-50/70"
    : isMedium
    ? "border-amber-400 bg-amber-50/70"
    : "border-emerald-400 bg-emerald-50/70";

  const emoji = CATEGORY_EMOJIS[issue.category] || "📍";
  const formattedCategory = issue.category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const statusInfo = STATUS_CONFIG[issue.status] || {
    label: issue.status,
    badgeStyle: "bg-slate-100 text-slate-800 border-slate-200",
    dotColor: "bg-slate-500",
  };

  const isResolved = issue.status === "resolved";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 max-w-md mx-auto space-y-5 pb-12">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors py-1 min-h-[44px]"
        >
          ← Back to home
        </Link>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${statusInfo.badgeStyle}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotColor}`} />
          <span>{getStatusTranslation(issue.status, locale)}</span>
        </span>
      </div>

      {/* Title & Category Header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{emoji}</span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            {getCategoryTranslation(issue.category, locale, formattedCategory)}
          </h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {issue.ward_name || "Assigned Ward"} • {issue.department_name || "Department"}
        </p>
      </div>

      {/* Photo Evidence */}
      {issue.photo_url && (
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-xs">
          <div className="relative aspect-video w-full bg-slate-100">
            <img
              src={issue.photo_url}
              alt={formattedCategory}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="px-3.5 py-2 text-[11px] text-slate-400 bg-slate-50/50 flex justify-between items-center border-t border-slate-100">
            <span>Verified citizen photo</span>
            <span>{new Date(issue.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {/* Description if present */}
      {issue.description && (
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            {t("issue.citizenNotes", "Citizen Notes")}
          </span>
          <div className="pt-1">
            <TextToSpeechButton text={issue.description} size="sm" variant="pill" />
          </div>
          </span>
          <p className="text-xs text-slate-700 leading-relaxed">
            {issue.description}
          </p>
        </div>
      )}

      {/* Priority Score Hero Card */}
      <div
        className={`rounded-2xl border p-5 text-center shadow-xs transition-all ${scoreCardBorder}`}
      >
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {t("issue.automatedScore", "Automated Priority Score")}
        </span>
        <div className="flex items-center justify-center gap-2.5 my-2">
          <span className="text-5xl font-black text-slate-900 tracking-tighter">
            {issue.priority_score}
          </span>
          <span className="text-lg font-bold text-slate-400">/ 100</span>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border uppercase tracking-wider mt-0.5 mb-2 ${bandBadgeStyle}`}
        >
          {getPriorityBandTranslation(issue.priority_band, locale)} {t("issue.priority", "Priority")}
        </div>

        {/* People Affected Count */}
        <div className="text-xs font-semibold text-slate-700 mt-1">
          👥 {issue.unique_reporters}{" "}
          {issue.unique_reporters === 1 ? t("issue.personAffected", "person affected") : t("issue.peopleAffected", "people affected")}
        </div>
      </div>

      {/* "I'm Affected Too" Action (Hidden if resolved) */}
      {!isResolved && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={issue.i_support_this || isUpvoting}
            onClick={handleAffectedToo}
            className={`w-full flex items-center justify-center rounded-xl py-3.5 px-5 font-semibold text-sm transition-all min-h-[48px] ${
              issue.i_support_this
                ? "bg-slate-100 text-slate-500 border border-slate-200 cursor-default"
                : "bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white shadow-sm shadow-blue-500/20"
            }`}
          >
            {isUpvoting ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin text-base">⏳</span>
                <span>Recording support...</span>
              </span>
            ) : issue.i_support_this ? (
              <span className="flex items-center gap-1.5">
                <span>✓</span>
                <span>{t("issue.alreadySupported", "You're counted")}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span>🙋</span>
                <span>{t("issue.iAmAffected", "I'm affected too")}</span>
              </span>
            )}
          </button>

          {upvoteMessage && (
            <p className="text-[11px] text-center text-slate-500 italic">
              {upvoteMessage}
            </p>
          )}
        </div>
      )}

      {/* Rationale Callout */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
          Scoring Rationale
        </div>
        <p className="text-xs font-medium text-slate-800 leading-relaxed italic">
          &ldquo;{issue.reasons_text}&rdquo;
        </p>
      </div>

      {/* Score Breakdown Table */}
      {issue.score_breakdown && (
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
            Score Breakdown
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            <div className="flex justify-between py-2">
              <span className="text-slate-600">Severity Points</span>
              <span className="font-semibold text-slate-900">
                +{issue.score_breakdown.severity} pts
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-600">Location &amp; Exposure</span>
              <span className="font-semibold text-slate-900">
                +{issue.score_breakdown.location} pts
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-600">Frequency (Community)</span>
              <span className="font-semibold text-slate-900">
                +{issue.score_breakdown.frequency} pts
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-600">Age / Days Open</span>
              <span className="font-semibold text-slate-900">
                +{issue.score_breakdown.age} pts
              </span>
            </div>
            {issue.score_breakdown.context_boost > 0 && (
              <div className="flex justify-between py-2 text-blue-700 bg-blue-50/50 px-1 rounded">
                <span>Weather / Context Boost</span>
                <span className="font-bold">
                  +{issue.score_breakdown.context_boost} pts
                </span>
              </div>
            )}
            {issue.score_breakdown.reopen_boost > 0 && (
              <div className="flex justify-between py-2 text-rose-700 bg-rose-50/50 px-1 rounded">
                <span>Reopen Penalty Boost</span>
                <span className="font-bold">
                  +{issue.score_breakdown.reopen_boost} pts
                </span>
              </div>
            )}
            {issue.score_breakdown.equity_adjustment > 0 && (
              <div className="flex justify-between py-2 text-purple-700 bg-purple-50/50 px-1 rounded">
                <span>Fairness / Equity Adjustment</span>
                <span className="font-bold">
                  +{issue.score_breakdown.equity_adjustment} pts
                </span>
              </div>
            )}
          </div>
          <p className="mt-2.5 text-[11px] text-slate-400 text-center leading-normal">
            Ward density values are simulated. Road and place data: OpenStreetMap contributors. Weather: Open-Meteo.
          </p>
        </div>
      )}

      {/* Resolution Target (SLA) & Escalation Milestones */}
      <SlaCard issueId={issue.id} issueStatus={issue.status} />

      {/* Fix Confirmation, Resolution Proof & Citizen Dispute Widget */}
      {(issue.status === "resolved" ||
        issue.status === "reopened" ||
        (issue.reopen_count !== undefined && issue.reopen_count > 0)) && (
        <FixConfirmation
          issueId={issue.id}
          status={issue.status}
          reopenCount={issue.reopen_count || 0}
          initialAfterPhotoUrl={issue.after_photo_url}
          onIssueReload={() => loadIssue(false)}
        />
      )}

      {/* Status History Timeline */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
          Status History
        </div>

        {issue.status_history && issue.status_history.length > 0 ? (
          <div className="relative pl-6 space-y-4 border-l-2 border-slate-150 ml-2">
            {issue.status_history.map((step, idx) => {
              const stepCfg = STATUS_CONFIG[step.status] || {
                label: step.status,
                badgeStyle: "bg-slate-100 text-slate-700",
                dotColor: "bg-slate-400",
              };
              const isLast = idx === issue.status_history.length - 1;

              return (
                <div key={idx} className="relative">
                  {/* Timeline dot */}
                  <div
                    className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${stepCfg.dotColor} shadow-xs`}
                  />

                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold capitalize ${
                          isLast ? "text-slate-900" : "text-slate-600"
                        }`}
                      >
                        {stepCfg.label}
                      </span>
                      {isLast && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          Current
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {new Date(step.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Initial report recorded on {new Date(issue.created_at).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="pt-2 text-center">
        <Link
          href="/tracker"
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors py-2 px-3"
        >
          View all issues on public tracker →
        </Link>
      </div>
    </main>
  );
}
