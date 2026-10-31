"use client";

import React, { useEffect, useState } from "react";
import {
  SlaOverviewItem,
  IssueEscalationNotice,
  getSlaOverview,
  getIssueEscalations,
  formatHours,
  SlaState,
} from "@/lib/sla";

interface SlaCardProps {
  issueId: string;
  issueStatus?: string;
}

const STATE_CONFIG: Record<
  SlaState,
  { label: string; badgeStyle: string; dotColor: string; icon: string }
> = {
  on_track: {
    label: "On track",
    badgeStyle: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dotColor: "bg-emerald-500",
    icon: "⏱️",
  },
  due_soon: {
    label: "Due soon",
    badgeStyle: "bg-amber-50 text-amber-800 border-amber-200",
    dotColor: "bg-amber-500",
    icon: "⏳",
  },
  overdue: {
    label: "Overdue",
    badgeStyle: "bg-rose-50 text-rose-800 border-rose-200",
    dotColor: "bg-rose-500",
    icon: "⚠️",
  },
  severely_overdue: {
    label: "Severely overdue",
    badgeStyle: "bg-purple-50 text-purple-800 border-purple-200",
    dotColor: "bg-purple-600",
    icon: "🚨",
  },
  met: {
    label: "SLA met",
    badgeStyle: "bg-emerald-100 text-emerald-800 border-emerald-300",
    dotColor: "bg-emerald-600",
    icon: "✅",
  },
  missed: {
    label: "SLA missed",
    badgeStyle: "bg-slate-100 text-slate-800 border-slate-300",
    dotColor: "bg-slate-500",
    icon: "❌",
  },
};

export default function SlaCard({ issueId, issueStatus }: SlaCardProps) {
  const [overview, setOverview] = useState<SlaOverviewItem | null>(null);
  const [escalations, setEscalations] = useState<IssueEscalationNotice[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSlaData() {
      setIsLoading(true);
      setError(null);

      try {
        const [overviewRes, escalationsRes] = await Promise.all([
          getSlaOverview(issueId),
          getIssueEscalations(issueId),
        ]);

        if (!isMounted) return;

        if (overviewRes.error) {
          setError(overviewRes.error.message);
        } else if (overviewRes.data && overviewRes.data.length > 0) {
          setOverview(overviewRes.data[0]);
        }

        if (escalationsRes.data) {
          setEscalations(escalationsRes.data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || "Failed to load SLA details");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    if (issueId) {
      loadSlaData();
    }

    return () => {
      isMounted = false;
    };
  }, [issueId]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-4 animate-pulse space-y-3">
        <div className="h-4 w-32 bg-slate-200 rounded" />
        <div className="h-8 w-full bg-slate-100 rounded" />
      </div>
    );
  }

  if (error || !overview) {
    return null;
  }

  const stateCfg = STATE_CONFIG[overview.state] || {
    label: overview.state,
    badgeStyle: "bg-slate-100 text-slate-800 border-slate-200",
    dotColor: "bg-slate-400",
    icon: "⏱️",
  };

  const isReopened =
    overview.status === "reopened" || issueStatus === "reopened";

  const formattedRemaining =
    overview.hours_remaining !== null
      ? formatHours(overview.hours_remaining)
      : null;

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⏱️</span>
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Resolution Target (SLA)
          </span>
        </div>

        {/* State Badge */}
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${stateCfg.badgeStyle}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${stateCfg.dotColor}`} />
          <span>{stateCfg.label}</span>
          {formattedRemaining && (
            <span className="font-semibold opacity-90">
              • {formattedRemaining}
            </span>
          )}
        </span>
      </div>

      {/* Target & Due Date Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-50/75 rounded-lg p-2.5 border border-slate-100">
          <span className="text-slate-500 font-medium block text-[11px]">
            Target Window
          </span>
          <span className="font-bold text-slate-900 mt-0.5 block">
            {overview.sla_hours ? `${overview.sla_hours} hours` : "Not specified"}
          </span>
        </div>

        <div className="bg-slate-50/75 rounded-lg p-2.5 border border-slate-100">
          <span className="text-slate-500 font-medium block text-[11px]">
            Target Deadline
          </span>
          <span className="font-bold text-slate-900 mt-0.5 block truncate">
            {overview.due_at
              ? new Date(overview.due_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        </div>
      </div>

      {/* Clock Restart Notice for Reopened Issues */}
      {isReopened && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50/70 border border-rose-100 text-rose-800 text-xs font-medium">
          <span className="shrink-0 text-sm">🔄</span>
          <span>The clock restarts when a fix is disputed</span>
        </div>
      )}

      {/* Escalation History Notices */}
      {escalations.length > 0 && (
        <div className="space-y-2 pt-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Escalation Notices
          </span>
          <div className="space-y-1.5">
            {escalations.map((esc, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs border ${
                  esc.level === 2
                    ? "bg-purple-50/70 text-purple-900 border-purple-200"
                    : "bg-amber-50/70 text-amber-900 border-amber-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-black text-[11px] px-1.5 py-0.5 rounded bg-white/80 border border-current">
                    Level {esc.level}
                  </span>
                  <span className="font-semibold">{esc.label}</span>
                </div>
                <span className="text-[11px] opacity-75 shrink-0">
                  {new Date(esc.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footnote */}
      <p className="text-[11px] text-slate-400 text-center leading-normal pt-1">
        The escalation hierarchy is simulated in this prototype.
      </p>
    </div>
  );
}
