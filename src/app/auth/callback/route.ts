import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * OAuth & Auth Confirmation Callback Route Handler
 * 
 * Exchanges authentication code for a valid session using the server client,
 * reads user role from the profiles table on the SERVER, and redirects
 * to the appropriate destination based on role and safe ?next= parameter.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");

  let redirectPath = "/my-reports";

  if (code) {
    try {
      // Exchange code for session using existing server client
      const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code);

      if (!error && data?.user) {
        // Read role from profiles table on the SERVER (never from browser or metadata)
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();

        const role = profile?.role || "citizen";

        if (role === "officer") {
          redirectPath = "/officer";
        } else if (role === "admin") {
          // Admin goes to /admin if that page exists, otherwise /officer
          redirectPath = "/officer";
        } else {
          redirectPath = "/my-reports";
        }
      }
    } catch (err) {
      console.error("Auth callback code exchange error:", err);
    }
  }

  // Respect a safe ?next= parameter only if it is a relative path starting with a single slash
  if (
    nextParam &&
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//")
  ) {
    redirectPath = nextParam;
  }

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}
