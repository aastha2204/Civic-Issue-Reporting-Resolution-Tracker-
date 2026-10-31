import { supabase } from "@/lib/supabase/client";

export interface Category {
  key: string;
  label: string;
  base_weight: number;
  sla_hours: number;
  max_weather_boost: number;
}

export interface ScoreBreakdown {
  severity: number;
  location: number;
  frequency: number;
  age: number;
  context_boost: number;
  reopen_boost: number;
  equity_adjustment: number;
}

export interface SubmitReportParams {
  category: string;
  severity: string;
  description: string;
  lat: number;
  lng: number;
  photoLat: number | null;
  photoLng: number | null;
  photoUrl: string;
  isAnonymous: boolean;
  onBehalf: boolean;
  existingIssueId?: string | null;
}

export interface SubmitReportResult {
  issue_id: string;
  report_id: string;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
  score_breakdown: ScoreBreakdown;
  status: string;
  merged: boolean;
  ward_name: string;
  location_verified: boolean;
  unique_reporters?: number;
  already_reported?: boolean;
}

export interface DuplicateCandidate {
  issue_id: string;
  category: string;
  status: string;
  distance_m: number;
  unique_reporters: number;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
  created_at: string;
  photo_url: string | null;
}

export interface AffectedTooResult {
  already_counted: boolean;
  unique_reporters: number;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
}

export interface PublicIssue {
  id: string;
  category: string;
  severity_level: string;
  description: string;
  lat: number;
  lng: number;
  address: string | null;
  ward_id: number;
  ward_name: string;
  department_id: number;
  department_name: string;
  road_class: string;
  status: string;
  unique_reporters: number;
  reopen_count: number;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  score_breakdown: ScoreBreakdown;
  reasons_text: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  photo_url: string | null;
  after_photo_url: string | null;
  status_history: Array<{ status: string; created_at: string }>;
  i_support_this: boolean;
}

/**
 * Ensures the citizen user has an active authenticated session.
 * Automatically signs in anonymously if no session exists.
 */
export async function signInAnonymouslyIfNeeded(): Promise<{
  user: any | null;
  error: Error | null;
}> {
  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      return { user: null, error: sessionError };
    }

    if (sessionData?.session?.user) {
      return { user: sessionData.session.user, error: null };
    }

    const { data: authData, error: authError } =
      await supabase.auth.signInAnonymously();
    if (authError) {
      return { user: null, error: authError };
    }

    return { user: authData.user, error: null };
  } catch (err: any) {
    return {
      user: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Loads the categories directly from the Supabase categories table.
 * No hardcoded fallback list is used. If loading fails, an error is returned.
 */
export async function fetchCategories(): Promise<{
  data: Category[];
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("key, label, base_weight, sla_hours, max_weather_boost")
      .order("base_weight", { ascending: false });

    if (error) {
      return { data: [], error: new Error(error.message) };
    }

    if (!data || data.length === 0) {
      return {
        data: [],
        error: new Error("No issue categories available in the database."),
      };
    }

    return { data: data as Category[], error: null };
  } catch (err: any) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Compresses an image file in the browser before upload:
 * Max 1280px on the longest dimension, JPEG quality ~0.8.
 */
export function compressImage(
  file: File,
  maxDimension: number = 1280,
  quality: number = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(new Error("Failed to load image file into memory"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Unable to create canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Image compression conversion failed"));
            }
          },
          "image/jpeg",
          quality
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a compressed photo blob to the report-photos bucket at path {userId}/{uuid}.jpg
 * and retrieves its public URL.
 */
export async function uploadReportPhoto(
  userId: string,
  imageBlob: Blob
): Promise<{ publicUrl: string; path: string; error: Error | null }> {
  try {
    const filename = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("report-photos")
      .upload(filename, imageBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      return { publicUrl: "", path: "", error: uploadError };
    }

    const { data: urlData } = supabase.storage
      .from("report-photos")
      .getPublicUrl(filename);

    if (!urlData?.publicUrl) {
      return {
        publicUrl: "",
        path: filename,
        error: new Error("Failed to generate public URL for uploaded photo"),
      };
    }

    return { publicUrl: urlData.publicUrl, path: filename, error: null };
  } catch (err: any) {
    return {
      publicUrl: "",
      path: "",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls check_duplicates RPC to find up to 3 nearby open issues of the same category
 * within the merge radius (100m).
 */
export async function checkDuplicates(
  lat: number,
  lng: number,
  category: string
): Promise<{ data: DuplicateCandidate[]; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("check_duplicates", {
      p_lat: lat,
      p_lng: lng,
      p_category: category,
    });

    if (error) {
      return { data: [], error: new Error(error.message) };
    }

    return { data: (data as DuplicateCandidate[]) || [], error: null };
  } catch (err: any) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Submits the report through the database RPC submit_report.
 * All scoring and validation are performed server-side by PostgreSQL.
 */
export async function submitReport(
  params: SubmitReportParams
): Promise<{ data: SubmitReportResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("submit_report", {
      p_category: params.category,
      p_severity: params.severity,
      p_description: params.description,
      p_lat: params.lat,
      p_lng: params.lng,
      p_photo_lat: params.photoLat,
      p_photo_lng: params.photoLng,
      p_photo_url: params.photoUrl,
      p_is_anonymous: params.isAnonymous,
      p_on_behalf: params.onBehalf,
      p_existing_issue_id: params.existingIssueId || null,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as SubmitReportResult, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls affected_too RPC to record an upvote on an issue.
 * Recomputes score on database trigger if newly counted.
 */
export async function affectedToo(
  issueId: string
): Promise<{ data: AffectedTooResult | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("affected_too", {
      p_issue_id: issueId,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as AffectedTooResult, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches the public details of a single issue without leaking submitter IDs.
 */
export async function getPublicIssue(
  issueId: string
): Promise<{ data: PublicIssue | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("get_public_issue", {
      p_issue_id: issueId,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as PublicIssue, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export interface WardCentre {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Fetches ward centers from the wards table to compute map bounds and center.
 */
export async function fetchWardCentres(): Promise<{
  data: WardCentre[];
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase
      .from("wards")
      .select("id, name, centre")
      .order("id", { ascending: true });

    if (error) {
      return { data: [], error: new Error(error.message) };
    }

    if (!data) return { data: [], error: null };

    const parsed: WardCentre[] = [];
    for (const w of data) {
      if (!w.centre) continue;
      let lat: number | null = null;
      let lng: number | null = null;

      if (typeof w.centre === "object" && w.centre !== null) {
        if (Array.isArray((w.centre as any).coordinates)) {
          lng = Number((w.centre as any).coordinates[0]);
          lat = Number((w.centre as any).coordinates[1]);
        }
      } else if (typeof w.centre === "string") {
        const pointMatch = w.centre.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (pointMatch) {
          lng = parseFloat(pointMatch[1]);
          lat = parseFloat(pointMatch[2]);
        } else if (w.centre.startsWith("{")) {
          try {
            const geoObj = JSON.parse(w.centre);
            if (Array.isArray(geoObj.coordinates)) {
              lng = Number(geoObj.coordinates[0]);
              lat = Number(geoObj.coordinates[1]);
            }
          } catch {}
        } else if (/^[0-9a-fA-F]{40,}$/.test(w.centre)) {
          try {
            const buffer = Buffer.from(w.centre, "hex");
            const isLittleEndian = buffer.readUInt8(0) === 1;
            const geomType = isLittleEndian ? buffer.readUInt32LE(1) : buffer.readUInt32BE(1);
            const hasSrid = (geomType & 0x20000000) !== 0;
            const coordOffset = hasSrid ? 9 : 5;
            if (buffer.length >= coordOffset + 16) {
              lng = isLittleEndian ? buffer.readDoubleLE(coordOffset) : buffer.readDoubleBE(coordOffset);
              lat = isLittleEndian ? buffer.readDoubleLE(coordOffset + 8) : buffer.readDoubleBE(coordOffset + 8);
            }
          } catch {}
        }
      }

      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        parsed.push({
          id: w.id,
          name: w.name,
          lat,
          lng,
        });
      }
    }

    return { data: parsed, error: null };
  } catch (err: any) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
