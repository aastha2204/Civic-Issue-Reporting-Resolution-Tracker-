import { supabase } from "@/lib/supabase/client";

export interface ScoringCategory {
  key: string;
  label: string;
  base_weight: number;
  sla_hours: number;
  max_weather_boost: number;
}

export interface ScoringConstants {
  merge_radius_m: number;
  photo_match_radius_m: number;
  resolution_radius_m: number;
  heavy_rain_mm: number;
  reopen_threshold: number;
  sla_level1_factor: number;
  sla_level2_factor: number;
  sla_due_soon_fraction: number;
  equity_low_reporting_ratio: number;
  equity_max_points?: number;
  equity_min_reports?: number;
}

export interface ScoringExampleResult {
  total: number;
  band: "High" | "Medium" | "Low" | string;
  base: number;
  breakdown: {
    severity: number;
    location: number;
    frequency: number;
    age: number;
    context_boost: number;
    reopen_boost: number;
    equity_adjustment: number;
  };
  reasons_text: string;
}

export interface ScoringExample {
  title: string;
  inputs: {
    severity_pts: number;
    location_pts: number;
    unique_reporters: number;
    days_open: number;
    context_boost_pts: number;
    equity_pts: number;
    reopen_count: number;
  };
  result: ScoringExampleResult;
}

export interface ScoringExplainer {
  categories: ScoringCategory[];
  constants: ScoringConstants;
  examples: ScoringExample[];
}

export interface ScoreboardGroup {
  ward_id?: number | null;
  ward_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  total_issues: number;
  open_issues: number;
  resolved_issues: number;
  resolution_rate_pct: number | null;
  avg_resolution_hours: number | null;
  reopened_issues: number;
  reopen_rate_pct: number | null;
  sla_met: number;
  sla_missed: number;
  overdue_now: number;
}

export interface ScoreboardOverall {
  total_issues: number;
  open_issues: number;
  resolved_issues: number;
  resolution_rate_pct: number | null;
  avg_resolution_hours: number | null;
  reopened_issues: number;
  reopen_rate_pct: number | null;
  sla_met: number;
  sla_missed: number;
  overdue_now: number;
}

export interface ScoreboardStats {
  by_ward: ScoreboardGroup[];
  by_department: ScoreboardGroup[];
  overall: ScoreboardOverall;
}

export interface WardEquity {
  ward_id: number;
  ward_name: string;
  population: number | null;
  is_simulated: boolean;
  reports: number;
  reports_per_1000: number | null;
  issues_total: number;
  avg_resolution_hours: number | null;
  wait_ratio: number | null;
  reporting_ratio: number | null;
  long_wait: boolean;
  low_reporting: boolean;
  max_equity_boost?: number | null;
}

export interface CityEquity {
  median_reports_per_1000: number | null;
  avg_resolution_hours: number | null;
}

export interface EquityStats {
  wards: WardEquity[];
  city: CityEquity;
}

/**
 * Fetch scoring formulas, category weights, active constants, and dynamic worked examples
 */
export async function getScoringExplainer(): Promise<{ data: ScoringExplainer | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("scoring_explainer");
    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as ScoringExplainer, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load scoring explainer";
    return { data: null, error: message };
  }
}

/**
 * Fetch municipal accountability stats across wards, departments, and citywide
 */
export async function getScoreboard(): Promise<{ data: ScoreboardStats | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("scoreboard_stats");
    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as ScoreboardStats, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load scoreboard stats";
    return { data: null, error: message };
  }
}

/**
 * Fetch ward equity indicators comparing turnaround speed and reporting density
 */
export async function getEquityStats(): Promise<{ data: EquityStats | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("equity_stats");
    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as EquityStats, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load equity stats";
    return { data: null, error: message };
  }
}

// ----------------------------------------------------------------------------
// Display-only Formatting Helpers (keeps nulls as nulls / "No data yet", never 0)
// ----------------------------------------------------------------------------

export function formatPct(val: number | null | undefined): string {
  if (val === null || val === undefined) return "No data yet";
  return `${val}%`;
}

export function formatHours(val: number | null | undefined): string {
  if (val === null || val === undefined) return "No data yet";
  return `${val} hrs`;
}

export function formatRatio(val: number | null | undefined): string {
  if (val === null || val === undefined) return "No data yet";
  return `${val}x`;
}

export function formatRatePer1k(val: number | null | undefined): string {
  if (val === null || val === undefined) return "No data yet";
  return `${val}`;
}
