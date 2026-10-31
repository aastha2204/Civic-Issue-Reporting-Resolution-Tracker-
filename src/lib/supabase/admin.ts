import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";

/**
 * Server-only Supabase client utilizing the high-privilege service_role secret key.
 * Used exclusively within server routes and internal workers to execute administrative
 * operations (such as weather cache updates and global issue recomputations).
 * 
 * NEVER expose this instance or the service role key to the client browser!
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export default supabaseAdmin;
