-- ============================================================================
-- 013_transparency.sql
-- Civic Issue Tracker - Step 9 Part A: Public Transparency & Scoreboard Analytics
-- ============================================================================
-- Display-only analytics functions, constants, and explainer RPCs.
-- CHANGES NO SCORES.
-- Reuses existing helper functions:
--   - public.calculate_priority_score(...)
--   - public.sla_overview()
--   - public.merge_radius_meters()
--   - public.photo_match_radius_meters()
--   - public.resolution_radius_meters()
--   - public.heavy_rain_mm()
--   - public.reopen_threshold()
--   - public.sla_level1_factor()
--   - public.sla_level2_factor()
--   - public.sla_due_soon_fraction()
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 1. CITY-LEVEL EQUITY HELPERS
-- ----------------------------------------------------------------------------

-- Median reports per 1,000 residents across wards having population > 0.
-- Security definer because citizen reports are protected by RLS.
create or replace function public.city_median_reports_per_1000()
returns numeric
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Computes the median reports per 1,000 residents across wards with population > 0.
-- Declared SECURITY DEFINER because the reports table is restricted under RLS.
declare
  v_median numeric;
begin
  with ward_report_counts as (
    select
      w.id as ward_id,
      (count(r.id)::numeric * 1000.0 / w.population::numeric) as r_per_1k
    from public.wards w
    left join public.issues i on i.ward_id = w.id
    left join public.reports r on r.issue_id = i.id
    where w.population > 0
    group by w.id, w.population
  )
  select percentile_cont(0.5) within group (order by r_per_1k)::numeric
  into v_median
  from ward_report_counts;

  return v_median;
end;
$$;

grant execute on function public.city_median_reports_per_1000 to anon, authenticated;

-- Ratio of a ward's reports per 1,000 residents to the city median (2 decimals).
-- Null when population is null or <= 0, or city median is null or 0.
create or replace function public.ward_reporting_ratio(
  p_ward_id int
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Computes ratio of a ward's reports_per_1000 to the city median, rounded to 2 decimals.
-- Null when population is null or <= 0, or when median is null or 0.
-- Declared SECURITY DEFINER because the reports table is restricted under RLS.
declare
  v_pop int;
  v_reports_count bigint;
  v_rep_per_1k numeric;
  v_median numeric;
begin
  if p_ward_id is null then
    return null;
  end if;

  select population into v_pop
  from public.wards
  where id = p_ward_id;

  if v_pop is null or v_pop <= 0 then
    return null;
  end if;

  v_median := public.city_median_reports_per_1000();
  if v_median is null or v_median = 0 then
    return null;
  end if;

  select count(r.id) into v_reports_count
  from public.reports r
  join public.issues i on i.id = r.issue_id
  where i.ward_id = p_ward_id;

  v_rep_per_1k := (v_reports_count::numeric * 1000.0) / v_pop::numeric;
  return round((v_rep_per_1k / v_median)::numeric, 2);
end;
$$;

grant execute on function public.ward_reporting_ratio to anon, authenticated;

-- Threshold flag constant: a ward waits at least 2 times the city average
create or replace function public.equity_wait_flag_ratio()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  -- A ward waits at least 2 times the city average
  select 2.0;
$$;

grant execute on function public.equity_wait_flag_ratio to anon, authenticated;

-- Threshold flag constant: a ward reports at most half the city median per 1,000 residents
create or replace function public.equity_low_reporting_ratio()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  -- A ward reports at most half the city median per 1,000 residents
  select 0.5;
$$;

grant execute on function public.equity_low_reporting_ratio to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. SCORING EXPLAINER RPC
-- ----------------------------------------------------------------------------
-- Returns categories with weights, live operational constants, and the 4 canonical
-- worked examples evaluated directly by calculate_priority_score (never hardcoded).
create or replace function public.scoring_explainer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public scoring explainer: Exposes category hazard weights, engine constants,
-- and four canonical worked examples computed dynamically by calculate_priority_score.
declare
  v_categories jsonb;
  v_constants jsonb;
  v_examples jsonb;
begin
  -- 1. Categories ordered by base_weight desc
  select coalesce(jsonb_agg(cat_row), '[]'::jsonb)
  into v_categories
  from (
    select jsonb_build_object(
      'key', key,
      'label', label,
      'base_weight', base_weight,
      'sla_hours', sla_hours,
      'max_weather_boost', max_weather_boost
    ) as cat_row
    from public.categories
    order by base_weight desc, key asc
  ) c;

  -- 2. Constants read directly from existing helper functions
  v_constants := jsonb_build_object(
    'merge_radius_m', public.merge_radius_meters(),
    'photo_match_radius_m', public.photo_match_radius_meters(),
    'resolution_radius_m', public.resolution_radius_meters(),
    'heavy_rain_mm', public.heavy_rain_mm(),
    'reopen_threshold', public.reopen_threshold(),
    'sla_level1_factor', public.sla_level1_factor(),
    'sla_level2_factor', public.sla_level2_factor(),
    'sla_due_soon_fraction', public.sla_due_soon_fraction(),
    'equity_low_reporting_ratio', public.equity_low_reporting_ratio()
  );

  -- 3. Four canonical worked examples from docs/SPEC.md evaluated via calculate_priority_score
  v_examples := jsonb_build_array(
    jsonb_build_object(
      'title', 'Dangerous Pothole near School & Main Road',
      'inputs', jsonb_build_object(
        'severity_pts', 26,
        'location_pts', 22,
        'unique_reporters', 6,
        'days_open', 7,
        'context_boost_pts', 0,
        'equity_pts', 0,
        'reopen_count', 0
      ),
      'result', public.calculate_priority_score(26, 22, 6, 7, 0, 0, 0, 'dangerous pothole', 'near school and main road', null)
    ),
    jsonb_build_object(
      'title', 'Waterlogging with Heavy Rain Forecast',
      'inputs', jsonb_build_object(
        'severity_pts', 24,
        'location_pts', 20,
        'unique_reporters', 3,
        'days_open', 1,
        'context_boost_pts', 15,
        'equity_pts', 0,
        'reopen_count', 0
      ),
      'result', public.calculate_priority_score(24, 20, 3, 1, 15, 0, 0, 'dangerous waterlogging', 'near hospital and main road', 'heavy rain forecast')
    ),
    jsonb_build_object(
      'title', 'Same Waterlogging under Dry Conditions',
      'inputs', jsonb_build_object(
        'severity_pts', 24,
        'location_pts', 20,
        'unique_reporters', 3,
        'days_open', 1,
        'context_boost_pts', 0,
        'equity_pts', 0,
        'reopen_count', 0
      ),
      'result', public.calculate_priority_score(24, 20, 3, 1, 0, 0, 0, 'dangerous waterlogging', 'near hospital and main road', null)
    ),
    jsonb_build_object(
      'title', 'Minor Pothole on Local Road',
      'inputs', jsonb_build_object(
        'severity_pts', 8,
        'location_pts', 3,
        'unique_reporters', 1,
        'days_open', 10,
        'context_boost_pts', 0,
        'equity_pts', 0,
        'reopen_count', 0
      ),
      'result', public.calculate_priority_score(8, 3, 1, 10, 0, 0, 0, 'minor pothole', 'local road exposure', null)
    )
  );

  return jsonb_build_object(
    'categories', v_categories,
    'constants', v_constants,
    'examples', v_examples
  );
end;
$$;

grant execute on function public.scoring_explainer to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. SCOREBOARD STATS RPC
-- ----------------------------------------------------------------------------
-- Returns municipal accountability metrics: {by_ward, by_department, overall}.
-- Preserves all wards and departments (even with 0 issues).
-- Appends unassigned rows (null ward_id/department_id) only if such issues exist.
-- Gets SLA compliance numbers directly from sla_overview().
create or replace function public.scoreboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public accountability scoreboard: Summarizes turnaround speed, resolution rate,
-- reopen frequencies, and SLA compliance across wards, departments, and citywide.
declare
  v_by_ward jsonb;
  v_by_dept jsonb;
  v_overall jsonb;
begin
  with sla_items as (
    select
      (item->>'issue_id')::uuid as issue_id,
      (item->>'state') as sla_state
    from jsonb_array_elements(public.sla_overview()) as item
  ),
  enriched_issues as (
    select
      i.id,
      i.ward_id,
      i.department_id,
      i.status,
      i.reopen_count,
      i.created_at,
      i.resolved_at,
      s.sla_state
    from public.issues i
    left join sla_items s on s.issue_id = i.id
  ),
  ward_aggregated as (
    -- All official wards (LEFT JOIN ensures wards with 0 issues appear)
    select
      w.id as ward_id,
      w.name as ward_name,
      count(i.id)::int as total_issues,
      count(i.id) filter (where i.status != 'resolved')::int as open_issues,
      count(i.id) filter (where i.status = 'resolved')::int as resolved_issues,
      case
        when count(i.id) = 0 then null
        else round((100.0 * count(i.id) filter (where i.status = 'resolved') / count(i.id))::numeric, 1)
      end as resolution_rate_pct,
      case
        when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
        else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
      end as avg_resolution_hours,
      count(i.id) filter (where i.reopen_count > 0)::int as reopened_issues,
      case
        when count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round((100.0 * count(i.id) filter (where i.reopen_count > 0) / count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric, 1)
      end as reopen_rate_pct,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'met')::int as sla_met,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'missed')::int as sla_missed,
      count(i.id) filter (where i.status != 'resolved' and i.sla_state in ('overdue', 'severely_overdue'))::int as overdue_now
    from public.wards w
    left join enriched_issues i on i.ward_id = w.id
    group by w.id, w.name

    union all

    -- Issues without an assigned ward, included only if at least one exists
    select
      null::int as ward_id,
      null::text as ward_name,
      count(i.id)::int as total_issues,
      count(i.id) filter (where i.status != 'resolved')::int as open_issues,
      count(i.id) filter (where i.status = 'resolved')::int as resolved_issues,
      case
        when count(i.id) = 0 then null
        else round((100.0 * count(i.id) filter (where i.status = 'resolved') / count(i.id))::numeric, 1)
      end as resolution_rate_pct,
      case
        when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
        else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
      end as avg_resolution_hours,
      count(i.id) filter (where i.reopen_count > 0)::int as reopened_issues,
      case
        when count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round((100.0 * count(i.id) filter (where i.reopen_count > 0) / count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric, 1)
      end as reopen_rate_pct,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'met')::int as sla_met,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'missed')::int as sla_missed,
      count(i.id) filter (where i.status != 'resolved' and i.sla_state in ('overdue', 'severely_overdue'))::int as overdue_now
    from enriched_issues i
    where i.ward_id is null
    having count(i.id) > 0
  )
  select coalesce(jsonb_agg(ward_row), '[]'::jsonb)
  into v_by_ward
  from (
    select jsonb_build_object(
      'ward_id', ward_id,
      'ward_name', ward_name,
      'total_issues', total_issues,
      'open_issues', open_issues,
      'resolved_issues', resolved_issues,
      'resolution_rate_pct', resolution_rate_pct,
      'avg_resolution_hours', avg_resolution_hours,
      'reopened_issues', reopened_issues,
      'reopen_rate_pct', reopen_rate_pct,
      'sla_met', sla_met,
      'sla_missed', sla_missed,
      'overdue_now', overdue_now
    ) as ward_row
    from ward_aggregated
    order by ward_id nulls last
  ) w_sub;

  with sla_items as (
    select
      (item->>'issue_id')::uuid as issue_id,
      (item->>'state') as sla_state
    from jsonb_array_elements(public.sla_overview()) as item
  ),
  enriched_issues as (
    select
      i.id,
      i.department_id,
      i.status,
      i.reopen_count,
      i.created_at,
      i.resolved_at,
      s.sla_state
    from public.issues i
    left join sla_items s on s.issue_id = i.id
  ),
  dept_aggregated as (
    -- All official departments (LEFT JOIN ensures departments with 0 issues appear)
    select
      d.id as department_id,
      d.name as department_name,
      count(i.id)::int as total_issues,
      count(i.id) filter (where i.status != 'resolved')::int as open_issues,
      count(i.id) filter (where i.status = 'resolved')::int as resolved_issues,
      case
        when count(i.id) = 0 then null
        else round((100.0 * count(i.id) filter (where i.status = 'resolved') / count(i.id))::numeric, 1)
      end as resolution_rate_pct,
      case
        when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
        else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
      end as avg_resolution_hours,
      count(i.id) filter (where i.reopen_count > 0)::int as reopened_issues,
      case
        when count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round((100.0 * count(i.id) filter (where i.reopen_count > 0) / count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric, 1)
      end as reopen_rate_pct,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'met')::int as sla_met,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'missed')::int as sla_missed,
      count(i.id) filter (where i.status != 'resolved' and i.sla_state in ('overdue', 'severely_overdue'))::int as overdue_now
    from public.departments d
    left join enriched_issues i on i.department_id = d.id
    group by d.id, d.name

    union all

    -- Issues without an assigned department, included only if at least one exists
    select
      null::int as department_id,
      null::text as department_name,
      count(i.id)::int as total_issues,
      count(i.id) filter (where i.status != 'resolved')::int as open_issues,
      count(i.id) filter (where i.status = 'resolved')::int as resolved_issues,
      case
        when count(i.id) = 0 then null
        else round((100.0 * count(i.id) filter (where i.status = 'resolved') / count(i.id))::numeric, 1)
      end as resolution_rate_pct,
      case
        when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
        else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
      end as avg_resolution_hours,
      count(i.id) filter (where i.reopen_count > 0)::int as reopened_issues,
      case
        when count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round((100.0 * count(i.id) filter (where i.reopen_count > 0) / count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric, 1)
      end as reopen_rate_pct,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'met')::int as sla_met,
      count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'missed')::int as sla_missed,
      count(i.id) filter (where i.status != 'resolved' and i.sla_state in ('overdue', 'severely_overdue'))::int as overdue_now
    from enriched_issues i
    where i.department_id is null
    having count(i.id) > 0
  )
  select coalesce(jsonb_agg(dept_row), '[]'::jsonb)
  into v_by_dept
  from (
    select jsonb_build_object(
      'department_id', department_id,
      'department_name', department_name,
      'total_issues', total_issues,
      'open_issues', open_issues,
      'resolved_issues', resolved_issues,
      'resolution_rate_pct', resolution_rate_pct,
      'avg_resolution_hours', avg_resolution_hours,
      'reopened_issues', reopened_issues,
      'reopen_rate_pct', reopen_rate_pct,
      'sla_met', sla_met,
      'sla_missed', sla_missed,
      'overdue_now', overdue_now
    ) as dept_row
    from dept_aggregated
    order by department_id nulls last
  ) d_sub;

  -- Overall city metrics
  with sla_items as (
    select
      (item->>'issue_id')::uuid as issue_id,
      (item->>'state') as sla_state
    from jsonb_array_elements(public.sla_overview()) as item
  ),
  enriched_issues as (
    select
      i.id,
      i.status,
      i.reopen_count,
      i.created_at,
      i.resolved_at,
      s.sla_state
    from public.issues i
    left join sla_items s on s.issue_id = i.id
  )
  select jsonb_build_object(
    'total_issues', count(i.id)::int,
    'open_issues', count(i.id) filter (where i.status != 'resolved')::int,
    'resolved_issues', count(i.id) filter (where i.status = 'resolved')::int,
    'resolution_rate_pct', case
      when count(i.id) = 0 then null
      else round((100.0 * count(i.id) filter (where i.status = 'resolved') / count(i.id))::numeric, 1)
    end,
    'avg_resolution_hours', case
      when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
      else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
    end,
    'reopened_issues', count(i.id) filter (where i.reopen_count > 0)::int,
    'reopen_rate_pct', case
      when count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
      else round((100.0 * count(i.id) filter (where i.reopen_count > 0) / count(i.id) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric, 1)
    end,
    'sla_met', count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'met')::int,
    'sla_missed', count(i.id) filter (where i.status = 'resolved' and i.sla_state = 'missed')::int,
    'overdue_now', count(i.id) filter (where i.status != 'resolved' and i.sla_state in ('overdue', 'severely_overdue'))::int
  )
  into v_overall
  from enriched_issues i;

  return jsonb_build_object(
    'by_ward', v_by_ward,
    'by_department', v_by_dept,
    'overall', coalesce(v_overall, jsonb_build_object(
      'total_issues', 0,
      'open_issues', 0,
      'resolved_issues', 0,
      'resolution_rate_pct', null,
      'avg_resolution_hours', null,
      'reopened_issues', 0,
      'reopen_rate_pct', null,
      'sla_met', 0,
      'sla_missed', 0,
      'overdue_now', 0
    ))
  );
end;
$$;

grant execute on function public.scoreboard_stats to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. EQUITY STATS RPC
-- ----------------------------------------------------------------------------
-- Returns ward and city equity indicators: {wards, city}.
-- Evaluates resolution speed and reporting density against city baselines.
create or replace function public.equity_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public equity statistics: Assesses ward-level wait times and reporting volume
-- relative to citywide benchmarks to identify potential underserved areas.
declare
  v_city_median_rep numeric;
  v_city_avg_hours numeric;
  v_wait_threshold numeric;
  v_low_rep_threshold numeric;
  v_wards jsonb;
begin
  v_city_median_rep := public.city_median_reports_per_1000();
  v_wait_threshold := public.equity_wait_flag_ratio();
  v_low_rep_threshold := public.equity_low_reporting_ratio();

  -- City-wide average resolution hours for resolved issues
  select round(avg(extract(epoch from (resolved_at - created_at)) / 3600.0) filter (where status = 'resolved' and resolved_at is not null)::numeric, 1)
  into v_city_avg_hours
  from public.issues;

  with ward_reports as (
    select
      w.id as ward_id,
      count(r.id)::int as report_count
    from public.wards w
    left join public.issues i on i.ward_id = w.id
    left join public.reports r on r.issue_id = i.id
    group by w.id
  ),
  ward_issues as (
    select
      w.id as ward_id,
      w.name as ward_name,
      w.population,
      w.is_simulated,
      count(i.id)::int as issues_total,
      case
        when count(i.id) filter (where i.status = 'resolved' and i.resolved_at is not null) = 0 then null
        else round(avg(extract(epoch from (i.resolved_at - i.created_at)) / 3600.0) filter (where i.status = 'resolved' and i.resolved_at is not null)::numeric, 1)
      end as avg_resolution_hours
    from public.wards w
    left join public.issues i on i.ward_id = w.id
    group by w.id, w.name, w.population, w.is_simulated
  )
  select coalesce(jsonb_agg(ward_row), '[]'::jsonb)
  into v_wards
  from (
    select jsonb_build_object(
      'ward_id', wi.ward_id,
      'ward_name', wi.ward_name,
      'population', wi.population,
      'is_simulated', wi.is_simulated,
      'reports', wr.report_count,
      'reports_per_1000', case
        when wi.population is null or wi.population <= 0 then null
        else round((wr.report_count::numeric * 1000.0 / wi.population::numeric), 1)
      end,
      'issues_total', wi.issues_total,
      'avg_resolution_hours', wi.avg_resolution_hours,
      'wait_ratio', case
        when wi.avg_resolution_hours is null or v_city_avg_hours is null or v_city_avg_hours = 0 then null
        else round((wi.avg_resolution_hours / v_city_avg_hours)::numeric, 2)
      end,
      'reporting_ratio', public.ward_reporting_ratio(wi.ward_id),
      'long_wait', case
        when wi.avg_resolution_hours is null or v_city_avg_hours is null or v_city_avg_hours = 0 then false
        else ((wi.avg_resolution_hours / v_city_avg_hours) >= v_wait_threshold)
      end,
      'low_reporting', case
        when public.ward_reporting_ratio(wi.ward_id) is null then false
        else (public.ward_reporting_ratio(wi.ward_id) <= v_low_rep_threshold)
      end
    ) as ward_row
    from ward_issues wi
    join ward_reports wr on wr.ward_id = wi.ward_id
    order by wi.ward_id asc
  ) sub;

  return jsonb_build_object(
    'wards', v_wards,
    'city', jsonb_build_object(
      'median_reports_per_1000', v_city_median_rep,
      'avg_resolution_hours', v_city_avg_hours
    )
  );
end;
$$;

grant execute on function public.equity_stats to anon, authenticated;
