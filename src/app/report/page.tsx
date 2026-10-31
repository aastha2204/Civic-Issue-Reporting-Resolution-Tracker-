"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Category,
  SubmitReportResult,
  DuplicateCandidate,
  signInAnonymouslyIfNeeded,
  fetchCategories,
  compressImage,
  uploadReportPhoto,
  submitReport,
  checkDuplicates,
} from "@/lib/reports";
import DuplicatePrompt from "@/components/DuplicatePrompt";
import PhotoCheckStatus from "@/components/PhotoCheckStatus";
import {
  analyzePhoto,
  checkPhoto,
  PhotoVerdictResult,
  photoCodeMessage,
} from "@/lib/photoCheck";

// Dynamically import Leaflet LocationPicker component with SSR disabled
const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="h-64 sm:h-72 w-full bg-slate-100 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-sm border border-slate-200">
      <div className="flex items-center gap-2">
        <span className="animate-spin text-lg">⏳</span>
        <span>Loading interactive map...</span>
      </div>
    </div>
  ),
});

import { CATEGORY_EMOJIS } from "@/lib/categories";
import {
  useLanguage,
  getCategoryTranslation,
  getSeverityTranslation,
  getPriorityBandTranslation,
} from "@/i18n/LanguageContext";
import VoiceRecorder from "@/components/VoiceRecorder";
import TextToSpeechButton from "@/components/TextToSpeechButton";

export default function ReportPage() {
  const { locale, t } = useLanguage();
  // Authentication & session state
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Categories loaded strictly from Supabase
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // Form input state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoLat, setPhotoLat] = useState<number | null>(null);
  const [photoLng, setPhotoLng] = useState<number | null>(null);

  // Photo verification & upload state
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [uploadedPhotoPath, setUploadedPhotoPath] = useState<string | null>(null);
  const [isCheckingPhoto, setIsCheckingPhoto] = useState<boolean>(false);
  const [photoVerdict, setPhotoVerdict] = useState<PhotoVerdictResult | null>(null);
  const prevCategoryRef = useRef<string>("");

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("moderate");

  // Location state: Bangalore center default (12.9716, 77.5946)
  const [pinLat, setPinLat] = useState<number>(12.9716);
  const [pinLng, setPinLng] = useState<number>(77.5946);
  const [gpsStatus, setGpsStatus] = useState<
    "prompt" | "granted" | "denied" | "unavailable"
  >("prompt");

  const [description, setDescription] = useState<string>("");
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [onBehalf, setOnBehalf] = useState<boolean>(false);

  // Duplicate detection & Submission lifecycle state
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState<boolean>(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [submittingCandidateId, setSubmittingCandidateId] = useState<string | null>(null);
  const [mergedCandidateBefore, setMergedCandidateBefore] = useState<DuplicateCandidate | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] =
    useState<SubmitReportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 1. Initialise anonymous authentication on load
  useEffect(() => {
    async function initAuth() {
      const { user, error } = await signInAnonymouslyIfNeeded();
      if (error) {
        setAuthError(
          `Could not initialize session: ${error.message} (Supabase code: ${(error as any).code || "unknown"})`
        );
      } else {
        setCurrentUser(user);
      }
    }
    initAuth();
  }, []);

  // 2. Fetch categories strictly from Supabase categories table
  useEffect(() => {
    async function loadCategories() {
      setCategoriesLoading(true);
      const { data, error } = await fetchCategories();
      if (error) {
        setCategoriesError(error.message);
      } else {
        setCategories(data);
        if (data.length > 0) {
          setSelectedCategory(data[0].key);
        }
      }
      setCategoriesLoading(false);
    }
    loadCategories();
  }, []);

  // Category key-to-label map for UI messaging
  const categoryMap = useMemo(() => {
    return categories.reduce<Record<string, string>>((acc, cat) => {
      acc[cat.key] = cat.label;
      return acc;
    }, {});
  }, [categories]);

  // 3. Request GPS location on initial load
  const requestBrowserGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPinLat(pos.coords.latitude);
        setPinLng(pos.coords.longitude);
        setGpsStatus("granted");
      },
      () => {
        setGpsStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  useEffect(() => {
    // Fire-and-forget weather refresh
    fetch("/api/weather/refresh").catch(() => {});
    requestBrowserGps();
  }, []);

  // 4. Handle photo file selection and record instant GPS reading, then immediately upload & verify
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
    setSubmitError(null);

    // Discard previous uploaded photo & verdict
    setUploadedPhotoUrl(null);
    setUploadedPhotoPath(null);
    setPhotoVerdict(null);

    // Record GPS reading at the exact instant the photo is chosen
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPhotoLat(pos.coords.latitude);
          setPhotoLng(pos.coords.longitude);
          setGpsStatus("granted");
        },
        () => {
          // GPS is off or denied: send null as requested
          setPhotoLat(null);
          setPhotoLng(null);
          setGpsStatus("denied");
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      setPhotoLat(null);
      setPhotoLng(null);
      setGpsStatus("unavailable");
    }

    // Ensure session is available
    let user = currentUser;
    if (!user) {
      const { user: authedUser } = await signInAnonymouslyIfNeeded();
      if (authedUser) {
        user = authedUser;
        setCurrentUser(authedUser);
      }
    }

    if (!user) {
      setSubmitError("Authenticating session... Please re-select the photo.");
      return;
    }

    setIsCheckingPhoto(true);

    try {
      // Step A: Compress image in browser (max 1280px, quality 0.8)
      const compressedBlob = await compressImage(file, 1280, 0.8);

      // Step B: Upload to report-photos bucket at {userId}/{uuid}.jpg
      const { publicUrl, path, error: uploadErr } = await uploadReportPhoto(
        user.id,
        compressedBlob
      );

      if (uploadErr || !publicUrl || !path) {
        throw new Error(
          uploadErr?.message || "Failed to upload photo for verification."
        );
      }

      setUploadedPhotoUrl(publicUrl);
      setUploadedPhotoPath(path);

      // Step C: Trigger server-side AI analysis
      await analyzePhoto(path);

      // Step D: Trigger database verdict evaluation
      let { data: verdictData } = await checkPhoto(publicUrl, selectedCategory);

      // If code is 'missing', re-run analysis once automatically
      if (verdictData?.code === "missing") {
        await analyzePhoto(path);
        const retryCheck = await checkPhoto(publicUrl, selectedCategory);
        verdictData = retryCheck.data;
      }

      setPhotoVerdict(verdictData);
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to verify photo.");
    } finally {
      setIsCheckingPhoto(false);
    }
  };

  // Re-run ONLY check_photo (not upload, not Gemini) when selectedCategory changes on an uploaded photo
  useEffect(() => {
    if (!uploadedPhotoUrl || !selectedCategory) return;
    if (prevCategoryRef.current === selectedCategory) return;
    prevCategoryRef.current = selectedCategory;

    let isCancelled = false;
    setIsCheckingPhoto(true);

    checkPhoto(uploadedPhotoUrl, selectedCategory).then(({ data }) => {
      if (!isCancelled && data) {
        setPhotoVerdict(data);
      }
      if (!isCancelled) {
        setIsCheckingPhoto(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedCategory, uploadedPhotoUrl]);

  // 5. Handle form reset to report another issue
  const handleResetForm = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoLat(null);
    setPhotoLng(null);
    setUploadedPhotoUrl(null);
    setUploadedPhotoPath(null);
    setPhotoVerdict(null);
    setIsCheckingPhoto(false);
    setDescription("");
    setIsAnonymous(false);
    setOnBehalf(false);
    setSubmitError(null);
    setSubmittedResult(null);
    setDuplicateCandidates(null);
    setMergedCandidateBefore(null);
    setSubmittingCandidateId(null);
    if (categories.length > 0) {
      setSelectedCategory(categories[0].key);
    }
    requestBrowserGps();
  };

  // 6. Execute report submission to backend (reuses uploaded photo URL, unchanged submit_report RPC)
  const executeSubmission = async (existingIssueId: string | null = null) => {
    if (!photoFile) {
      setSubmitError("Photo evidence is mandatory to submit a report.");
      return;
    }

    if (!uploadedPhotoUrl) {
      setSubmitError("Photo has not finished uploading. Please wait a moment.");
      return;
    }

    if (!currentUser) {
      setSubmitError("Authenticating session... Please try again in a moment.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Call submit_report RPC reusing the already uploaded photo URL
      const { data, error: rpcErr } = await submitReport({
        category: selectedCategory,
        severity: selectedSeverity,
        description: description.trim(),
        lat: pinLat,
        lng: pinLng,
        photoLat: photoLat,
        photoLng: photoLng,
        photoUrl: uploadedPhotoUrl,
        isAnonymous,
        onBehalf,
        existingIssueId: existingIssueId || null,
      });

      if (rpcErr) {
        throw rpcErr;
      }

      if (!data) {
        throw new Error("No response received from scoring engine.");
      }

      // Show success screen with server-generated score
      setSubmittedResult(data);
      setDuplicateCandidates(null);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes("Photo check failed")) {
        const code = errMsg.split("Photo check failed:")[1]?.trim() || "missing";
        setSubmitError(
          photoCodeMessage(
            code,
            photoVerdict?.detected_category,
            selectedCategory,
            categoryMap
          )
        );
        if (uploadedPhotoUrl) {
          checkPhoto(uploadedPhotoUrl, selectedCategory).then(({ data }) => {
            if (data) setPhotoVerdict(data);
          });
        }
      } else if (errMsg.includes("Photo location is too far from the pin")) {
        setSubmitError(
          "Photo location is too far from the pin (>200m). Please move the pin closer to where the photo was taken."
        );
      } else if (errMsg.includes("Rate limit exceeded")) {
        setSubmitError(
          "Rate limit exceeded: You can submit a maximum of 10 reports per hour."
        );
      } else {
        setSubmitError(errMsg);
      }
    } finally {
      setIsSubmitting(false);
      setSubmittingCandidateId(null);
    }
  };

  // 7. Initial form submission trigger: check duplicates first!
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!photoFile) {
      setSubmitError("Photo evidence is mandatory to submit a report.");
      return;
    }

    if (!selectedCategory) {
      setSubmitError("Please select a problem category.");
      return;
    }

    if (!currentUser) {
      setSubmitError("Authenticating session... Please try again in a moment.");
      return;
    }

    setIsCheckingDuplicates(true);

    try {
      // Check for existing open issues of the same category within merge radius
      const { data: candidates, error: dupError } = await checkDuplicates(
        pinLat,
        pinLng,
        selectedCategory
      );

      if (!dupError && candidates && candidates.length > 0) {
        // Show "Is this the same issue?" prompt
        setDuplicateCandidates(candidates);
        setIsCheckingDuplicates(false);
        return;
      }

      // No duplicates found: proceed directly to submit as new issue
      setIsCheckingDuplicates(false);
      await executeSubmission(null);
    } catch (err) {
      setIsCheckingDuplicates(false);
      // Fallback: submit normally if duplicate check encountered network error
      await executeSubmission(null);
    }
  };

  // --------------------------------------------------------------------------
  // SUCCESS SCREEN
  // --------------------------------------------------------------------------
  if (submittedResult) {
    const isHigh = submittedResult.priority_band === "High";
    const isMedium = submittedResult.priority_band === "Medium";

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

    const isMerged = submittedResult.merged;
    const beforeScore = mergedCandidateBefore?.priority_score;
    const afterScore = submittedResult.priority_score;
    const newReporterCount =
      submittedResult.unique_reporters ??
      (mergedCandidateBefore
        ? mergedCandidateBefore.unique_reporters +
          (submittedResult.already_reported ? 0 : 1)
        : 1);

    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-8 max-w-md mx-auto flex flex-col justify-between">
        <div className="space-y-6">
          {/* Header */}
          <div className="text-center pt-2">
            <span className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 text-2xl mb-3 shadow-xs">
              ✓
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {isMerged ? t("report.duplicatesFoundTitle", "Report Merged!") : t("report.successTitle", "Report Submitted!")}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Assigned to {submittedResult.ward_name}
            </p>
          </div>

          {/* Merged Banner */}
          {isMerged && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3.5 text-center shadow-xs">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-800 uppercase tracking-wide">
                <span>🔀</span>
                <span>Merged into an existing issue</span>
              </div>
              <p className="text-xs text-blue-600 mt-1">
                Your report was attached to strengthen community visibility.
              </p>
            </div>
          )}

          {/* Already Reported Friendly Callout */}
          {isMerged && submittedResult.already_reported && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 text-center leading-relaxed">
              💡 Your report was added as additional evidence. The count did not change because you are already counted on this issue.
            </div>
          )}

          {/* Location Verified / Not Verified Badge */}
          <div className="flex justify-center">
            {submittedResult.location_verified ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <span>📍</span>
                <span>Location Verified</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                <span>⚠️</span>
                <span>Location Not Verified (GPS Off)</span>
              </span>
            )}
          </div>

          {/* Photo Verification Status Banner */}
          {photoVerdict?.verdict === "review" && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                <span>⚠️</span>
                <span>Photo flagged for officer review</span>
              </span>
            </div>
          )}
          {photoVerdict?.verdict === "unchecked" && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                <span>ℹ️</span>
                <span>Photo not verified</span>
              </span>
            </div>
          )}

          {/* Priority Score Hero Card */}
          <div
            className={`rounded-2xl border p-6 text-center shadow-xs transition-all ${scoreCardBorder}`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t("report.priorityScoreLabel", "Automated Priority Score")}
            </span>

            {/* Score Before and After on Merge */}
            {isMerged && beforeScore !== undefined && beforeScore !== afterScore ? (
              <div className="my-2">
                <div className="flex items-center justify-center gap-2 text-slate-500 text-sm font-semibold">
                  <span>Score {beforeScore}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-2xl font-black text-slate-900">
                    {afterScore}
                  </span>
                  <span className="text-xs font-bold text-slate-400">/ 100</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 my-2">
                <span className="text-6xl font-black text-slate-900 tracking-tighter">
                  {submittedResult.priority_score}
                </span>
                <span className="text-xl font-bold text-slate-400">/ 100</span>
              </div>
            )}

            <div
              className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-extrabold border uppercase tracking-wider mt-1 mb-2 ${bandBadgeStyle}`}
            >
              {submittedResult.priority_band} Priority
            </div>

            {/* Reporter Count Banner */}
            <div className="text-xs font-medium text-slate-600 mt-1">
              👥 {newReporterCount} {newReporterCount === 1 ? "person has" : "people have"} reported this
            </div>
          </div>

          {/* Plain-English Reasons Callout */}
          <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Scoring Rationale
            </div>
            <p className="text-sm font-medium text-slate-800 leading-relaxed italic">
              &ldquo;{submittedResult.reasons_text}&rdquo;
            </p>
          </div>

          {/* Score Breakdown List */}
          {submittedResult.score_breakdown && (
            <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Score Breakdown
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Severity Points</span>
                  <span className="font-semibold text-slate-900">
                    +{submittedResult.score_breakdown.severity} pts
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Location &amp; Exposure</span>
                  <span className="font-semibold text-slate-900">
                    +{submittedResult.score_breakdown.location} pts
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Frequency (Community Reports)</span>
                  <span className="font-semibold text-slate-900">
                    +{submittedResult.score_breakdown.frequency} pts
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Age / Days Pending</span>
                  <span className="font-semibold text-slate-900">
                    +{submittedResult.score_breakdown.age} pts
                  </span>
                </div>
                {submittedResult.score_breakdown.context_boost > 0 && (
                  <div className="flex justify-between py-2 text-blue-700 bg-blue-50/50 px-1 rounded">
                    <span>Weather / Context Boost</span>
                    <span className="font-bold">
                      +{submittedResult.score_breakdown.context_boost} pts
                    </span>
                  </div>
                )}
                {submittedResult.score_breakdown.reopen_boost > 0 && (
                  <div className="flex justify-between py-2 text-rose-700 bg-rose-50/50 px-1 rounded">
                    <span>Reopen Penalty Boost</span>
                    <span className="font-bold">
                      +{submittedResult.score_breakdown.reopen_boost} pts
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status & Issue Metadata */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-2">
            <span>
              Status:{" "}
              <strong className="text-slate-700 capitalize">
                {submittedResult.status}
              </strong>
            </span>
            <span>
              Merged:{" "}
              <strong className="text-slate-700">
                {submittedResult.merged ? "Yes" : "No"}
              </strong>
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-6">
          <Link
            href={`/issue/${submittedResult.issue_id}`}
            className="w-full flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all px-6 py-4 text-white font-semibold text-base shadow-sm shadow-blue-500/20 min-h-[48px]"
          >
            {t("report.viewDetails", "Open this issue")}
          </Link>
          <Link
            href="/tracker"
            className="w-full flex items-center justify-center rounded-xl bg-white hover:bg-slate-100 active:scale-[0.98] transition-all border border-slate-300 px-6 py-4 text-slate-800 font-semibold text-base shadow-xs min-h-[48px]"
          >
            {t("report.viewInTracker", "View on public tracker")}
          </Link>
          <button
            type="button"
            onClick={handleResetForm}
            className="w-full flex items-center justify-center text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors py-2 min-h-[40px]"
          >
            {t("report.reportAnother", "Report another issue")}
          </button>
        </div>
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // DUPLICATE PROMPT SCREEN
  // --------------------------------------------------------------------------
  if (duplicateCandidates && duplicateCandidates.length > 0) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 max-w-md mx-auto flex flex-col justify-between">
        <div>
          {submitError && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4 text-xs font-medium text-red-800 flex items-start gap-2 shadow-xs">
              <span className="text-base shrink-0">⚠️</span>
              <p className="flex-1">{submitError}</p>
            </div>
          )}

          <DuplicatePrompt
            candidates={duplicateCandidates}
            onSelectMerge={(candidate) => {
              setMergedCandidateBefore(candidate);
              setSubmittingCandidateId(candidate.issue_id);
              executeSubmission(candidate.issue_id);
            }}
            onSubmitNew={() => {
              setMergedCandidateBefore(null);
              setSubmittingCandidateId(null);
              executeSubmission(null);
            }}
            onBackToEdit={() => {
              setDuplicateCandidates(null);
              setSubmitError(null);
            }}
            isSubmitting={isSubmitting}
            submittingCandidateId={submittingCandidateId}
          />
        </div>
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // REPORT FORM
  // --------------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 max-w-md mx-auto flex flex-col justify-between">
      <div>
        {/* Navigation / Header */}
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors py-1 min-h-[44px]"
          >
            ← Back to home
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1">
            Report a Civic Issue
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Capture a photo, pick a category, and verify your pin.
          </p>
        </div>

        {/* Global Error Banner */}
        {(submitError || authError || categoriesError) && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4 text-xs font-medium text-red-800 flex items-start gap-2 shadow-xs">
            <span className="text-base shrink-0">⚠️</span>
            <p className="flex-1">
              {submitError || authError || categoriesError}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* STEP 1: Photo Evidence */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              1. Photo Evidence <span className="text-red-500">*</span>
            </label>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handlePhotoSelect}
              className="hidden"
              id="photo-upload"
            />

            {photoPreview ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-xs">
                <img
                  src={photoPreview}
                  alt="Captured evidence"
                  className="w-full h-56 object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-3 right-3 bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-1.5 rounded-lg backdrop-blur-xs transition-all shadow-xs"
                >
                  Retake Photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-36 border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/30 rounded-2xl flex flex-col items-center justify-center p-4 transition-all text-slate-500 bg-white"
              >
                <span className="text-3xl mb-1">📸</span>
                <span className="text-sm font-semibold text-slate-700">
                  Take photo or upload
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Required • Camera will prompt for GPS
                </span>
              </button>
            )}

            {/* AI Photo Check Status */}
            <PhotoCheckStatus
              isChecking={isCheckingPhoto}
              verdictResult={photoVerdict}
              chosenCategory={selectedCategory}
              categoryMap={categoryMap}
              onSwitchCategory={(newCat) => setSelectedCategory(newCat)}
              onApplySeverity={(newSev) => setSelectedSeverity(newSev)}
            />
          </div>

          {/* STEP 2: Category Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              {t("report.stepCategory", "2. Select Category")} <span className="text-red-500">*</span>
            </label>

            {categoriesLoading ? (
              <div className="grid grid-cols-2 gap-2 animate-pulse">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 bg-slate-200 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {categories.map((cat) => {
                  const isSelected = selectedCategory === cat.key;
                  const emoji = CATEGORY_EMOJIS[cat.key] || "📍";
                  return (
                    <button
                      type="button"
                      key={cat.key}
                      onClick={() => setSelectedCategory(cat.key)}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border text-left text-xs font-semibold transition-all min-h-[48px] ${
                        isSelected
                          ? "border-blue-600 bg-blue-50/80 text-blue-900 shadow-xs ring-1 ring-blue-500/20"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/60"
                      }`}
                    >
                      <span className="text-lg shrink-0">{emoji}</span>
                      <span className="truncate">{getCategoryTranslation(cat.key, locale, cat.label)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* STEP 3: Severity Level */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              {t("report.stepSeverity", "3. Severity Level")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "minor", label: getSeverityTranslation("minor", locale), desc: t("severities.minorDesc", "Low hazard") },
                { key: "moderate", label: getSeverityTranslation("moderate", locale), desc: t("severities.moderateDesc", "Standard issue") },
                { key: "dangerous", label: getSeverityTranslation("dangerous", locale), desc: t("severities.dangerousDesc", "Immediate risk") },
              ].map((lvl) => {
                const isSelected = selectedSeverity === lvl.key;
                return (
                  <button
                    type="button"
                    key={lvl.key}
                    onClick={() => setSelectedSeverity(lvl.key)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all min-h-[48px] ${
                      isSelected
                        ? lvl.key === "dangerous"
                          ? "border-red-500 bg-red-50 text-red-900 ring-1 ring-red-400/20"
                          : "border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-500/20"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-xs font-bold capitalize">
                      {lvl.label}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">
                      {lvl.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 4: Interactive Location Pin */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                {t("report.stepLocation", "4. Pin Location")} <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={requestBrowserGps}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <span>🎯</span>
                <span>{t("report.gpsPrompt", "Current Location")}</span>
              </button>
            </div>

            <LocationPicker
              lat={pinLat}
              lng={pinLng}
              onChange={({ lat, lng }) => {
                setPinLat(lat);
                setPinLng(lng);
              }}
              onRequestGps={requestBrowserGps}
              gpsStatus={gpsStatus}
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
              <span>{t("report.dragPinHelp", "Drag the pin to adjust exact location")}</span>
              <span>
                {pinLat.toFixed(4)}, {pinLng.toFixed(4)}
              </span>
            </div>
          </div>

          {/* STEP 5: Description */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              <div className="flex items-center justify-between">
                <span>{t("report.stepDescription", "5. Description (Optional)")}</span>
                {description.trim() && (
                  <TextToSpeechButton text={description} size="sm" variant="pill" />
                )}
              </div>
            </label>
            <VoiceRecorder
              onTranscript={(newText) => setDescription(newText)}
              currentValue={description}
            />
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("report.descPlaceholder", "Provide landmarks or helpful context (e.g. Near main market gate)...")}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none shadow-xs"
            />
          </div>

          {/* STEP 6: Privacy & Options */}
          <div className="rounded-xl bg-white border border-slate-200 p-3.5 space-y-3 shadow-xs">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800">
                  {t("report.anonymousOption", "Report anonymously")}
                </span>
                <p className="text-[11px] text-slate-500">
                  {t("report.anonymousDesc", "Hide your name from the public tracker view")}
                </p>
              </div>
            </label>

            <div className="border-t border-slate-100 pt-2.5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onBehalf}
                  onChange={(e) => setOnBehalf(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800">
                    {t("report.onBehalfOption", "Reporting on behalf of another citizen")}
                  </span>
                  <p className="text-[11px] text-slate-500">
                    {t("report.onBehalfDesc", "Flagged for municipal verification records")}
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={
                isSubmitting ||
                isCheckingDuplicates ||
                !photoFile ||
                isCheckingPhoto ||
                !uploadedPhotoUrl ||
                photoVerdict?.verdict === "reject"
              }
              className="w-full flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all px-6 py-4 text-white font-semibold text-base shadow-sm shadow-blue-500/20 min-h-[48px]"
            >
              {isCheckingDuplicates ? (
                <div className="flex items-center gap-2">
                  <span className="animate-spin text-lg">⏳</span>
                  <span>Checking nearby issues...</span>
                </div>
              ) : isSubmitting ? (
                <div className="flex items-center gap-2">
                  <span className="animate-spin text-lg">⏳</span>
                  <span>{t("report.submitting", "Submitting...")}</span>
                </div>
              ) : isCheckingPhoto ? (
                <div className="flex items-center gap-2">
                  <span className="animate-spin text-lg">⏳</span>
                  <span>Checking photo...</span>
                </div>
              ) : (
                <span>{t("report.submitBtn", "Submit Report")}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
