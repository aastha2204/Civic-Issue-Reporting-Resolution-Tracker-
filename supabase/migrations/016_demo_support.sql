-- ============================================================================
-- 016_demo_support.sql
-- Civic Issue Tracker - Demo Data Isolation, Reset Tracking, and Status Check
-- ============================================================================
--
-- ARCHITECTURE & DATA HONESTY:
-- 1. Demo Data Isolation:
--    To strictly protect production data integrity, all issues and synthetic auth
--    users created by demo seeding scripts are registered in `demo_seed_issues`
--    and `demo_seed_users`.
-- 2. Clean Idempotent Reset:
--    The reset command exclusively deletes records tracked in these tables and
--    their ON DELETE CASCADE dependencies without touching genuine citizen reports.
-- 3. Transparent UI Indicator:
--    The public and officer dashboards call `demo_data_active()` to display an
--    unobtrusive demo data notice whenever sample data is active.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEMO SEED TRACKING TABLES
-- ----------------------------------------------------------------------------

-- Tracks seeded demo issue UUIDs for targeted reset
create table if not exists public.demo_seed_issues (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Tracks synthetic demo citizen user IDs for targeted auth cleanup
create table if not exists public.demo_seed_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

-- Enable RLS: keep tables strictly private to service role (no client policies)
alter table public.demo_seed_issues enable row level security;
alter table public.demo_seed_users enable row level security;


-- ----------------------------------------------------------------------------
-- 2. DEMO STATUS INSPECTOR FUNCTION: demo_data_active()
-- ----------------------------------------------------------------------------
-- Checks whether any demo seed issues are currently present in the database.
--
-- SECURITY NOTE:
-- Declared SECURITY DEFINER because `demo_seed_issues` has Row Level Security
-- enabled with no policies granted to anon or authenticated users. SECURITY DEFINER
-- allows anonymous citizens, authenticated officers, and public viewers to safely
-- check if demo data is active without granting them direct read permissions on
-- the internal seed tracking table.
create or replace function public.demo_data_active()
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return exists (
    select 1
    from public.demo_seed_issues
    limit 1
  );
end;
$$;

-- Grant execution to public visitors and authenticated users
grant execute on function public.demo_data_active to anon, authenticated;
