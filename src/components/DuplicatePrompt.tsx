"use client";

import React from "react";
import Image from "next/image";
import { DuplicateCandidate } from "@/lib/reports";

const CATEGORY_EMOJIS: Record<string, string> = {
  pothole: "🕳️",
  waterlogging: "🌊",
  garbage: "🗑️",
  broken_streetlight: "💡",
  open_manhole: "⚠️",
  water_leak: "🚰",
  drainage: "🚯",
  damaged_road_marking: "🛣️",
  other: "❓",
};

interface DuplicatePromptProps {
  candidates: DuplicateCandidate[];
  onSelectMerge: (candidate: DuplicateCandidate) => void;
  onSubmitNew: () => void;
  onBackToEdit: () => void;
  isSubmitting: boolean;
  submittingCandidateId: string | null;
}

export default function DuplicatePrompt({
  candidates,
  onSelectMerge,
  onSubmitNew,
  onBackToEdit,
  isSubmitting,
  submittingCandidateId,
}: DuplicatePromptProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center pt-2">
        <span className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-100 text-amber-600 text-2xl mb-3 shadow-xs">
          🔍
        </span>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Is this the same issue?
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
          We found {candidates.length === 1 ? "an open issue" : `${candidates.length} open issues`} of this type near your pin. Attaching your report helps resolve it faster.
        </p>
      </div>

      {/* Candidate Cards List */}
      <div className="space-y-4">
        {candidates.map((candidate) => {
          const emoji = CATEGORY_EMOJIS[candidate.category] || "📍";
          const formattedCategory = candidate.category
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          const isHigh = candidate.priority_band === "High";
          const isMedium = candidate.priority_band === "Medium";

          const bandBadge = isHigh
            ? "bg-red-100 text-red-800 border-red-200"
            : isMedium
            ? "bg-amber-100 text-amber-800 border-amber-200"
            : "bg-emerald-100 text-emerald-800 border-emerald-200";

          const isThisCardSubmitting =
            isSubmitting && submittingCandidateId === candidate.issue_id;

          return (
            <div
              key={candidate.issue_id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
            >
              {/* Photo & Distance Header */}
              <div className="flex gap-3 items-start">
                {candidate.photo_url ? (
                  <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                    <img
                      src={candidate.photo_url}
                      alt={candidate.category}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center text-3xl shrink-0 border border-slate-200">
                    {emoji}
                  </div>
                )}

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-bold text-slate-900 truncate">
                      {emoji} {formattedCategory}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 capitalize shrink-0">
                      {candidate.status}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                    <span>📍</span>
                    <span>{candidate.distance_m} m from your pin</span>
                  </div>

                  <div className="text-xs font-medium text-slate-600 flex items-center gap-1">
                    <span>👥</span>
                    <span>
                      {candidate.unique_reporters}{" "}
                      {candidate.unique_reporters === 1
                        ? "person has"
                        : "people have"}{" "}
                      reported this
                    </span>
                  </div>

                  <div className="pt-0.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold border uppercase tracking-wider ${bandBadge}`}
                    >
                      {candidate.priority_band} • Score {candidate.priority_score}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rationale Snippet */}
              {candidate.reasons_text && (
                <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-150 leading-relaxed italic">
                  &ldquo;{candidate.reasons_text}&rdquo;
                </div>
              )}

              {/* Merge Button for this Card */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onSelectMerge(candidate)}
                className="w-full flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all py-3 px-4 text-white font-semibold text-sm shadow-xs min-h-[44px]"
              >
                {isThisCardSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    <span>Merging report...</span>
                  </span>
                ) : (
                  <span>Yes, this is the same issue</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Global Action: No, this is different */}
      <div className="space-y-3 pt-2">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onSubmitNew}
          className="w-full flex items-center justify-center rounded-xl bg-white hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all border border-slate-300 py-3.5 px-4 text-slate-800 font-semibold text-sm shadow-xs min-h-[44px]"
        >
          {isSubmitting && submittingCandidateId === null ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              <span>Submitting as new issue...</span>
            </span>
          ) : (
            <span>No, this is a different issue</span>
          )}
        </button>

        <div className="text-center">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onBackToEdit}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors py-2 px-4 disabled:opacity-50"
          >
            ← Back to edit report
          </button>
        </div>
      </div>
    </div>
  );
}
