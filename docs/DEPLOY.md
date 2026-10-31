# Civic Tracker Deployment Guide

## Vercel Environment Variables Checklist

Configure these environment variables in your Vercel Project Settings under **Settings > Environment Variables**.

> **IMPORTANT**: Set all `NEXT_PUBLIC_*` environment variables in Vercel **before the first build**! Next.js inlines variables prefixed with `NEXT_PUBLIC_` into the client-side JavaScript bundle during the build step. If they are missing at build time, the client bundle will lack the necessary configuration.

Add all variables to **All Environments** (Production, Preview, Development):

### Browser-Accessible (Public Client & Server)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Server-Only (Sensitive Secrets)
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

*(Provide names only in code/docs. Never commit or expose secret values.)*

---

## Supabase Configuration

### 1. Authentication URL Configuration
In the Supabase Dashboard, go to **Authentication > URL Configuration**:

- **Site URL**:
  Set to your production Vercel URL or custom domain:
  `https://<your-project>.vercel.app`

- **Redirect URLs**:
  Add the following allowed callback wildcard patterns:
  - `https://<your-project>.vercel.app/**`
  - `https://*-<your-team-slug>.vercel.app/**`
  - `http://localhost:3000/**`

### 2. Authentication Providers
In **Authentication > Providers**:
- **Anonymous Sign-In**: **Enabled** (essential for citizen report submissions and duplicate issue upvotes without requiring an account).
- **Email**: **Enabled** (for municipal officer login via email and password).

### 3. Storage Buckets
In **Storage > Buckets**:
- Both `report-photos` and `resolution-photos` buckets must be configured as **Public** so that citizen issue photos and officer fix verification photos can be loaded by the web application.

---

## Before Presenting

Before demonstrating or pitching the live application, complete this checklist:

1. **Authentication > Rate Limits**:
   In the Supabase Dashboard under **Authentication > Rate Limits**, raise the anonymous sign-ins per hour rate limit so high traffic during the demo does not trigger rate limiting errors.

2. **Rotate Passwords**:
   Rotate the test officer and admin passwords in Supabase Authentication and never commit them to version control.

3. **Check Gemini Free-Tier Limits**:
   Check your API quota and rate limits for Gemini in Google AI Studio to ensure sufficient headroom for live photo verification during demonstrations.

4. **Warm Up the Live Site**:
   Open the live site a few minutes before presenting to warm up Vercel serverless cold starts and prime edge caching.

5. **Weather & SLA Background Jobs**:
   In this deployment, the weather cache refresh and SLA escalation jobs run automatically on page visits (cached at 30 minutes and 5 minutes respectively). In a production municipal rollout, an automated scheduled cron job (such as Vercel Cron or Supabase `pg_cron`) would replace page-triggered execution.
