import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Server endpoint to securely resolve a user's role and target redirect destination.
 * 
 * Complies with strict security requirements:
 * - Reads the user's role directly from the `profiles` table on the SERVER.
 * - Never trusts browser-supplied role assertions or user metadata.
 * - Enforces safe relative URL redirection (?next= must start with '/' and not '//').
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 }
      );
    }

    // Inspect user identity directly via the server Supabase admin client
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session token" },
        { status: 401 }
      );
    }

    // Anonymous reporters are not authenticated account holders
    if (user.is_anonymous) {
      return NextResponse.json({
        success: true,
        role: "anonymous",
        redirectUrl: "/report",
      });
    }

    // Read the role from the profiles table on the SERVER
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Error reading profile on server:", profileError);
    }

    const role = profile?.role || "citizen";

    // Read optional ?next= parameter from JSON body
    let nextParam: string | null = null;
    try {
      const body = await request.json();
      nextParam = body?.next || null;
    } catch {
      // Body is optional
    }

    let redirectUrl = "/my-reports";

    // Respect a safe ?next= parameter only if it is a relative path starting with a single slash
    const isSafeRelative =
      typeof nextParam === "string" &&
      nextParam.startsWith("/") &&
      !nextParam.startsWith("//");

    if (isSafeRelative && nextParam) {
      redirectUrl = nextParam;
    } else {
      if (role === "officer") {
        redirectUrl = "/officer";
      } else if (role === "admin") {
        // Admin goes to /admin if that page exists, otherwise /officer
        redirectUrl = "/officer";
      } else {
        redirectUrl = "/my-reports";
      }
    }

    return NextResponse.json({
      success: true,
      role,
      redirectUrl,
    });
  } catch (error) {
    console.error("Failed to resolve user redirect on server:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
