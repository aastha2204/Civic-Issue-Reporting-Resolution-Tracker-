-- ============================================================================
-- 014_equity_score.sql
-- Civic Issue Tracker - Step 9 Part B: Fairness & Equity Scoring Adjustment
-- ============================================================================
-- Introduces municipal equity boost constants and calculation logic.
-- The ONLY existing function modified is recompute_issue_score, which now passes
-- live equity points instead of 0 to calculate_priority_score.
-- calculate_priority_score remains completely untouched.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 1. EQUITY CONSTANTS
-- ----------------------------------------------------------------------------

-- The maximum priority points that can be awarded for civic equity and fairness.
-- Caps the fairness adjustment so it cannot overpower basic hazard severity.
create or replace function public.equity_max_points()
returns int
language sql
immutable
set search_path = public, extensions
as $$
  -- The most points the fairness adjustment can add (+10)
  select 10;
$$;

grant execute on function public.equity_max_points to anon, authenticated;

-- Minimum total reports across the city before fairness adjustments activate.
-- Protects against random score distortions when testing with a tiny initial dataset.
create or replace function public.equity_min_reports()
returns int
language sql
immutable
set search_path = public, extensions
as $$
  -- The city must have at least this many reports before fairness applies (10)
  select 10;
$$;

grant execute on function public.equity_min_reports to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. EQUITY POINTS CALCULATION FUNCTION
-- ----------------------------------------------------------------------------
-- Returns fairness boost (0 to 10 points) for an issue in an under-reporting ward.
-- Declared SECURITY DEFINER because the reports table is protected by RLS.
create or replace function public.equity_points(
  p_ward_id int,
  p_location_points int
)
returns int
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Calculates the fairness adjustment points for an issue based on ward reporting ratio
-- and location exposure risk.
--
-- Safety gates:
-- 1. Returns 0 if p_ward_id is null.
-- 2. Returns 0 if fewer than 3 wards have a population greater than 0.
-- 3. Returns 0 if total citywide reports < equity_min_reports() (10).
-- 4. Returns 0 if ward_reporting_ratio(p_ward_id) is null.
--
-- Formula:
-- under_reporting = clamp((1 - ratio) / (1 - equity_low_reporting_ratio()), 0, 1)
-- risk = least(1.0, p_location_points / 25.0)
-- boost = round(equity_max_points() * under_reporting * risk)
declare
  v_qualifying_wards int;
  v_total_reports bigint;
  v_ratio numeric;
  v_low_rep_ratio numeric;
  v_under_reporting numeric;
  v_risk numeric;
begin
  -- 1. Gate: ward must be specified
  if p_ward_id is null then
    return 0;
  end if;

  -- 2. Gate: at least 3 wards must have recorded population > 0
  select count(*)::int into v_qualifying_wards
  from public.wards
  where population > 0;

  if coalesce(v_qualifying_wards, 0) < 3 then
    return 0;
  end if;

  -- 3. Gate: total citywide reports threshold
  select count(*)::bigint into v_total_reports
  from public.reports;

  if coalesce(v_total_reports, 0) < public.equity_min_reports() then
    return 0;
  end if;

  -- 4. Gate: ward reporting ratio against city median
  v_ratio := public.ward_reporting_ratio(p_ward_id);
  if v_ratio is null then
    return 0;
  end if;

  v_low_rep_ratio := public.equity_low_reporting_ratio(); -- 0.5

  -- 5. Under-reporting factor: clamp((1 - ratio) / (1 - equity_low_reporting_ratio()), 0, 1)
  -- A ward at or above the city median (ratio >= 1.0) gets 0.
  -- A ward at or below half the median (ratio <= 0.5) gets 1.0.
  if (1.0 - v_low_rep_ratio) = 0 then
    v_under_reporting := 0;
  else
    v_under_reporting := least(1.0, greatest(0.0, (1.0 - v_ratio) / (1.0 - v_low_rep_ratio)));
  end if;

  -- 6. Location exposure risk factor: least(1, p_location_points / 25.0)
  v_risk := least(1.0, greatest(0.0, coalesce(p_location_points, 0)::numeric / 25.0));

  -- 7. Return rounded fairness points (up to equity_max_points = 10)
  return round(public.equity_max_points()::numeric * v_under_reporting * v_risk)::int;
end;
$$;

grant execute on function public.equity_points to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. UPDATE RECOMPUTE_ISSUE_SCORE (Passing Live Equity Points)
-- ----------------------------------------------------------------------------
-- The ONLY existing function modified. Replaces the literal 0 equity_pts argument
-- with public.equity_points(v_issue.ward_id, v_location_pts).
-- Every other line is identical to 002_scoring.sql.
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

  -- 7. Call pure scoring engine (passing live equity_points)
  v_result := public.calculate_priority_score(
    v_severity_pts,
    v_location_pts,
    v_unique_reporters,
    v_days_open,
    v_context_pts,
    public.equity_points(v_issue.ward_id, v_location_pts),
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
-- 4. UPDATE SCORING_EXPLAINER (Adding Constants & Example 5)
-- ----------------------------------------------------------------------------
create or replace function public.scoring_explainer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public scoring explainer with equity constants and fifth worked example.
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

  -- 2. Constants read directly from existing helper functions (including Part B equity constants)
  v_constants := jsonb_build_object(
    'merge_radius_m', public.merge_radius_meters(),
    'photo_match_radius_m', public.photo_match_radius_meters(),
    'resolution_radius_m', public.resolution_radius_meters(),
    'heavy_rain_mm', public.heavy_rain_mm(),
    'reopen_threshold', public.reopen_threshold(),
    'sla_level1_factor', public.sla_level1_factor(),
    'sla_level2_factor', public.sla_level2_factor(),
    'sla_due_soon_fraction', public.sla_due_soon_fraction(),
    'equity_low_reporting_ratio', public.equity_low_reporting_ratio(),
    'equity_max_points', public.equity_max_points(),
    'equity_min_reports', public.equity_min_reports()
  );

  -- 3. Five canonical worked examples from docs/SPEC.md evaluated via calculate_priority_score
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
    ),
    -- Example 5: Same pothole as Case 1 in a low-reporting ward (+8 equity points)
    jsonb_build_object(
      'title', 'Same pothole in a low-reporting ward',
      'inputs', jsonb_build_object(
        'severity_pts', 26,
        'location_pts', 22,
        'unique_reporters', 6,
        'days_open', 7,
        'context_boost_pts', 0,
        'equity_pts', 8,
        'reopen_count', 0
      ),
      'result', public.calculate_priority_score(26, 22, 6, 7, 0, 8, 0, 'dangerous pothole', 'near school and main road', null)
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
-- 5. UPDATE EQUITY_STATS (Adding max_equity_boost per ward)
-- ----------------------------------------------------------------------------
create or replace function public.equity_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Public equity statistics with max_equity_boost per ward.
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
  ),
  ward_combined as (
    select
      wi.ward_id,
      wi.ward_name,
      wi.population,
      wi.is_simulated,
      wr.report_count as reports,
      case
        when wi.population is null or wi.population <= 0 then null
        else round((wr.report_count::numeric * 1000.0 / wi.population::numeric), 1)
      end as reports_per_1000,
      wi.issues_total,
      wi.avg_resolution_hours,
      case
        when wi.avg_resolution_hours is null or v_city_avg_hours is null or v_city_avg_hours = 0 then null
        else round((wi.avg_resolution_hours / v_city_avg_hours)::numeric, 2)
      end as wait_ratio,
      public.ward_reporting_ratio(wi.ward_id) as reporting_ratio
    from ward_issues wi
    join ward_reports wr on wr.ward_id = wi.ward_id
  )
  select coalesce(jsonb_agg(ward_row), '[]'::jsonb)
  into v_wards
  from (
    select jsonb_build_object(
      'ward_id', c.ward_id,
      'ward_name', c.ward_name,
      'population', c.population,
      'is_simulated', c.is_simulated,
      'reports', c.reports,
      'reports_per_1000', c.reports_per_1000,
      'issues_total', c.issues_total,
      'avg_resolution_hours', c.avg_resolution_hours,
      'wait_ratio', c.wait_ratio,
      'reporting_ratio', c.reporting_ratio,
      'long_wait', case
        when c.wait_ratio is null then false
        else (c.wait_ratio >= v_wait_threshold)
      end,
      'low_reporting', case
        when c.reporting_ratio is null then false
        else (c.reporting_ratio <= v_low_rep_threshold)
      end,
      'max_equity_boost', case
        when c.reporting_ratio is null or (1.0 - v_low_rep_threshold) = 0 then 0
        else round(public.equity_max_points()::numeric * least(1.0, greatest(0.0, (1.0 - c.reporting_ratio) / (1.0 - v_low_rep_threshold))))::int
      end
    ) as ward_row
    from ward_combined c
    order by c.ward_id asc
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
-- 6. MANUAL RECOMPUTATION INSTRUCTION
-- ----------------------------------------------------------------------------
-- After running this migration, run the following statement in Supabase SQL Editor:
-- select public.recompute_all_open_issues();
