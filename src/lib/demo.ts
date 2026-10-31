import { supabase } from "@/lib/supabase/client";

/**
 * Checks whether demo sample data is currently active in the database.
 * Calls the `demo_data_active()` RPC which inspects `demo_seed_issues`.
 * Returns false on any error or missing data.
 */
export async function getDemoActive(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("demo_data_active");
    if (error) {
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}
