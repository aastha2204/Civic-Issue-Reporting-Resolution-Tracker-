import { supabase } from "@/lib/supabase/client";

/**
 * Universal Authentication Actions for Nagrik
 * 
 * All authentication interactions are consolidated in this single module.
 * If swapping the underlying provider (e.g. Supabase -> another auth provider),
 * only this file needs to be modified.
 * 
 * Each integration point is marked with `// AUTH HOOK:` comments.
 */

export interface AuthResult {
  success: boolean;
  redirectUrl?: string;
  message?: string;
  error?: string;
  needsEmailConfirmation?: boolean;
}

/**
 * Sanitizes and maps auth errors to user-friendly, security-conscious messages.
 * Never reveals whether a specific email exists in the database.
 */
export function friendlyAuthError(err: unknown): string {
  if (!err) return "An unexpected error occurred.";
  const rawMsg = (
    typeof err === "string"
      ? err
      : (err as { message?: string; error_description?: string })?.message ||
        (err as { message?: string; error_description?: string })?.error_description ||
        String(err)
  ).toLowerCase();

  // Network or connectivity errors
  if (
    rawMsg.includes("failed to fetch") ||
    rawMsg.includes("network") ||
    rawMsg.includes("connection") ||
    rawMsg.includes("offline")
  ) {
    return "Network error. Please check your connection and try again.";
  }

  // Rate limiting / too many attempts
  if (
    rawMsg.includes("rate limit") ||
    rawMsg.includes("too many requests") ||
    rawMsg.includes("over_request_rate_limit")
  ) {
    return "Too many failed attempts. Please wait a few minutes before trying again.";
  }

  // Email confirmation required
  if (
    rawMsg.includes("email not confirmed") ||
    rawMsg.includes("email_not_confirmed") ||
    rawMsg.includes("unconfirmed")
  ) {
    return "Please verify your email address before signing in. Check your inbox for the confirmation link.";
  }

  // Google provider configuration / OAuth disabled
  if (
    rawMsg.includes("provider is not enabled") ||
    rawMsg.includes("unsupported provider") ||
    rawMsg.includes("oauth") ||
    rawMsg.includes("provider not found")
  ) {
    return "Google sign-in is not set up yet.";
  }

  // Incorrect credentials (generic message for all credential lookup failures)
  if (
    rawMsg.includes("invalid login credentials") ||
    rawMsg.includes("invalid_credentials") ||
    rawMsg.includes("invalid password") ||
    rawMsg.includes("user not found") ||
    rawMsg.includes("wrong password")
  ) {
    return "Incorrect email or password.";
  }

  return "Incorrect email or password.";
}

/**
 * Resolves destination URL from the server by verifying user role
 * in the profiles table on the SERVER.
 */
async function resolveServerRedirect(
  accessToken: string,
  nextParam?: string | null
): Promise<string> {
  try {
    const res = await fetch("/api/auth/role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ next: nextParam || null }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.redirectUrl) {
        return data.redirectUrl;
      }
    }
  } catch (err) {
    console.error("Failed to resolve server role redirect:", err);
  }

  // Fallback if network or server call fails
  return "/my-reports";
}

/**
 * Signs in a user using email and password credentials.
 * Email is automatically trimmed and converted to lowercase.
 */
export async function signInWithPassword(
  email: string,
  password: string,
  nextParam?: string | null
): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail || !password) {
    return {
      success: false,
      error: "Please enter both your email address and password.",
    };
  }

  try {
    // AUTH HOOK: Authenticate with password provider (Supabase Auth)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      return {
        success: false,
        error: friendlyAuthError(error),
      };
    }

    if (!data.session?.access_token) {
      return {
        success: false,
        error: "Incorrect email or password.",
      };
    }

    // AUTH HOOK: Verify user role on the SERVER from profiles table
    const redirectUrl = await resolveServerRedirect(
      data.session.access_token,
      nextParam
    );

    return {
      success: true,
      redirectUrl,
    };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthError(err),
    };
  }
}

/**
 * Initiates Google OAuth sign-in.
 * If the provider is not configured, provides a friendly error without crashing.
 */
export async function signInWithGoogle(
  nextParam?: string | null
): Promise<AuthResult> {
  try {
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "";

    const redirectTo =
      nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
        ? `${origin}/auth/callback?next=${encodeURIComponent(nextParam)}`
        : `${origin}/auth/callback`;

    // AUTH HOOK: Authenticate via OAuth provider (Google)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      return {
        success: false,
        error: friendlyAuthError(error),
      };
    }

    return {
      success: true,
      redirectUrl: data?.url || undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthError(err),
    };
  }
}

/**
 * Registers a new citizen account with email and password.
 */
export async function signUp(
  email: string,
  password: string,
  confirmPassword?: string,
  displayName?: string
): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail) {
    return { success: false, error: "Please enter a valid email address." };
  }

  if (!password || password.length < 6) {
    return {
      success: false,
      error: "Password must be at least 6 characters long.",
    };
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    return {
      success: false,
      error: "Passwords do not match.",
    };
  }

  try {
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "";

    // AUTH HOOK: Register new account in Auth provider (Supabase Auth)
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: displayName ? { display_name: displayName.trim() } : undefined,
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) {
      return {
        success: false,
        error: friendlyAuthError(error),
      };
    }

    // If confirmation email was dispatched (session is null)
    if (data.user && !data.session) {
      return {
        success: true,
        needsEmailConfirmation: true,
        message:
          "Account created! We have sent a verification link to your email. Please verify to sign in.",
      };
    }

    // Direct sign-in if email confirmation is disabled in Supabase instance
    const redirectUrl = data.session?.access_token
      ? await resolveServerRedirect(data.session.access_token)
      : "/my-reports";

    return {
      success: true,
      needsEmailConfirmation: false,
      redirectUrl,
    };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthError(err),
    };
  }
}

/**
 * Sends a password reset email via Supabase Auth.
 * Never reveals if the email address exists in the system.
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail) {
    return { success: false, error: "Please enter your email address." };
  }

  try {
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "";

    // AUTH HOOK: Request password reset email from Auth provider (Supabase Auth)
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${origin}/reset-password`,
    });

    if (error) {
      const friendly = friendlyAuthError(error);
      // Suppress enumeration details, keep rate limits or network issues visible
      if (
        friendly.includes("Too many") ||
        friendly.includes("Network")
      ) {
        return { success: false, error: friendly };
      }
    }

    return {
      success: true,
      message:
        "If an account exists for that email, a password reset link has been sent. Please check your inbox.",
    };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthError(err),
    };
  }
}

/**
 * Updates the user's password using the active reset session.
 */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
  if (!newPassword || newPassword.length < 6) {
    return {
      success: false,
      error: "New password must be at least 6 characters long.",
    };
  }

  try {
    // AUTH HOOK: Update authenticated user password
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return {
        success: false,
        error: friendlyAuthError(error),
      };
    }

    return {
      success: true,
      message: "Your password has been successfully updated. You may now sign in.",
    };
  } catch (err) {
    return {
      success: false,
      error: friendlyAuthError(err),
    };
  }
}

/**
 * Checks if the current visitor already has an active, non-anonymous session.
 * Used on /login to automatically redirect already signed-in users.
 */
export async function checkActiveSession(
  nextParam?: string | null
): Promise<{ signedIn: boolean; redirectUrl?: string }> {
  try {
    // AUTH HOOK: Check active session with Auth provider
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const user = session?.user;

    // Anonymous sessions are used for guest reporting and do not count as logged in
    if (!session || !user || user.is_anonymous) {
      return { signedIn: false };
    }

    const redirectUrl = await resolveServerRedirect(
      session.access_token,
      nextParam
    );

    return { signedIn: true, redirectUrl };
  } catch {
    return { signedIn: false };
  }
}

/**
 * Signs out the currently authenticated user and re-establishes an anonymous
 * guest session so public map browsing and reporting continue working.
 */
export async function signOutUser(): Promise<{ error: Error | null }> {
  try {
    // AUTH HOOK: Sign out current user session
    await supabase.auth.signOut();
    // Re-establish anonymous session for public reporting/tracking
    await supabase.auth.signInAnonymously();
    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
