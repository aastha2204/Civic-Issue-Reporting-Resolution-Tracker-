import { supabase } from "@/lib/supabase/client";

export type PhotoVerdictType = "pass" | "review" | "reject" | "unchecked";

export interface PhotoVerdictResult {
  verdict: PhotoVerdictType;
  code: string;
  detected_category: string | null;
  suggested_severity: "minor" | "moderate" | "dangerous" | null;
  confidence: number | null;
}

export interface AnalyzePhotoResult {
  ok: boolean;
  available?: boolean;
  cached?: boolean;
  error?: string;
}

/**
 * Calls the server-side analysis route (/api/photo/analyze) with the active user session token.
 */
export async function analyzePhoto(
  photoPath: string
): Promise<AnalyzePhotoResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { ok: false, error: "Authentication required to analyze photo" };
    }

    const response = await fetch("/api/photo/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ photo_path: photoPath }),
    });

    if (response.status === 429) {
      return {
        ok: false,
        error: "Rate limit exceeded: maximum 30 analyses per hour",
      };
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      return {
        ok: false,
        error: errJson?.error || `Analysis failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      ok: true,
      available: data?.available,
      cached: data?.cached,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Failed to reach photo analysis service",
    };
  }
}

/**
 * Invokes the database RPC check_photo to evaluate the authoritative verdict.
 */
export async function checkPhoto(
  photoUrl: string,
  category: string
): Promise<{ data: PhotoVerdictResult | null; error: any }> {
  try {
    const { data, error } = await supabase.rpc("check_photo", {
      p_photo_url: photoUrl,
      p_category: category,
    });

    if (error) {
      return { data: null, error };
    }

    return { data: data as PhotoVerdictResult, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Translates a verdict code into user-facing plain text matching the Step 10A spec.
 */
export function photoCodeMessage(
  code: string,
  detectedCategory?: string | null,
  chosenCategory?: string | null,
  categoryMap?: Record<string, string>
): string {
  const getLabel = (catKey?: string | null): string => {
    if (!catKey) return "category";
    if (categoryMap && categoryMap[catKey]) {
      return categoryMap[catKey];
    }
    return catKey.replace(/_/g, " ");
  };

  const chosenLabel = getLabel(chosenCategory);
  const detectedLabel = getLabel(detectedCategory);

  switch (code) {
    case "ok":
      return `Looks like ${chosenLabel}. ✓`;
    case "low_confidence":
      return `We couldn't be sure this photo shows ${chosenLabel}. You can still submit; an officer will review it.`;
    case "mismatch":
      return `This photo looks like ${detectedLabel}, not ${chosenLabel}.`;
    case "not_civic":
      return `This doesn't look like a civic issue. Please take a photo of the problem itself.`;
    case "not_real":
      return `Please take a new photo of the problem. Screenshots, drawings and photos of screens are not accepted.`;
    case "reused":
      return `This photo has already been used in another report.`;
    case "unavailable":
      return `Photo check is temporarily unavailable. Your report will be marked 'photo not verified'.`;
    case "missing":
      return `Photo check could not be completed. Please try again.`;
    default:
      return `Photo check status: ${code}`;
  }
}
