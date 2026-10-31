"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  OfficerProfile,
  OfficerIssueDetail,
  DepartmentOfficer,
  getMyProfile,
  fetchOfficerIssue,
  fetchDepartmentOfficers,
  setStatus,
  assignIssue,
  resolveIssue,
  uploadResolutionPhoto,
  friendlyOfficerError,
} from "@/lib/officer";
import { compressImage } from "@/lib/reports";
import { getCategoryEmoji } from "@/lib/categories";
import { supabase } from "@/lib/supabase/client";
import {
  useLanguage,
  getCategoryTranslation,
  getStatusTranslation,
  getPriorityBandTranslation,
} from "@/i18n/LanguageContext";
import OfficerAiTranslationCard from "@/components/OfficerAiTranslationCard";
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

const BAND_BADGES: Record<string, string> = {
  High: "bg-red-100 text-red-800 border-red-200",
  Medium: "bg-amber-100 text-amber-800 border-amber-200",
  Low: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function OfficerIssuePage() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const issueId = params?.id as string;

  // Officer Profile & Guard
  const [profile, setProfile] = useState<OfficerProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Issue Data
  const [issue, setIssue] = useState<OfficerIssueDetail | null>(null);
  const [isLoadingIssue, setIsLoadingIssue] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Department Officers list for assignment
  const [departmentOfficers, setDepartmentOfficers] = useState<DepartmentOfficer[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");

  // Action & Feedback State
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Photo Checks (Step 10A)
  const [photoChecks, setPhotoChecks] = useState<
    Array<{
      photo_url: string;
      verdict: string;
      code: string;
      detected_category: string | null;
      confidence: number | null;
      created_at: string;
    }>
  >([]);

  // Resolution Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoLat, setPhotoLat] = useState<number | null>(null);
  const [photoLng, setPhotoLng] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [isAcquiringGps, setIsAcquiringGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // 1. Guard check: load officer profile
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

  // 2. Fetch issue data, photo checks, and eligible assignees
  const loadIssue = useCallback(async () => {
    if (!issueId) return;
    setFetchError(null);

    try {
      const { data, error } = await fetchOfficerIssue(issueId);
      if (error) {
        setFetchError(error.message);
      } else if (!data) {
        setFetchError("Issue not found or outside your jurisdiction.");
      } else {
        setIssue(data);
        if (data.assigned_to) {
          setSelectedAssignee(data.assigned_to);
        }
      }

      // Fetch officer photo checks via RPC
      const { data: checksData, error: checksError } = await supabase.rpc(
        "officer_photo_checks",
        { p_issue_id: issueId }
      );
      if (!checksError && Array.isArray(checksData)) {
        setPhotoChecks(checksData);
      }
    } catch (err: any) {
      setFetchError(err?.message || "Failed to load issue.");
    } finally {
      setIsLoadingIssue(false);
    }
  }, [issueId]);

  useEffect(() => {
    if (profile && issueId) {
      loadIssue();
      // Fetch department officers for the assignment dropdown
      fetchDepartmentOfficers().then(({ data }) => {
        if (data) setDepartmentOfficers(data);
      });
    }
  }, [profile, issueId, loadIssue]);

  // GPS Acquisition helper
  const acquireLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setIsAcquiringGps(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPhotoLat(position.coords.latitude);
        setPhotoLng(position.coords.longitude);
        setGpsAccuracy(position.coords.accuracy);
        setIsAcquiringGps(false);
      },
      (err) => {
        setIsAcquiringGps(false);
        setGpsError(
          err.message ||
            "Unable to access GPS location. Please ensure location permissions are granted."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // Handle Photo File selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setActionError(null);
    setActionSuccess(null);

    // Prompt for GPS capture upon selecting photo
    acquireLocation();
  };

  // Status Action: "Mark verified" or "Start work"
  const handleStatusChange = async (newStatus: string) => {
    if (!issue) return;
    setIsSubmittingAction(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const { data, error } = await setStatus(issue.id, newStatus);
      if (error) {
        throw error;
      }
      setActionSuccess(
        `Status successfully updated to ${STATUS_CONFIG[data?.status || newStatus]?.label || newStatus}.`
      );
      await loadIssue();
    } catch (err: any) {
      setActionError(friendlyOfficerError(err));
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Assignment Action: Assign to officer
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issue || !selectedAssignee) return;

    setIsSubmittingAction(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const { data, error } = await assignIssue(issue.id, selectedAssignee);
      if (error) {
        throw error;
      }
      setActionSuccess(
        `Issue assigned to ${data?.assigned_to_name || "designated officer"}.`
      );
      await loadIssue();
    } catch (err: any) {
      setActionError(friendlyOfficerError(err));
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Resolution Action: Submit with photo & GPS
  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issue || !selectedFile || photoLat === null || photoLng === null || !profile) {
      setActionError(
        "Both an after-repair photo and GPS location coordinates are required."
      );
      return;
    }

    setIsSubmittingAction(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      // 1. Compress image in browser (reusing compressImage)
      const compressedBlob = await compressImage(selectedFile);

      // 2. Upload to resolution-photos storage bucket
      const { publicUrl, error: uploadErr } = await uploadResolutionPhoto(
        profile.id,
        compressedBlob
      );

      if (uploadErr || !publicUrl) {
        throw uploadErr || new Error("Failed to upload resolution photo to storage.");
      }

      // 3. Call officer_resolve RPC
      const { data: resData, error: resolveErr } = await resolveIssue(
        issue.id,
        publicUrl,
        photoLat,
        photoLng
      );

      if (resolveErr) {
        throw resolveErr;
      }

      setActionSuccess(
        `Issue verified and resolved! After-photo confirmed within ${resData?.distance_from_issue_m ?? 0} m.`
      );
      setSelectedFile(null);
      setPreviewUrl(null);
      setPhotoLat(null);
      setPhotoLng(null);
      await loadIssue();
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      if (
        rawMsg.includes("After-photo is too far") ||
        rawMsg.includes("100 m") ||
        rawMsg.includes("too far")
      ) {
        setActionError(
          "The after-photo must be taken within 100 m of the reported location."
        );
      } else {
        setActionError(friendlyOfficerError(err));
      }
    } finally {
      setIsSubmittingAction(false);
    }
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

  if (isLoadingIssue) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-medium text-sm">
          <span className="animate-spin text-xl">⏳</span>
          <span>Loading issue details...</span>
        </div>
      </main>
    );
  }

  if (fetchError || !issue) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex flex-col items-center justify-center space-y-4">
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 max-w-md text-center space-y-2">
          <span className="text-3xl">⚠️</span>
          <h2 className="text-base font-bold text-rose-900">Access Denied or Not Found</h2>
          <p className="text-xs text-rose-800 leading-relaxed">
            {fetchError || "This issue could not be found or is outside your jurisdiction."}
          </p>
        </div>
        <Link
          href="/officer"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold min-h-[44px]"
        >
          ← Back to Officer Queue
        </Link>
      </main>
    );
  }

  const emoji = getCategoryEmoji(issue.category);
  const statusCfg = STATUS_CONFIG[issue.status] || {
    label: issue.status,
    badgeStyle: "bg-slate-100 text-slate-800 border-slate-200",
    dotColor: "bg-slate-500",
  };
  const bandBadge =
    BAND_BADGES[issue.priority_band] ||
    "bg-slate-100 text-slate-800 border-slate-200";

  const canMarkVerified = issue.status === "reported";
  const canAssign = ["reported", "verified", "reopened", "assigned"].includes(
    issue.status
  );
  const canStartWork = issue.status === "assigned";
  const canResolve = ["assigned", "in_progress"].includes(issue.status);

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        {/* Navigation Breadcrumb */}
        <div>
          <Link
            href="/officer"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 min-h-[44px] transition-colors"
          >
            ← Back to Officer Queue
          </Link>
        </div>

        {/* Action Notifications */}
        {actionSuccess && (
          <div
            role="status"
            className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-semibold text-emerald-900 flex items-start gap-2.5 shadow-2xs"
          >
            <span className="text-base shrink-0">✅</span>
            <p className="leading-relaxed">{actionSuccess}</p>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-900 flex items-start gap-2.5 shadow-2xs"
          >
            <span className="text-base shrink-0">⚠️</span>
            <p className="leading-relaxed">{actionError}</p>
          </div>
        )}

        {/* Issue Details Card */}
        <section className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6 space-y-5">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{emoji}</span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 tracking-tight">
                  {getCategoryTranslation(issue.category, locale, issue.category_label || issue.category)}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusCfg.badgeStyle}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`}
                  />
                  {getStatusTranslation(issue.status, locale)}
                </span>

                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black border ${bandBadge}`}
                >
                  {getPriorityBandTranslation(issue.priority_band, locale)} ({issue.priority_score}/100)
                </span>

                {issue.severity_level && (
                  <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 capitalize">
                    {issue.severity_level}
                  </span>
                )}
              </div>
            </div>

            {/* SLA indicator */}
            {issue.sla_hours && (
              <div className="sm:text-right shrink-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  Target SLA
                </span>
                <span className="text-sm font-extrabold text-slate-900">
                  {issue.sla_hours} hours
                </span>
              </div>
            )}
          </div>

          {/* Dispute Reopened Notice */}
          {issue.status === "reopened" && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800 flex items-center gap-2 shadow-2xs">
              <span className="text-base">⚠️</span>
              <span>
                This issue was reopened because the previous fix was disputed by residents.
              </span>
            </div>
          )}

          {/* Original Evidence Photo */}
          {issue.photo_url && (
            <div className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Citizen Photo Evidence
              </span>
              <div className="w-full max-h-80 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
                <img
                  src={issue.photo_url}
                  alt="Original report evidence"
                  className="w-full h-full object-cover max-h-80"
                />
              </div>
            </div>
          )}

          {/* Photo Check (Step 10A) */}
          {photoChecks && photoChecks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Photo Check
              </span>
              <div className="space-y-2">
                {photoChecks.map((pc, idx) => {
                  let badgeLabel = "Not verified";
                  let badgeStyle = "bg-slate-100 text-slate-700 border-slate-300";

                  if (pc.verdict === "pass") {
                    badgeLabel = "Verified";
                    badgeStyle = "bg-emerald-100 text-emerald-800 border-emerald-300";
                  } else if (pc.verdict === "review") {
                    badgeLabel = "Needs review";
                    badgeStyle = "bg-amber-100 text-amber-800 border-amber-300";
                  } else if (pc.verdict === "reject") {
                    badgeLabel = "Rejected";
                    badgeStyle = "bg-rose-100 text-rose-800 border-rose-300";
                  }

                  const confidencePct =
                    pc.confidence !== null && pc.confidence !== undefined
                      ? `${Math.round(Number(pc.confidence) * 100)}%`
                      : null;

                  const detectedLabel = pc.detected_category
                    ? pc.detected_category.replace(/_/g, " ")
                    : "Unclassified";

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold border ${badgeStyle}`}
                        >
                          {badgeLabel}
                        </span>
                        <span className="text-slate-800 font-medium capitalize">
                          {detectedLabel}
                          {confidencePct ? ` (${confidencePct})` : ""}
                        </span>
                      </div>
                      <span className="text-slate-400 text-[11px]">
                        {new Date(pc.created_at).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Translation and Citizen Description (Gemini AI with original preservation & TTS) */}
          {issue.description && (
            <OfficerAiTranslationCard originalText={issue.description} />
          )}

          {/* Reasons Text */}
          {issue.reasons_text && (
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Ranking Rationale
              </span>
              <p className="text-xs sm:text-sm font-medium text-slate-700 leading-relaxed bg-blue-50/60 p-3.5 rounded-xl border border-blue-100">
                {issue.reasons_text}
              </p>
            </div>
          )}

          {/* "Why this rank" Breakdown Grid */}
          {issue.score_breakdown && (
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Why This Rank (Scoring Breakdown)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Severity</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.severity}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">
                    Location & Exposure
                  </span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.location}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Frequency</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.frequency}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Age / Neglect</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.age}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Context Boost</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.context_boost}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Equity Adj.</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.equity_adjustment ?? 0}
                  </strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Reopen Urgency</span>
                  <strong className="text-slate-900 text-sm font-bold">
                    +{issue.score_breakdown.reopen_boost ?? 0}
                  </strong>
                </div>
                <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-200">
                  <span className="text-blue-700 block text-[11px] font-bold">Total Score</span>
                  <strong className="text-blue-900 text-sm font-black">
                    {issue.priority_score} / 100
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Location & Jurisdiction Specifications */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Site & Jurisdiction Details
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-500 block text-[11px]">GPS Coordinates</span>
                <p className="font-mono font-bold text-slate-900 text-xs">
                  {issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}
                </p>
                {issue.address && (
                  <p className="text-slate-600 text-[11px]">{issue.address}</p>
                )}
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <span className="text-slate-500 block text-[11px]">Administrative Assignment</span>
                <p className="text-slate-900 font-bold">
                  Ward: {issue.ward_name || "Unassigned"}
                </p>
                <p className="text-slate-600">
                  Dept: {issue.department_name || "Unassigned"}
                </p>
                <p className="text-slate-600">
                  Road Class: <span className="capitalize">{issue.road_class}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Status Timeline */}
          {issue.status_history && issue.status_history.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Status Audit Timeline
              </span>
              <div className="space-y-2">
                {issue.status_history.map((entry, idx) => {
                  const entryCfg = STATUS_CONFIG[entry.status] || {
                    label: entry.status,
                    badgeStyle: "bg-slate-100 text-slate-800 border-slate-200",
                    dotColor: "bg-slate-500",
                  };
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                    >
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border ${entryCfg.badgeStyle}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${entryCfg.dotColor}`} />
                        {entryCfg.label}
                      </span>
                      <span className="text-slate-500 font-medium">
                        {new Date(entry.created_at).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Existing Resolution Proof (if resolved) */}
          {issue.after_photo_url && (
            <div className="space-y-2 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 block">
                  Verified Proof of Resolution
                </span>
                {issue.distance_from_issue_m !== null && (
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    GPS verified: {issue.distance_from_issue_m} m from site
                  </span>
                )}
              </div>
              <div className="w-full max-h-80 rounded-2xl overflow-hidden border border-emerald-200 bg-emerald-50/50">
                <img
                  src={issue.after_photo_url}
                  alt="Resolution proof"
                  className="w-full h-full object-cover max-h-80"
                />
              </div>
            </div>
          )}
        </section>

        {/* =========================================================================
            ACTIONS PANEL: Only displayed when allowed for current status
           ========================================================================= */}
        <section aria-label="Officer Actions" className="space-y-4">
          {/* Action 1: Mark verified (reported -> verified) */}
          {canMarkVerified && (
            <div className="bg-white rounded-2xl border border-indigo-200 shadow-2xs p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Step 1: Verify Civic Hazard
                </h3>
                <p className="text-xs text-slate-500">
                  Confirm that this citizen complaint is legitimate and requires municipal intervention.
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => handleStatusChange("verified")}
                className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs transition-all min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                {isSubmittingAction ? "Updating..." : "Mark verified"}
              </button>
            </div>
          )}

          {/* Action 2: Assign Officer (reported, verified, reopened, assigned) */}
          {canAssign && (
            <div className="bg-white rounded-2xl border border-purple-200 shadow-2xs p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Delegate / Reassign Issue
                </h3>
                <p className="text-xs text-slate-500">
                  Assign to an active officer in the {issue.department_name || "responsible"} department.
                </p>
              </div>

              <form
                onSubmit={handleAssignSubmit}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
              >
                <select
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-purple-600/20"
                >
                  <option value="">Choose officer to assign...</option>
                  {departmentOfficers.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.display_name}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  disabled={!selectedAssignee || isSubmittingAction}
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-2xs transition-all min-h-[44px] cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingAction ? "Assigning..." : "Confirm Assignment"}
                </button>
              </form>
            </div>
          )}

          {/* Action 3: Start work (assigned -> in_progress) */}
          {canStartWork && (
            <div className="bg-white rounded-2xl border border-amber-200 shadow-2xs p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Step 2: Commence Physical Repair
                </h3>
                <p className="text-xs text-slate-500">
                  Signal that field crews or repair equipment are on-site and working.
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => handleStatusChange("in_progress")}
                className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-2xs transition-all min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                {isSubmittingAction ? "Updating..." : "Start work"}
              </button>
            </div>
          )}

          {/* Action 4: Resolve with After-Photo & GPS Check (assigned or in_progress) */}
          {canResolve && (
            <div className="bg-white rounded-2xl border border-emerald-300 shadow-xs p-5 sm:p-6 space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">📸</span>
                  <h3 className="text-base font-extrabold text-slate-950">
                    Resolve with Proof of Work
                  </h3>
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Upload an after-repair photo. The platform verifies through device GPS
                  that you are physically standing within <strong>100 meters</strong> of the reported site.
                </p>
              </div>

              <form onSubmit={handleResolveSubmit} className="space-y-4">
                {/* File picker */}
                <div>
                  <label
                    htmlFor="resolution-photo-input"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
                  >
                    After-Repair Photograph
                  </label>
                  <input
                    id="resolution-photo-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="block w-full text-xs text-slate-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-black min-h-[44px] cursor-pointer"
                  />
                </div>

                {/* Photo Preview */}
                {previewUrl && (
                  <div className="w-full max-h-60 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    <img
                      src={previewUrl}
                      alt="Resolution photo preview"
                      className="w-full h-full object-cover max-h-60"
                    />
                  </div>
                )}

                {/* GPS Location Status Indicator */}
                <div className="rounded-xl p-3.5 border text-xs space-y-2 bg-slate-50 border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                      Verification Geolocation
                    </span>
                    <button
                      type="button"
                      onClick={acquireLocation}
                      disabled={isAcquiringGps}
                      className="text-blue-600 hover:text-blue-800 font-bold underline text-xs cursor-pointer min-h-[36px] flex items-center"
                    >
                      {isAcquiringGps ? "Acquiring..." : "Refresh GPS"}
                    </button>
                  </div>

                  {photoLat !== null && photoLng !== null ? (
                    <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg font-medium">
                      <span>✅</span>
                      <span>
                        Location captured: <strong>{photoLat.toFixed(5)}, {photoLng.toFixed(5)}</strong>
                        {gpsAccuracy && ` (±${Math.round(gpsAccuracy)}m)`}
                      </span>
                    </div>
                  ) : isAcquiringGps ? (
                    <div className="flex items-center gap-2 text-blue-800 bg-blue-50 border border-blue-200 p-2.5 rounded-lg font-medium">
                      <span className="animate-spin">⏳</span>
                      <span>Acquiring high-accuracy GPS coordinates...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-lg font-medium">
                      <span>📍</span>
                      <span>Turn on device location to resolve</span>
                    </div>
                  )}

                  {gpsError && (
                    <p className="text-rose-700 text-[11px] font-medium pt-1">
                      {gpsError}
                    </p>
                  )}
                </div>

                {/* Submit Resolution Button */}
                <button
                  type="submit"
                  disabled={
                    !selectedFile ||
                    photoLat === null ||
                    photoLng === null ||
                    isSubmittingAction
                  }
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 text-xs font-bold shadow-sm transition-all min-h-[44px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingAction ? (
                    <>
                      <span className="animate-spin text-base">⏳</span>
                      <span>Uploading & verifying proximity...</span>
                    </>
                  ) : (
                    <span>Complete Resolution & Close Issue</span>
                  )}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
