"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  FixStatus,
  getFixStatus,
  confirmFix,
  friendlyFixError,
} from "@/lib/fixes";

interface FixConfirmationProps {
  issueId: string;
  status: string;
  reopenCount: number;
  initialAfterPhotoUrl?: string | null;
  onIssueReload: () => Promise<void> | void;
}

export default function FixConfirmation({
  issueId,
  status,
  reopenCount,
  initialAfterPhotoUrl,
  onIssueReload,
}: FixConfirmationProps) {
  const [fixStatus, setFixStatus] = useState<FixStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reopenedBanner, setReopenedBanner] = useState<{
    newScore: number;
    reasonsText: string;
  } | null>(null);

  // Load latest fix status from database
  const loadFixStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const { data, error } = await getFixStatus(issueId);
    if (error) {
      setErrorMessage(error.message);
    } else {
      setFixStatus(data);
    }
    setIsLoading(false);
  }, [issueId]);

  useEffect(() => {
    loadFixStatus();
  }, [loadFixStatus]);

  // Handle vote button click (Yes or No)
  const handleVote = async (isFixed: boolean) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await confirmFix(issueId, isFixed);
      if (error) {
        setErrorMessage(error.message);
      } else if (data) {
        if (data.reopened) {
          // Calm banner on reopen: "Issue reopened. Priority score is now X" with reasons_text
          setReopenedBanner({
            newScore: data.priority_score,
            reasonsText: data.reasons_text,
          });
          // Reload parent issue data
          await onIssueReload();
          // Reload local fix status
          await loadFixStatus();
        } else {
          // Update local status with new counts and user vote
          setFixStatus((prev) =>
            prev
              ? {
                  ...prev,
                  fixed_yes: data.fixed_yes,
                  fixed_no: data.fixed_no,
                  my_vote: isFixed,
                }
              : null
          );
        }
      }
    } catch (err: any) {
      setErrorMessage(friendlyFixError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isResolved = status === "resolved";
  const isReopened = status === "reopened";
  const effectiveReopenCount = fixStatus?.reopen_count ?? reopenCount;
  const photoUrl = fixStatus?.after_photo_url || initialAfterPhotoUrl;
  const distanceM = fixStatus?.distance_from_issue_m;

  return (
    <div className="space-y-4">
      {/* Calm Banner: Displayed immediately when user's vote triggered a reopen */}
      {reopenedBanner && (
        <div className="rounded-2xl border border-slate-300 bg-slate-100 p-4 space-y-1.5 shadow-xs">
          <p className="text-xs font-bold text-slate-900">
            Issue reopened. Priority score is now {reopenedBanner.newScore}.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed italic">
            &ldquo;{reopenedBanner.reasonsText}&rdquo;
          </p>
        </div>
      )}

      {/* Reopened state banner (persists whenever status is 'reopened' or reopen_count > 0 and not resolved) */}
      {(isReopened || (!isResolved && effectiveReopenCount > 0)) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-900 font-medium shadow-xs">
          <span>
            ⚠️ Reopened after residents disputed the fix (reopened{" "}
            {effectiveReopenCount} {effectiveReopenCount === 1 ? "time" : "times"}).
          </span>
        </div>
      )}

      {/* Disputed photo display when issue is reopened */}
      {(isReopened || (!isResolved && effectiveReopenCount > 0)) && photoUrl && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Previous fix attempt (disputed)
          </span>
          <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
            <img
              src={photoUrl}
              alt="Previous fix attempt (disputed)"
              className="w-full h-full object-cover"
            />
          </div>
          <p className="text-[11px] text-slate-500 text-center leading-normal">
            This prior resolution attempt was disputed by residents and the issue was returned to the work queue.
          </p>
        </div>
      )}

      {/* Resolved state: Resolution Proof + Citizen Verification Voting */}
      {isResolved && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/60 p-4 space-y-3.5 shadow-xs">
          {/* Header & Verification distance */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wide">
              <span>✅</span>
              <span>Resolution Proof</span>
            </div>
            {fixStatus?.resolved_at && (
              <span className="text-[11px] text-emerald-700">
                {new Date(fixStatus.resolved_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* After-Photo */}
          {photoUrl && (
            <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-emerald-200 bg-white">
              <img
                src={photoUrl}
                alt="Resolved fix"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Location Verification Distance */}
          {distanceM !== null && distanceM !== undefined ? (
            <p className="text-[11px] font-semibold text-emerald-900 text-center">
              Fix location verified: {Math.round(distanceM)} m from the reported spot
            </p>
          ) : (
            <p className="text-[11px] text-emerald-800 text-center">
              Officer-submitted verification photo confirming repair completion.
            </p>
          )}

          {/* Vote Counts Summary */}
          {fixStatus && !isLoading && (
            <div className="pt-2 border-t border-emerald-200/80">
              <p className="text-xs text-slate-800 font-medium text-center">
                {fixStatus.fixed_yes} confirmed fixed, {fixStatus.fixed_no} say not fixed. The issue reopens at {fixStatus.reopen_threshold} &apos;not fixed&apos; votes.
              </p>
            </div>
          )}

          {/* Interactive Voting Section */}
          {isLoading ? (
            <div className="py-3 flex items-center justify-center text-xs text-emerald-800">
              <span className="animate-spin mr-2">⏳</span>
              <span>Loading verification status...</span>
            </div>
          ) : fixStatus ? (
            <div className="pt-1 space-y-3">
              {fixStatus.can_vote ? (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-center">
                    Is it really fixed?
                  </h3>

                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Button 1: "Yes, it's fixed" */}
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleVote(true)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 min-h-[44px] text-xs font-bold transition-all ${
                        fixStatus.my_vote === true
                          ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500"
                          : "bg-white text-slate-700 hover:bg-emerald-50 border border-emerald-200"
                      }`}
                    >
                      {fixStatus.my_vote === true && <span>✓</span>}
                      <span>Yes, it&apos;s fixed</span>
                    </button>

                    {/* Button 2: "No, still not fixed" */}
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleVote(false)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 min-h-[44px] text-xs font-bold transition-all ${
                        fixStatus.my_vote === false
                          ? "bg-rose-600 text-white shadow-sm ring-2 ring-rose-500"
                          : "bg-white text-slate-700 hover:bg-rose-50 border border-rose-200"
                      }`}
                    >
                      {fixStatus.my_vote === false && <span>✕</span>}
                      <span>No, still not fixed</span>
                    </button>
                  </div>

                  {fixStatus.my_vote !== null && (
                    <p className="text-[11px] text-center text-slate-500">
                      You voted:{" "}
                      <strong className="text-slate-800">
                        {fixStatus.my_vote ? "Fixed" : "Not fixed"}
                      </strong>
                      . You can click above to change your vote.
                    </p>
                  )}
                </div>
              ) : !fixStatus.is_participant ? (
                <div className="bg-slate-100/80 rounded-xl p-3 border border-slate-200 text-center">
                  <p className="text-xs text-slate-600 leading-normal">
                    Only people who reported or are affected by this issue can confirm the fix.
                  </p>
                </div>
              ) : null}

              {/* Error Alert */}
              {errorMessage && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs text-center">
                  {errorMessage}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
