import { supabase } from "@/lib/supabase/client";
import { signInAnonymouslyIfNeeded } from "@/lib/reports";

export interface FixStatus {
  status: string;
  resolved_at: string | null;
  after_photo_url: string | null;
  distance_from_issue_m: number | null;
  fixed_yes: number;
  fixed_no: number;
  reopen_count: number;
  reopen_threshold: number;
  is_participant: boolean;
  my_vote: boolean | null;
  can_vote: boolean;
}

export interface ConfirmFixResult {
  reopened: boolean;
  status: string;
  fixed_yes: number;
  fixed_no: number;
  reopen_threshold: number;
  reopen_count: number;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  reasons_text: string;
}

export interface ReopenStatsWard {
  ward_id: number | null;
  ward_name: string | null;
  ever_resolved: number;
  reopened: number;
  reopen_rate_pct: number | null;
}

export interface ReopenStatsDepartment {
  department_id: number | null;
  department_name: string | null;
  ever_resolved: number;
  reopened: number;
  reopen_rate_pct: number | null;
}

export interface ReopenStatsOverall {
  ever_resolved: number;
  reopened: number;
  reopen_rate_pct: number | null;
}

export interface ReopenStats {
  by_ward: ReopenStatsWard[];
  by_department: ReopenStatsDepartment[];
  overall: ReopenStatsOverall;
}

/**
 * Translates database error messages into clear, friendly text for citizens.
 */
export function friendlyFixError(error: any): string {
  if (!error) return "An unexpected error occurred.";
  const msg = typeof error === "string" ? error : error.message || String(error);

  if (msg.includes("This issue is not awaiting confirmation")) {
    return "This issue is not awaiting confirmation.";
  }
  if (msg.includes("Only people who reported or are affected by this issue can confirm the fix")) {
    return "Only people who reported or are affected by this issue can confirm the fix.";
  }
  if (msg.includes("Authentication required") || msg.includes("Unauthorized")) {
    return "Authentication is required to confirm this fix.";
  }
  return msg;
}

/**
 * Retrieves the current fix confirmation status, latest resolution photo,
 * and caller voting eligibility. Keeps nulls as nulls.
 */
export async function getFixStatus(
  issueId: string
): Promise<{ data: FixStatus | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("get_fix_status", {
      p_issue_id: issueId,
    });

    if (error) {
      return { data: null, error: new Error(friendlyFixError(error)) };
    }

    return { data: data as FixStatus | null, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlyFixError(err)),
    };
  }
}

/**
 * Registers or alters a citizen's verification vote on whether an issue is fixed.
 * Signs in anonymously first if there is no active session.
 */
export async function confirmFix(
  issueId: string,
  isFixed: boolean
): Promise<{ data: ConfirmFixResult | null; error: Error | null }> {
  try {
    // 1. Ensure user has an active session before submitting vote
    const { error: authErr } = await signInAnonymouslyIfNeeded();
    if (authErr) {
      return {
        data: null,
        error: new Error("Unable to establish user session. Please try again."),
      };
    }

    // 2. Call confirm_fix RPC
    const { data, error } = await supabase.rpc("confirm_fix", {
      p_issue_id: issueId,
      p_is_fixed: isFixed,
    });

    if (error) {
      return { data: null, error: new Error(friendlyFixError(error)) };
    }

    return { data: data as ConfirmFixResult, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlyFixError(err)),
    };
  }
}

/**
 * Retrieves municipal fix verification and reopen accountability statistics.
 * (Kept in file, not used on any page yet per instructions).
 */
export async function getReopenStats(): Promise<{
  data: ReopenStats | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("reopen_stats");

    if (error) {
      return { data: null, error: new Error(friendlyFixError(error)) };
    }

    return { data: data as ReopenStats, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlyFixError(err)),
    };
  }
}
