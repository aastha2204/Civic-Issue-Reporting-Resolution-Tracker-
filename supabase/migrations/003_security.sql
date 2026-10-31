-- ============================================================================
-- 003_security.sql
-- Civic Issue Tracker - Row Level Security (RLS), Views, & Storage Policies
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- In 002_scoring.sql, functions `recompute_issue_score`, `trigger_recompute_issue_score`,
-- and `trigger_issue_status_history` are explicitly declared `SECURITY DEFINER`.
-- This is intentional by design:
-- When a citizen submits a new report or upvote, they only possess insert rights
-- to their own record. However, computing the overall civic priority requires
-- counting distinct reporters across all users, updating the aggregate `issues`
-- row, and recording an immutable entry into `status_history`.
-- Declaring these triggers SECURITY DEFINER guarantees that recalculations and audit
-- trails execute securely under system authority without exposing broad update
-- privileges on `issues` or read access on other citizens' private records to the public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ----------------------------------------------------------------------------
alter table public.wards enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.issues enable row level security;
alter table public.reports enable row level security;
alter table public.upvotes enable row level security;
alter table public.status_history enable row level security;
alter table public.resolutions enable row level security;
alter table public.fix_confirmations enable row level security;
alter table public.places enable row level security;
alter table public.weather_cache enable row level security;
alter table public.app_settings enable row level security;

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS FOR ROLE CHECKING
-- ----------------------------------------------------------------------------
create or replace function public.is_officer_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('officer', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. PUBLIC VIEW FOR CITIZEN REPORTS (Conceals user_id for privacy)
-- ----------------------------------------------------------------------------
create or replace view public.public_issue_reports as
select
  id,
  issue_id,
  is_anonymous,
  on_behalf,
  description,
  photo_url,
  photo_location,
  report_location,
  ai_suggested_category,
  ai_suggested_severity,
  created_at
from public.reports;

grant select on public.public_issue_reports to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. POLICIES: PUBLIC REFERENCE TABLES (Read-only for all)
-- ----------------------------------------------------------------------------
-- Categories
create policy "Categories are viewable by everyone"
on public.categories for select
using (true);

-- Wards
create policy "Wards are viewable by everyone"
on public.wards for select
using (true);

-- Departments
create policy "Departments are viewable by everyone"
on public.departments for select
using (true);

-- Places (Sensory exposure landmarks)
create policy "Places are viewable by everyone"
on public.places for select
using (true);

-- Weather Cache
create policy "Weather cache is viewable by everyone"
on public.weather_cache for select
using (true);

-- App Settings (Readable by everyone, updatable by officer or admin for rain simulation)
create policy "App settings are viewable by everyone"
on public.app_settings for select
using (true);

create policy "App settings are updatable by officers or admins"
on public.app_settings for update
using (public.is_officer_or_admin())
with check (public.is_officer_or_admin());

-- ----------------------------------------------------------------------------
-- 5. POLICIES: ISSUES
-- ----------------------------------------------------------------------------
-- Publicly readable by everyone for civic transparency
create policy "Issues are viewable by everyone"
on public.issues for select
using (true);

-- Authenticated users (including anonymous sign-ins) can insert new issues
create policy "Authenticated users can insert issues"
on public.issues for insert
to authenticated
with check (true);

-- Only officers or admins can manually update issues (status, assignment, etc.)
create policy "Officers and admins can update issues"
on public.issues for update
using (public.is_officer_or_admin())
with check (public.is_officer_or_admin());

-- ----------------------------------------------------------------------------
-- 6. POLICIES: REPORTS
-- ----------------------------------------------------------------------------
-- Authenticated users can view their own reports; officers/admins can view all reports.
-- General public reads through `public_issue_reports` view without user_id exposure.
create policy "Users can view own reports or officers view all"
on public.reports for select
to authenticated
using (user_id = auth.uid() or public.is_officer_or_admin());

-- Authenticated users can insert their own reports
create policy "Users can insert reports with own user_id"
on public.reports for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 7. POLICIES: UPVOTES ("I am affected too")
-- ----------------------------------------------------------------------------
create policy "Users can view own upvotes or officers view all"
on public.upvotes for select
to authenticated
using (user_id = auth.uid() or public.is_officer_or_admin());

create policy "Users can insert own upvotes"
on public.upvotes for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 8. POLICIES: STATUS HISTORY
-- ----------------------------------------------------------------------------
-- Publicly readable audit trail
create policy "Status history is viewable by everyone"
on public.status_history for select
using (true);

-- Manual inserts restricted to officers or admins (automated trigger uses SECURITY DEFINER)
create policy "Officers and admins can insert status history"
on public.status_history for insert
to authenticated
with check (public.is_officer_or_admin());

-- ----------------------------------------------------------------------------
-- 9. POLICIES: RESOLUTIONS (Proof of Work)
-- ----------------------------------------------------------------------------
-- Publicly readable for accountability
create policy "Resolutions are viewable by everyone"
on public.resolutions for select
using (true);

-- Only assigned officers or admins can submit resolutions
create policy "Officers and admins can insert resolutions"
on public.resolutions for insert
to authenticated
with check (public.is_officer_or_admin());

-- ----------------------------------------------------------------------------
-- 10. POLICIES: FIX CONFIRMATIONS (Citizen dispute / verification)
-- ----------------------------------------------------------------------------
-- Citizens see their own votes; officers and admins see all votes
create policy "Users can view own fix confirmations or officers view all"
on public.fix_confirmations for select
to authenticated
using (user_id = auth.uid() or public.is_officer_or_admin());

create policy "Users can insert own fix confirmations"
on public.fix_confirmations for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 11. POLICIES: PROFILES & ROLE PROTECTION
-- ----------------------------------------------------------------------------
create policy "Users can view own profile or officers view all"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_officer_or_admin());

create policy "Users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "Users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Trigger to prevent users from escalating their own role
create or replace function public.trigger_protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if NEW.role is distinct from OLD.role then
    if not public.is_admin() then
      raise exception 'Unauthorized: Only an administrator can modify user roles.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
before update on public.profiles
for each row
execute function public.trigger_protect_profile_role();

-- ----------------------------------------------------------------------------
-- 12. STORAGE BUCKETS & STORAGE POLICIES
-- ----------------------------------------------------------------------------
-- Create storage buckets for citizen photo evidence and officer fix photos
insert into storage.buckets (id, name, public)
values
  ('report-photos', 'report-photos', true),
  ('resolution-photos', 'resolution-photos', true)
on conflict (id) do update set public = true;

-- Public read access to report and resolution images
create policy "Public can view report photos"
on storage.objects for select
using (bucket_id = 'report-photos');

create policy "Public can view resolution photos"
on storage.objects for select
using (bucket_id = 'resolution-photos');

-- Authenticated citizens can upload to report-photos
create policy "Authenticated users can upload report photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'report-photos');

-- Only verified officers or admins can upload to resolution-photos
create policy "Only officers can upload resolution photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'resolution-photos' and public.is_officer_or_admin());
