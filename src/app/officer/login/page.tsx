import { redirect } from "next/navigation";

/**
 * Legacy Officer Login Route
 * Preserves backwards compatibility by immediately redirecting to the unified /login page
 * with a pre-configured ?next=/officer destination parameter.
 */
export default function OfficerLoginRedirect() {
  redirect("/login?next=/officer");
}
