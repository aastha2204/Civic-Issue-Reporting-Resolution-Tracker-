-- ============================================================================
-- 014_rollback.sql
-- Civic Issue Tracker - Rollback Script for Step 9 Part B (Equity Score)
-- ============================================================================
-- HOW TO USE THIS SCRIPT:
-- If you need to revert Migration 014 (Fairness/Equity scoring changes), run this
-- entire script in your Supabase SQL Editor.
--
-- EXECUTION ORDER:
-- 1. Restores public.recompute_issue_score to its exact definition from 002_scoring.sql
--    (passing 0 for equity_pts).
-- 2. Restores public.scoring_explainer and public.equity_stats to their exact 013 definitions.
-- 3. Drops the Part B equity functions: equity_points, equity_min_reports, equity_max_points.
-- 4. Does NOT drop any Part A / 013 helpers.
-- 5. Afterwards, run: select public.recompute_all_open_issues(); to recalculate live scores.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 1. RESTORE RECOMPUTE_ISSUE_SCORE (Exact 002_scoring.sql definition)
-- ----------------------------------------------------------------------------
create or replace function public.recompute_issue_score(
  p_issue_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue record;
  v_unique_reporters int := 1;
  v_days_open int := 0;
  v_weather_intensity numeric := 0.0;
  v_simulate_rain text := 'false';
  v_severity_pts int := 0;
  v_location_pts int := 0;
  v_context_pts int := 0;
  v_result jsonb;
  v_severity_desc text;
  v_location_desc text;
  v_context_desc text;
  v_loc_parts text[] := array[]::text[];
begin
  -- 1. Fetch issue record
  select * into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    return;
  end if;

  -- 2. Unique reporters = distinct users across reports and upvotes
  select count(distinct uid) into v_unique_reporters
  from (
    select user_id as uid from public.reports where issue_id = p_issue_id and user_id is not null
    union
    select user_id as uid from public.upvotes where issue_id = p_issue_id and user_id is not null
  ) combined_reporters;

  v_unique_reporters := greatest(coalesce(v_unique_reporters, 0), 1);

  -- 3. Age in calendar days
  v_days_open := greatest(0, floor(extract(epoch from (now() - v_issue.created_at)) / 86400)::int);

  -- 4. Weather intensity check (respecting simulate_heavy_rain demo toggle)
  select value into v_simulate_rain
  from public.app_settings
  where key = 'simulate_heavy_rain';

  if coalesce(v_simulate_rain, 'false') = 'true' then
    v_weather_intensity := 1.0;
  elsif v_issue.ward_id is not null then
    select rain_intensity into v_weather_intensity
    from public.weather_cache
    where ward_id = v_issue.ward_id;

    v_weather_intensity := coalesce(v_weather_intensity, 0.0);
  else
    v_weather_intensity := 0.0;
  end if;

  -- 5. Sub-score component evaluations
  v_severity_pts := public.severity_points(v_issue.category, v_issue.severity_level);
  v_location_pts := public.location_points(p_issue_id);
  v_context_pts := public.context_boost(v_issue.category, v_weather_intensity, v_issue.road_class);

  -- 6. Build contextual descriptions for reasons_text
  v_severity_desc := v_issue.severity_level || ' ' || replace(v_issue.category, '_', ' ');

  -- Location exposure breakdown description
  if exists (select 1 from public.places where kind = 'school' and extensions.st_dwithin(location, v_issue.location, 200)) then
    v_loc_parts := array_append(v_loc_parts, 'school');
  end if;
  if exists (select 1 from public.places where kind = 'hospital' and extensions.st_dwithin(location, v_issue.location, 200)) then
    v_loc_parts := array_append(v_loc_parts, 'hospital');
  end if;
  if exists (select 1 from public.places where kind = 'market' and extensions.st_dwithin(location, v_issue.location, 150)) then
    v_loc_parts := array_append(v_loc_parts, 'market');
  end if;
  if exists (select 1 from public.places where kind = 'bus_stop' and extensions.st_dwithin(location, v_issue.location, 100)) then
    v_loc_parts := array_append(v_loc_parts, 'bus stop');
  end if;
  if v_issue.road_class = 'main' then
    v_loc_parts := array_append(v_loc_parts, 'main road');
  elsif v_issue.road_class = 'secondary' then
    v_loc_parts := array_append(v_loc_parts, 'secondary road');
  end if;

  if array_length(v_loc_parts, 1) is not null then
    v_location_desc := 'near ' || array_to_string(v_loc_parts, ' and ');
  else
    v_location_desc := 'location and exposure';
  end if;

  -- Context boost description
  if v_context_pts > 0 then
    if v_issue.category = 'broken_streetlight' and v_issue.road_class = 'main' then
      v_context_desc := 'main road night visibility risk';
    elsif v_weather_intensity >= 0.75 then
      v_context_desc := 'heavy rain forecast';
    else
      v_context_desc := 'rain forecast';
    end if;
  else
    v_context_desc := null;
  end if;

  -- 7. Call pure scoring engine
  v_result := public.calculate_priority_score(
    v_severity_pts,
    v_location_pts,
    v_unique_reporters,
    v_days_open,
    v_context_pts,
    0, -- equity_pts (restored to 0)
    v_issue.reopen_count,
    v_severity_desc,
    v_location_desc,
    v_context_desc
  );

  -- 8. Write updated scores back to issues table
  update public.issues
  set
    priority_score = (v_result->>'total')::int,
    priority_band = v_result->>'band',
    score_breakdown = v_result->'breakdown',
    reasons_text = v_result->>'reasons_text',
    unique_reporters = v_unique_reporters,
    updated_at = now()
  where id = p_issue_id;
end;
$$;

grant execute on function public.recompute_issue_score to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. RESTORE SCORING_EXPLAINER & EQUITY_STATS (Exact 013 definitions)
-- ----------------------------------------------------------------------------
create or replace function public.scoring_explainer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_categories jsonb;
  v_constants jsonb;
  v_examples jsonb;
begin
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

create or replace function public.equity_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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

-- ----------------------------------------------------------------------------
-- 3. DROP PART B EQUITY FUNCTIONS (Only after recompute_issue_score restored)
-- ----------------------------------------------------------------------------
drop function if exists public.equity_points(int, int);
drop function if exists public.equity_min_reports();
drop function if exists public.equity_max_points();

-- ----------------------------------------------------------------------------
-- 4. AFTER ROLLBACK: RECALCULATE OPEN ISSUES
-- ----------------------------------------------------------------------------
-- Execute the following statement manually after running this rollback script:
-- select public.recompute_all_open_issues();
