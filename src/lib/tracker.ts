import { supabase } from "@/lib/supabase/client";

export interface TrackerIssue {
  id: string;
  category: string;
  category_label: string | null;
  status: "reported" | "verified" | "assigned" | "in_progress" | "resolved" | "reopened";
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
  unique_reporters: number;
  lat: number;
  lng: number;
  ward_id: number | null;
  ward_name: string | null;
  department_name: string | null;
  road_class: string;
  created_at: string;
  days_open: number;
  photo_url: string | null;
}

export interface TrackerSummary {
  total: number;
  by_status: {
    reported: number;
    verified: number;
    assigned: number;
    in_progress: number;
    resolved: number;
    reopened: number;
  };
  by_band: {
    High: number;
    Medium: number;
    Low: number;
  };
  reopened_issues: number;
}

export interface WardOption {
  id: number;
  name: string;
}

export interface TrackerFilterParams {
  statuses?: string[];
  categories?: string[];
  wardId?: number | null;
  limit?: number;
}

/**
 * Calls list_public_issues RPC to retrieve public civic issues sorted by priority_score desc.
 * Null filters mean no filtering for that parameter.
 */
export async function listPublicIssues(
  filters?: TrackerFilterParams
): Promise<{ data: TrackerIssue[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("list_public_issues", {
      p_statuses: filters?.statuses && filters.statuses.length > 0 ? filters.statuses : null,
      p_categories: filters?.categories && filters.categories.length > 0 ? filters.categories : null,
      p_ward_id: filters?.wardId !== undefined ? filters.wardId : null,
      p_limit: filters?.limit ?? 200,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as TrackerIssue[]) || [], error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Calls tracker_summary RPC to get aggregate issue counts per status and band.
 */
export async function getTrackerSummary(): Promise<{
  data: TrackerSummary | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("tracker_summary");

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data as TrackerSummary, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches id and name from the wards table.
 */
export async function fetchWardsList(): Promise<{
  data: WardOption[] | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase
      .from("wards")
      .select("id, name")
      .order("id", { ascending: true });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: (data as WardOption[]) || [], error: null };
  } catch (err: any) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
