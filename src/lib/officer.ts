import { supabase } from "@/lib/supabase/client";
import { ScoreBreakdown } from "@/lib/reports";

export interface OfficerProfile {
  id: string;
  display_name: string | null;
  role: "officer" | "admin" | "citizen";
  department_id: number | null;
  department_name: string | null;
  ward_id: number | null;
  ward_name: string | null;
}

export interface OfficerQueueItem {
  id: string;
  category: string;
  category_label: string | null;
  status: "reported" | "verified" | "assigned" | "in_progress" | "resolved" | "reopened";
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
  score_breakdown: ScoreBreakdown;
  unique_reporters: number;
  lat: number;
  lng: number;
  ward_id: number | null;
  ward_name: string | null;
  department_name: string | null;
  road_class: string;
  created_at: string;
  days_open: number;
  sla_hours: number | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  photo_url: string | null;
}

export interface StatusHistoryEntry {
  status: string;
  created_at: string;
}

export interface OfficerIssueDetail extends OfficerQueueItem {
  severity_level?: string;
  description?: string | null;
  address?: string | null;
  after_photo_url: string | null;
  distance_from_issue_m: number | null;
  status_history: StatusHistoryEntry[];
}

export interface DepartmentOfficer {
  id: string;
  display_name: string;
}

/**
 * Translates database exception messages into user-friendly notices.
 */
export function friendlyOfficerError(err: any): string {
  if (!err) return "An unexpected error occurred.";
  const msg = typeof err === "string" ? err : err.message || String(err);

  if (
    msg.includes("Officer or admin access required") ||
    msg.includes("Unauthorized: Officer or admin access required")
  ) {
    return "Officer or administrator access is required to perform this action.";
  }
  if (msg.includes("Transition not allowed")) {
    return "This status transition is not permitted from the current issue state.";
  }
  if (msg.includes("Assignee must be an officer or admin")) {
    return "The selected assignee must be an officer or administrator.";
  }
  if (msg.includes("After-photo location is required to verify the fix")) {
    return "Device GPS coordinates are required to verify the fix location.";
  }
  if (msg.includes("After-photo is too far from the original issue location")) {
    return "The after-photo must be taken within 100 m of the reported location.";
  }
  if (msg.includes("After-photo URL is required")) {
    return "An after-repair photo is required to resolve this issue.";
  }
  if (msg.includes("outside your department jurisdiction")) {
    return "This issue belongs to a department outside your jurisdiction.";
  }
  if (msg.includes("outside your ward jurisdiction")) {
    return "This issue is located in a ward outside your jurisdiction.";
  }
  if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
    return "Invalid email or password. Please verify your officer credentials.";
  }
  if (msg.includes("Issue not found")) {
    return "The requested issue could not be found.";
  }

  return msg;
}

/**
 * Authenticates an officer using Supabase password credentials
 * and verifies their role is officer or admin in profiles.
 */
export async function signInOfficer(
  email: string,
  password: string
): Promise<{ data: OfficerProfile | null; error: Error | null }> {
  try {
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (authError) {
      return { data: null, error: new Error(friendlyOfficerError(authError)) };
    }

    if (!authData.user) {
      return { data: null, error: new Error("Authentication failed: User record missing.") };
    }

    // Inspect user profile role
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select(`
        id,
        display_name,
        role,
        department_id,
        ward_id,
        departments:department_id ( name ),
        wards:ward_id ( name )
      `)
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileErr) {
      return { data: null, error: new Error(friendlyOfficerError(profileErr)) };
    }

    if (!profile || (profile.role !== "officer" && profile.role !== "admin")) {
      // Sign out non-officers to prevent session retention
      await supabase.auth.signOut();
      await supabase.auth.signInAnonymously();
      return {
        data: null,
        error: new Error("Access denied: Officer or administrator credentials required."),
      };
    }

    const officerProfile: OfficerProfile = {
      id: profile.id,
      display_name: profile.display_name,
      role: profile.role,
      department_id: profile.department_id,
      department_name: (profile as any)?.departments?.name ?? null,
      ward_id: profile.ward_id,
      ward_name: (profile as any)?.wards?.name ?? null,
    };

    return { data: officerProfile, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Signs out the current officer, then immediately re-establishes
 * an anonymous session so the public tracker and citizen reports keep working.
 */
export async function signOutOfficer(): Promise<{ error: Error | null }> {
  try {
    await supabase.auth.signOut();
    // Re-establish anonymous session for citizen actions
    await supabase.auth.signInAnonymously();
    return { error: null };
  } catch (err: any) {
    return {
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Retrieves the current logged-in user's profile with municipal role and assignments.
 */
export async function getMyProfile(): Promise<{
  data: OfficerProfile | null;
  error: Error | null;
}> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { data: null, error: null };
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id,
        display_name,
        role,
        department_id,
        ward_id,
        departments:department_id ( name ),
        wards:ward_id ( name )
      `)
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    if (!data) {
      return { data: null, error: null };
    }

    return {
      data: {
        id: data.id,
        display_name: data.display_name,
        role: data.role as "officer" | "admin" | "citizen",
        department_id: data.department_id,
        department_name: (data as any)?.departments?.name ?? null,
        ward_id: data.ward_id,
        ward_name: (data as any)?.wards?.name ?? null,
      },
      error: null,
    };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls officer_queue RPC to retrieve ranked civic issues within officer scope.
 */
export async function fetchOfficerQueue(
  statuses?: string[] | null,
  limit: number = 200
): Promise<{ data: OfficerQueueItem[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("officer_queue", {
      p_statuses: statuses && statuses.length > 0 ? statuses : null,
      p_limit: limit,
    });

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return { data: (data as OfficerQueueItem[]) || [], error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls officer_issue RPC to fetch full issue details, score breakdown, and status timeline.
 */
export async function fetchOfficerIssue(
  id: string
): Promise<{ data: OfficerIssueDetail | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("officer_issue", {
      p_issue_id: id,
    });

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return { data: data as OfficerIssueDetail, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls list_department_officers RPC to retrieve eligible assignees in the caller's department.
 */
export async function fetchDepartmentOfficers(): Promise<{
  data: DepartmentOfficer[] | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("list_department_officers");

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return { data: (data as DepartmentOfficer[]) || [], error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls officer_set_status RPC to advance issue status (reported->verified, assigned->in_progress).
 */
export async function setStatus(
  id: string,
  status: string
): Promise<{ data: { status: string } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("officer_set_status", {
      p_issue_id: id,
      p_new_status: status,
    });

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return { data: data as { status: string }, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls officer_assign RPC to assign an issue to an officer or administrator.
 */
export async function assignIssue(
  id: string,
  assignee: string
): Promise<{
  data: { status: string; assigned_to_name: string } | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("officer_assign", {
      p_issue_id: id,
      p_assignee: assignee,
    });

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return {
      data: data as { status: string; assigned_to_name: string },
      error: null,
    };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls officer_resolve RPC to record resolution with GPS and after-photo proof.
 */
export async function resolveIssue(
  id: string,
  afterPhotoUrl: string,
  lat: number,
  lng: number
): Promise<{
  data: { status: string; distance_from_issue_m: number } | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("officer_resolve", {
      p_issue_id: id,
      p_after_photo_url: afterPhotoUrl,
      p_photo_lat: lat,
      p_photo_lng: lng,
    });

    if (error) {
      return { data: null, error: new Error(friendlyOfficerError(error)) };
    }

    return {
      data: data as { status: string; distance_from_issue_m: number },
      error: null,
    };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Uploads a compressed resolution photo blob to the resolution-photos bucket
 * at path {officerId}/{uuid}.jpg and returns its public URL.
 */
export async function uploadResolutionPhoto(
  officerId: string,
  imageBlob: Blob
): Promise<{ publicUrl: string; error: Error | null }> {
  try {
    const filename = `${officerId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("resolution-photos")
      .upload(filename, imageBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      return {
        publicUrl: "",
        error: new Error(friendlyOfficerError(uploadError)),
      };
    }

    const { data: urlData } = supabase.storage
      .from("resolution-photos")
      .getPublicUrl(filename);

    if (!urlData?.publicUrl) {
      return {
        publicUrl: "",
        error: new Error("Failed to generate public URL for resolution photo."),
      };
    }

    return { publicUrl: urlData.publicUrl, error: null };
  } catch (err: any) {
    return {
      publicUrl: "",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
