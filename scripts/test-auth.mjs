import test from "node:test";
import assert from "node:assert/strict";

// Mirror of friendlyAuthError from src/lib/auth-actions.ts for runtime assertion
function friendlyAuthError(err) {
  if (!err) return "An unexpected error occurred.";
  const rawMsg = (
    typeof err === "string"
      ? err
      : err?.message || err?.error_description || String(err)
  ).toLowerCase();

  if (
    rawMsg.includes("failed to fetch") ||
    rawMsg.includes("network") ||
    rawMsg.includes("connection") ||
    rawMsg.includes("offline")
  ) {
    return "Network error. Please check your connection and try again.";
  }

  if (
    rawMsg.includes("rate limit") ||
    rawMsg.includes("too many requests") ||
    rawMsg.includes("over_request_rate_limit")
  ) {
    return "Too many failed attempts. Please wait a few minutes before trying again.";
  }

  if (
    rawMsg.includes("email not confirmed") ||
    rawMsg.includes("email_not_confirmed") ||
    rawMsg.includes("unconfirmed")
  ) {
    return "Please verify your email address before signing in. Check your inbox for the confirmation link.";
  }

  if (
    rawMsg.includes("provider is not enabled") ||
    rawMsg.includes("unsupported provider") ||
    rawMsg.includes("oauth") ||
    rawMsg.includes("provider not found")
  ) {
    return "Google sign-in is not set up yet.";
  }

  return "Incorrect email or password.";
}

function isSafeRelativePath(path) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

function resolveRedirectDestination(role, nextParam) {
  if (isSafeRelativePath(nextParam)) {
    return nextParam;
  }
  if (role === "officer") return "/officer";
  if (role === "admin") return "/officer";
  return "/my-reports";
}

test("friendlyAuthError: maps wrong credentials to generic message without leaking account existence", () => {
  assert.equal(
    friendlyAuthError("Invalid login credentials"),
    "Incorrect email or password."
  );
  assert.equal(
    friendlyAuthError("invalid_credentials"),
    "Incorrect email or password."
  );
  assert.equal(
    friendlyAuthError("User not found"),
    "Incorrect email or password."
  );
});

test("friendlyAuthError: maps rate limit errors to friendly notice", () => {
  assert.equal(
    friendlyAuthError("over_request_rate_limit"),
    "Too many failed attempts. Please wait a few minutes before trying again."
  );
  assert.equal(
    friendlyAuthError("Too many requests from this IP"),
    "Too many failed attempts. Please wait a few minutes before trying again."
  );
});

test("friendlyAuthError: maps unconfirmed email to verification notice", () => {
  assert.equal(
    friendlyAuthError("Email not confirmed"),
    "Please verify your email address before signing in. Check your inbox for the confirmation link."
  );
});

test("friendlyAuthError: maps network errors to connection notice", () => {
  assert.equal(
    friendlyAuthError("Failed to fetch"),
    "Network error. Please check your connection and try again."
  );
});

test("friendlyAuthError: maps unconfigured oauth provider to friendly notice", () => {
  assert.equal(
    friendlyAuthError("Unsupported provider: provider is not enabled"),
    "Google sign-in is not set up yet."
  );
});

test("redirectDestination: correctly routes citizen, officer, and admin", () => {
  assert.equal(resolveRedirectDestination("citizen", null), "/my-reports");
  assert.equal(resolveRedirectDestination("officer", null), "/officer");
  assert.equal(resolveRedirectDestination("admin", null), "/officer");
});

test("redirectDestination: honors safe relative ?next= parameter", () => {
  assert.equal(
    resolveRedirectDestination("citizen", "/tracker"),
    "/tracker"
  );
  assert.equal(
    resolveRedirectDestination("officer", "/officer/escalations"),
    "/officer/escalations"
  );
});

test("redirectDestination: rejects open redirect attempts via protocol-relative // URLs", () => {
  assert.equal(
    resolveRedirectDestination("citizen", "//evil.com"),
    "/my-reports"
  );
  assert.equal(
    resolveRedirectDestination("officer", "https://evil.com"),
    "/officer"
  );
});
