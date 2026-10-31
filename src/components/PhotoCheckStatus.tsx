"use client";

import React from "react";
import { PhotoVerdictResult, photoCodeMessage } from "@/lib/photoCheck";

interface PhotoCheckStatusProps {
  isChecking: boolean;
  verdictResult: PhotoVerdictResult | null;
  chosenCategory: string;
  categoryMap: Record<string, string>;
  onSwitchCategory?: (newCategory: string) => void;
  onApplySeverity?: (severity: string) => void;
}

export default function PhotoCheckStatus({
  isChecking,
  verdictResult,
  chosenCategory,
  categoryMap,
  onSwitchCategory,
  onApplySeverity,
}: PhotoCheckStatusProps) {
  if (isChecking) {
    return (
      <div
        className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-50/80 border border-blue-200 text-blue-900 text-xs font-semibold animate-pulse"
        role="status"
        aria-live="polite"
      >
        <svg
          className="animate-spin h-4 w-4 text-blue-600 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
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
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
        <span>Checking photo…</span>
      </div>
    );
  }

  if (!verdictResult) {
    return null;
  }

  const { verdict, code, detected_category, suggested_severity } = verdictResult;
  const message = photoCodeMessage(
    code,
    detected_category,
    chosenCategory,
    categoryMap
  );

  const canSwitchCategory =
    code === "mismatch" &&
    detected_category &&
    detected_category !== "other" &&
    detected_category !== "none" &&
    Boolean(onSwitchCategory);

  const detectedLabel =
    detected_category && categoryMap[detected_category]
      ? categoryMap[detected_category]
      : detected_category?.replace(/_/g, " ");

  const severityChip = suggested_severity && onApplySeverity && (
    <button
      type="button"
      onClick={() => onApplySeverity(suggested_severity)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 hover:bg-white text-slate-800 text-[11px] font-bold border border-slate-300 shadow-2xs hover:shadow-xs transition-all cursor-pointer mt-1"
    >
      <span>✨</span>
      <span>
        AI suggests: <strong className="capitalize">{suggested_severity}</strong>. Tap to apply
      </span>
    </button>
  );

  if (verdict === "pass") {
    return (
      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1.5 shadow-2xs">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-black shrink-0">
            ✓
          </span>
          <span>{message}</span>
        </div>
        {severityChip && <div className="pt-0.5">{severityChip}</div>}
      </div>
    );
  }

  if (verdict === "review" || verdict === "unchecked") {
    return (
      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1.5 shadow-2xs">
        <div className="flex items-start gap-2 font-medium">
          <span className="text-sm shrink-0">⚠️</span>
          <span className="leading-relaxed">{message}</span>
        </div>
        {severityChip && <div className="pt-0.5">{severityChip}</div>}
      </div>
    );
  }

  // verdict === "reject"
  return (
    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2 shadow-2xs">
      <div className="flex items-start gap-2 font-semibold">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-rose-600 text-white text-[11px] font-black shrink-0 mt-0.5">
          ✕
        </span>
        <span className="leading-relaxed">{message}</span>
      </div>

      {canSwitchCategory && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => onSwitchCategory!(detected_category!)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-bold text-xs shadow-2xs transition-all cursor-pointer min-h-[36px]"
          >
            <span>⇄</span>
            <span>Switch to {detectedLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
