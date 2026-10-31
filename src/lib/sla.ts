import { supabase } from "@/lib/supabase/client";

export type SlaState =
  | "on_track"
  | "due_soon"
  | "overdue"
  | "severely_overdue"
  | "met"
  | "missed";

export interface SlaOverviewItem {
  issue_id: string;
  status: string;
  sla_hours: number | null;
  clock_started_at: string | null;
  due_at: string | null;
  hours_remaining: number | null; // numeric with 1 decimal; negative when overdue; null for resolved issues
  level: number; // 0, 1, or 2
  state: SlaState;
}

export interface IssueEscalationNotice {
  level: number;
  label: string;
  created_at: string;
}

export interface EscalationQueueItem {
  issue_id: string;
  category: string;
  category_label: string | null;
  status: string;
  priority_score: number;
  priority_band: "High" | "Medium" | "Low";
  ward_name: string | null;
  department_name: string | null;
  level: number;
  label: string;
  hours_overdue: number; // positive number with 1 decimal
  due_at: string;
  assigned_to_name: string | null;
}

export interface SlaRunResult {
  checked: number;
  new_level1: number;
  new_level2: number;
  skipped?: boolean;
  reason?: string;
}

/**
 * Display-only formatter for database-computed hours remaining or overdue.
 * Converts numeric hour counts returned by the database into clean strings
 * (e.g. 52.5 -> "2 d 4 h left", -3.0 -> "3 h overdue").
 * Note: Performs NO date/time or SLA business math; strictly formats numbers.
 */
export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";

  const isOverdue = h < 0;
  const absH = Math.abs(h);
  const days = Math.floor(absH / 24);
  const hours = Math.floor(absH % 24);

  let durationStr = "";
  if (days > 0 && hours > 0) {
    durationStr = `${days} d ${hours} h`;
  } else if (days > 0) {
    durationStr = `${days} d`;
  } else if (hours > 0) {
    durationStr = `${hours} h`;
  } else if (absH > 0) {
    durationStr = "< 1 h";
  } else {
    durationStr = "0 h";
  }

  return isOverdue ? `${durationStr} overdue` : `${durationStr} left`;
}

/**
 * Translates database error messages into clear, friendly text for users.
 */
export function friendlySlaError(error: any): string {
  if (!error) return "An unexpected error occurred.";
  const msg = typeof error === "string" ? error : error.message || String(error);

  if (msg.includes("Officer or admin access required")) {
    return "Officer or administrator access is required to view this information.";
  }
  if (msg.includes("Authentication required") || msg.includes("Unauthorized")) {
    return "Please sign in to access escalation details.";
  }
  return msg;
}

/**
 * Retrieves the SLA overview and active status metrics for an issue or all issues.
 * Returns nulls as nulls with friendly error handling.
 */
export async function getSlaOverview(
  issueId?: string
): Promise<{ data: SlaOverviewItem[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("sla_overview", {
      p_issue_id: issueId || null,
    });

    if (error) {
      return { data: null, error: new Error(friendlySlaError(error)) };
    }

    return { data: data as SlaOverviewItem[] | null, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlySlaError(err)),
    };
  }
}

/**
 * Retrieves logged escalation notices and milestones for a specific issue.
 */
export async function getIssueEscalations(
  issueId: string
): Promise<{ data: IssueEscalationNotice[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc("issue_escalations", {
      p_issue_id: issueId,
    });

    if (error) {
      return { data: null, error: new Error(friendlySlaError(error)) };
    }

    return { data: data as IssueEscalationNotice[] | null, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlySlaError(err)),
    };
  }
}

/**
 * Retrieves open escalated issues (level >= 1) scoped to caller's jurisdiction.
 * Accessible only by officers and administrators.
 */
export async function listEscalations(): Promise<{
  data: EscalationQueueItem[] | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc("list_escalations");

    if (error) {
      return { data: null, error: new Error(friendlySlaError(error)) };
    }

    return { data: data as EscalationQueueItem[] | null, error: null };
  } catch (err: any) {
    return {
      data: null,
      error: new Error(friendlySlaError(err)),
    };
  }
}
