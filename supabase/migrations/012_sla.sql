-- ============================================================================
-- 012_sla.sql
-- Civic Issue Tracker - SLA Timers, Escalation Levels, & Officer Dashboard
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- 1. `sla_clock_start`:
--    Inspects `public.status_history` and `public.issues` to identify the latest
--    reopened timestamp or creation timestamp. SECURITY DEFINER ensures reliable
--    clock resolution under Row Level Security.
-- 2. `sla_overview`:
--    Computes active SLA countdowns, due dates, remaining hours, and status states
--    across issues without exposing citizen or officer user UUIDs.
-- 3. `issue_escalations`:
--    Retrieves public audit notices of escalation events from `public.escalations`.
-- 4. `run_sla_escalation`:
--    Evaluates SLA breaches across open issues and idempotently writes missing
--    level 1 and level 2 audit records. SECURITY DEFINER is required to execute
--    system writes while direct write privileges to `public.escalations` remain
--    revoked from public/anon/authenticated roles (granted to service_role only).
-- 5. `list_escalations`:
--    Enforces officer or admin authentication using `officer_scope()` and scopes
--    escalated issues to the caller's jurisdiction (ward/department).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ESCALATIONS TABLE
-- ----------------------------------------------------------------------------
-- Audit table recording SLA breaches. Stores no citizen or officer user IDs.
-- All writes occur strictly via `run_sla_escalation()`.
create table if not exists public.escalations (
  id bigserial primary key,
  issue_id uuid not null references public.issues(id) on delete cascade,
  level int not null check (level in (1, 2)),
  clock_started_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (issue_id, level, clock_started_at)
);

create index if not exists idx_escalations_issue_id on public.escalations(issue_id);
create index if not exists idx_escalations_level on public.escalations(level);

-- Enable RLS: allow public SELECT only
alter table public.escalations enable row level security;

create policy "Escalations are viewable by everyone"
  on public.escalations for select
  using (true);

-- ----------------------------------------------------------------------------
-- 2. SLA CLOCK START FUNCTION
-- ----------------------------------------------------------------------------
-- the clock restarts when a fix is disputed.
create or replace function public.sla_clock_start(p_issue_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Returns the timestamp when the SLA clock started for the issue.
-- The clock restarts when a fix is disputed (latest status = 'reopened').
-- Otherwise falls back to issues.created_at.
declare
  v_reopened_at timestamptz;
  v_created_at timestamptz;
begin
  select sh.created_at into v_reopened_at
  from public.status_history sh
  where sh.issue_id = p_issue_id
    and sh.status = 'reopened'
  order by sh.created_at desc
  limit 1;

  if v_reopened_at is not null then
    return v_reopened_at;
  end if;

  select i.created_at into v_created_at
  from public.issues i
  where i.id = p_issue_id;

  return v_created_at;
end;
$$;

grant execute on function public.sla_clock_start(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. SLA FACTORS & THRESHOLD CONSTANTS
-- ----------------------------------------------------------------------------
-- Plain immutable functions representing escalation multiplier constants.
-- These are the only constants to change.

create or replace function public.sla_level1_factor()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  -- Level 1: the deadline has passed (escalated to the department head)
  select 1.0;
$$;

create or replace function public.sla_level2_factor()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  -- Level 2: twice the deadline has passed (escalated to the city admin)
  select 2.0;
$$;

create or replace function public.sla_due_soon_fraction()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  -- Due soon: less than a quarter of the time left
  select 0.25;
$$;

grant execute on function public.sla_level1_factor to anon, authenticated;
grant execute on function public.sla_level2_factor to anon, authenticated;
grant execute on function public.sla_due_soon_fraction to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. HELPER: SLA LEVEL FOR DURATION
-- ----------------------------------------------------------------------------
-- Computes escalation level (0, 1, or 2) for an issue based on elapsed hours.
-- Used by both sla_overview and run_sla_escalation to eliminate duplicate logic.
create or replace function public.sla_level_for(
  p_sla_hours int,
  p_clock_start timestamptz
)
returns int
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Computes SLA escalation level:
-- 2: elapsed hours >= sla_hours * sla_level2_factor()
-- 1: elapsed hours >= sla_hours * sla_level1_factor()
-- 0: deadline not yet breached
declare
  v_elapsed_hours numeric;
begin
  if p_sla_hours is null or p_sla_hours <= 0 or p_clock_start is null then
    return 0;
  end if;

  v_elapsed_hours := extract(epoch from (now() - p_clock_start)) / 3600.0;

  if v_elapsed_hours >= (p_sla_hours * public.sla_level2_factor()) then
    return 2;
  elsif v_elapsed_hours >= (p_sla_hours * public.sla_level1_factor()) then
    return 1;
  else
    return 0;
  end if;
end;
$$;

grant execute on function public.sla_level_for(int, timestamptz) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. SLA OVERVIEW RPC
-- ----------------------------------------------------------------------------
-- Returns a jsonb array of SLA details for all issues (or single issue p_issue_id).
-- Computes hours_remaining, escalation level, and SLA state.
-- Never returns user IDs. Uses LEFT JOINs so no issue is lost.
create or replace function public.sla_overview(
  p_issue_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public SLA overview: Computes target response hours, due timestamps,
-- remaining hours, and escalation states without leaking user IDs.
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(item_row), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'issue_id', i.id,
        'status', i.status,
        'sla_hours', c.sla_hours,
        'clock_started_at', cs.clock_start,
        'due_at', (cs.clock_start + make_interval(hours => coalesce(c.sla_hours, 0))),
        'hours_remaining', case
          when i.status = 'resolved' then null
          else round((extract(epoch from ((cs.clock_start + make_interval(hours => coalesce(c.sla_hours, 0))) - now())) / 3600.0)::numeric, 1)
        end,
        'level', case
          when i.status = 'resolved' then 0
          else public.sla_level_for(c.sla_hours, cs.clock_start)
        end,
        'state', case
          when i.status = 'resolved' then
            case
              when i.resolved_at is not null and i.resolved_at <= (cs.clock_start + make_interval(hours => coalesce(c.sla_hours, 0))) then 'met'
              else 'missed'
            end
          when public.sla_level_for(c.sla_hours, cs.clock_start) = 2 then 'severely_overdue'
          when public.sla_level_for(c.sla_hours, cs.clock_start) = 1 then 'overdue'
          when round((extract(epoch from ((cs.clock_start + make_interval(hours => coalesce(c.sla_hours, 0))) - now())) / 3600.0)::numeric, 1) <= (coalesce(c.sla_hours, 0) * public.sla_due_soon_fraction()) then 'due_soon'
          else 'on_track'
        end
      ) as item_row
    from public.issues i
    left join public.categories c on c.key = i.category
    cross join lateral (
      select public.sla_clock_start(i.id) as clock_start
    ) cs
    where (p_issue_id is null or i.id = p_issue_id)
    order by i.created_at desc
  ) sub;

  return v_result;
end;
$$;

grant execute on function public.sla_overview to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. ISSUE ESCALATIONS AUDIT RPC
-- ----------------------------------------------------------------------------
-- Returns jsonb array [{level, label, created_at}] of escalation notices for an issue.
create or replace function public.issue_escalations(
  p_issue_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Returns escalation milestones logged for an issue.
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(esc_row), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'level', e.level,
      'label', case
        when e.level = 1 then 'Escalated to department head'
        when e.level = 2 then 'Escalated to city admin'
        else 'Escalated'
      end,
      'created_at', e.created_at
    ) as esc_row
    from public.escalations e
    where e.issue_id = p_issue_id
    order by e.level asc, e.created_at asc
  ) sub;

  return v_result;
end;
$$;

grant execute on function public.issue_escalations to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. RUN SLA ESCALATION ENGINE (Service Role only)
-- ----------------------------------------------------------------------------
-- Iterates open issues, evaluates levels, and idempotently inserts missing
-- escalation records. An issue at level 2 receives both level 1 and level 2 rows.
create or replace function public.run_sla_escalation()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
-- Automated SLA escalation processor: Scans open issues and inserts missing
-- escalation level records into public.escalations.
-- SECURITY DEFINER allows internal worker execution with no direct client write permissions.
declare
  v_checked int := 0;
  v_new_level1 int := 0;
  v_new_level2 int := 0;
begin
  -- Total open issues checked
  select count(*) into v_checked
  from public.issues
  where status != 'resolved';

  -- Insert Level 1 escalations for open issues at level >= 1
  with ins_l1 as (
    insert into public.escalations (issue_id, level, clock_started_at)
    select
      i.id,
      1,
      cs.clock_start
    from public.issues i
    left join public.categories c on c.key = i.category
    cross join lateral (
      select public.sla_clock_start(i.id) as clock_start
    ) cs
    where i.status != 'resolved'
      and public.sla_level_for(c.sla_hours, cs.clock_start) >= 1
    on conflict (issue_id, level, clock_started_at) do nothing
    returning 1
  )
  select count(*) into v_new_level1 from ins_l1;

  -- Insert Level 2 escalations for open issues at level = 2
  with ins_l2 as (
    insert into public.escalations (issue_id, level, clock_started_at)
    select
      i.id,
      2,
      cs.clock_start
    from public.issues i
    left join public.categories c on c.key = i.category
    cross join lateral (
      select public.sla_clock_start(i.id) as clock_start
    ) cs
    where i.status != 'resolved'
      and public.sla_level_for(c.sla_hours, cs.clock_start) >= 2
    on conflict (issue_id, level, clock_started_at) do nothing
    returning 1
  )
  select count(*) into v_new_level2 from ins_l2;

  return jsonb_build_object(
    'checked', v_checked,
    'new_level1', v_new_level1,
    'new_level2', v_new_level2
  );
end;
$$;

revoke all on function public.run_sla_escalation from public, anon, authenticated;
grant execute on function public.run_sla_escalation to service_role;

-- ----------------------------------------------------------------------------
-- 8. LIST ESCALATIONS RPC (Officer / Admin Queue)
-- ----------------------------------------------------------------------------
-- Returns open escalated issues (level >= 1) scoped to caller's jurisdiction.
-- Ordered by level desc, hours_overdue desc.
create or replace function public.list_escalations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Officer escalation dashboard: Lists open overdue issues at level >= 1
-- scoped to the officer's department and ward.
-- SECURITY DEFINER allows inspecting caller profile scope under RLS.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_result jsonb;
begin
  -- 1. Check caller role and get jurisdiction scope (raises exception if not officer/admin)
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Query open escalated issues
  select coalesce(jsonb_agg(item_row), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'issue_id', i.id,
      'category', i.category,
      'category_label', c.label,
      'status', i.status,
      'priority_score', i.priority_score,
      'priority_band', i.priority_band,
      'ward_name', w.name,
      'department_name', d.name,
      'level', calc.lvl,
      'label', case
        when calc.lvl = 1 then 'Escalated to department head'
        when calc.lvl = 2 then 'Escalated to city admin'
        else 'Escalated'
      end,
      'hours_overdue', round(greatest(0, extract(epoch from (now() - calc.due_at)) / 3600.0)::numeric, 1),
      'due_at', calc.due_at,
      'assigned_to_name', ap.display_name
    ) as item_row
    from public.issues i
    left join public.categories c on c.key = i.category
    left join public.wards w on w.id = i.ward_id
    left join public.departments d on d.id = i.department_id
    left join public.profiles ap on ap.id = i.assigned_to
    cross join lateral (
      select
        cs.clock_start,
        (cs.clock_start + make_interval(hours => coalesce(c.sla_hours, 0))) as due_at,
        public.sla_level_for(c.sla_hours, cs.clock_start) as lvl
      from (
        select public.sla_clock_start(i.id) as clock_start
      ) cs
    ) calc
    where i.status != 'resolved'
      and calc.lvl >= 1
      and (v_role = 'admin' or v_dept is null or i.department_id = v_dept)
      and (v_role = 'admin' or v_ward is null or i.ward_id = v_ward)
    order by calc.lvl desc, round(greatest(0, extract(epoch from (now() - calc.due_at)) / 3600.0)::numeric, 1) desc
  ) sub;

  return v_result;
end;
$$;

grant execute on function public.list_escalations to authenticated;

-- ----------------------------------------------------------------------------
-- 9. INITIALIZE SETTINGS ENTRY
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('sla_last_run', '1970-01-01T00:00:00Z')
on conflict (key) do nothing;
