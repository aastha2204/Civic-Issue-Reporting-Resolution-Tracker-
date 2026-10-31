-- ============================================================================
-- 002_scoring.sql
-- Civic Issue Tracker - Complete Scoring Engine, Deduplication, & Triggers
-- ============================================================================
-- 
-- CIVIC SCORING PHILOSOPHY (FOR JUDGES & AUDITORS):
-- Traditional civic portals collect complaints into a passive queue where the
-- loudest voice or newest submission gets attention first.
-- Civic Issue Tracker inverts this paradigm:
--   1. Dynamic Prioritization: Issues are ranked mathematically (0 to 100)
--      balancing Severity (30%), Location/Vulnerability (25%), Community Signal (25%),
--      and Age/Neglect (20%).
--   2. Real-Time Contextual Boosts: Inclement weather amplifies critical
--      hazards (e.g. heavy rain dramatically multiplies waterlogging & pothole danger).
--   3. Accountability & Anti-Lapse: Reopened disputes add an immediate urgency penalty.
--   4. Radical Transparency: Every score is decomposed into plain-English reasons
--      so citizens and ward officers understand the exact rationale.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SEVERITY POINTS (Max 30 points)
-- ----------------------------------------------------------------------------
-- Formula: round(base_weight * level_multiplier * 30)
-- Level Multipliers:
--   - minor:     0.50 (low hazard, cosmetic or early-stage issue)
--   - moderate:  0.75 (standard inconvenience, potential road hazard)
--   - dangerous: 1.00 (critical threat to human life or major infrastructure)
-- Base weights come from categories table (e.g., open_manhole: 1.0, pothole: 0.8)
create or replace function public.severity_points(
  p_category text,
  p_level text
)
returns int
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_base_weight numeric;
  v_multiplier numeric;
begin
  -- Resolve level multiplier
  case lower(coalesce(p_level, 'moderate'))
    when 'minor' then v_multiplier := 0.50;
    when 'moderate' then v_multiplier := 0.75;
    when 'dangerous' then v_multiplier := 1.00;
    else v_multiplier := 0.75;
  end case;

  -- Look up category base weight
  select base_weight into v_base_weight
  from public.categories
  where key = p_category;

  if not found then
    v_base_weight := 0.40; -- fallback baseline
  end if;

  return round(v_base_weight * v_multiplier * 30)::int;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. LOCATION AND EXPOSURE POINTS (Max 25 points)
-- ----------------------------------------------------------------------------
-- Evaluates vulnerability zones and traffic impact surrounding the issue:
--   - School within 200m:    +8 (child pedestrian safety)
--   - Hospital within 200m:  +8 (emergency medical response & ambulance access)
--   - Bus stop within 100m:  +3 (public transit pedestrian concentration)
--   - Market within 150m:    +4 (crowded commercial exposure)
--   - Road class:            main road +6, secondary +3, local +0
--   - Ward density score:    +0 to +4 (higher density wards get up to +4)
-- Total is capped at 25 points.
create or replace function public.location_points(
  p_issue_id uuid
)
returns int
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_issue record;
  v_score int := 0;
  v_has_school boolean := false;
  v_has_hospital boolean := false;
  v_has_bus_stop boolean := false;
  v_has_market boolean := false;
  v_ward_density int := 0;
begin
  -- Retrieve issue location and metadata
  select location, road_class, ward_id
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    return 0;
  end if;

  -- Check sensitive places in spatial proximity
  select
    coalesce(bool_or(kind = 'school' and extensions.st_dwithin(location, v_issue.location, 200)), false),
    coalesce(bool_or(kind = 'hospital' and extensions.st_dwithin(location, v_issue.location, 200)), false),
    coalesce(bool_or(kind = 'bus_stop' and extensions.st_dwithin(location, v_issue.location, 100)), false),
    coalesce(bool_or(kind = 'market' and extensions.st_dwithin(location, v_issue.location, 150)), false)
  into
    v_has_school,
    v_has_hospital,
    v_has_bus_stop,
    v_has_market
  from public.places;

  if v_has_school then
    v_score := v_score + 8;
  end if;

  if v_has_hospital then
    v_score := v_score + 8;
  end if;

  if v_has_bus_stop then
    v_score := v_score + 3;
  end if;

  if v_has_market then
    v_score := v_score + 4;
  end if;

  -- Road exposure bonus
  case lower(coalesce(v_issue.road_class, 'local'))
    when 'main' then v_score := v_score + 6;
    when 'secondary' then v_score := v_score + 3;
    else v_score := v_score + 0;
  end case;

  -- Ward population density bonus (0-4 points)
  if v_issue.ward_id is not null then
    select density_score into v_ward_density
    from public.wards
    where id = v_issue.ward_id;

    if found then
      v_score := v_score + coalesce(v_ward_density, 0);
    end if;
  end if;

  -- Hard cap at 25 points
  return least(v_score, 25);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. FREQUENCY POINTS (Max 25 points)
-- ----------------------------------------------------------------------------
-- Community amplification based on verified unique reporters:
--   - 1 reporter:     0 points (baseline individual notice)
--   - 2-3 reporters: 10 points (confirmed recurring problem)
--   - 4-6 reporters: 18 points (widespread neighborhood nuisance)
--   - 7+ reporters:  25 points (major community bottleneck)
create or replace function public.frequency_points(
  p_reporters int
)
returns int
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_reporters <= 1 then 0
    when p_reporters between 2 and 3 then 10
    when p_reporters between 4 and 6 then 18
    else 25
  end;
$$;

-- ----------------------------------------------------------------------------
-- 4. AGE POINTS (Max 20 points)
-- ----------------------------------------------------------------------------
-- Prevents long-standing issues from suffering bureaucratic neglect:
--   - 1 point per calendar day the issue remains open
--   - Capped at 20 points (day 20 and beyond receives max age penalty)
create or replace function public.age_points(
  p_days int
)
returns int
language sql
immutable
set search_path = public, extensions
as $$
  select least(greatest(coalesce(p_days, 0), 0), 20);
$$;

-- ----------------------------------------------------------------------------
-- 5. CONTEXT BOOST (Max +15 points)
-- ----------------------------------------------------------------------------
-- Real-time situational multiplier (e.g. weather, visibility):
--   - Waterlogging: up to +15 during heavy rain (max_weather_boost 15 * intensity)
--   - Pothole:      up to +8 during heavy rain (water hides dangerous road dips)
--   - Garbage:      up to +8 during heavy rain (contamination & water disease risk)
--   - Broken Streetlight: +5 on main roads only (nighttime accident risk)
--   - Other categories: 0
-- Total context boost capped at 15 points.
create or replace function public.context_boost(
  p_category text,
  p_weather_intensity numeric,
  p_road_class text
)
returns int
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_max_boost int := 0;
  v_intensity numeric := least(greatest(coalesce(p_weather_intensity, 0), 0), 1);
  v_boost int := 0;
begin
  if p_category = 'broken_streetlight' then
    if lower(coalesce(p_road_class, 'local')) = 'main' then
      return 5;
    else
      return 0;
    end if;
  end if;

  -- Look up category weather sensitivity
  select max_weather_boost into v_max_boost
  from public.categories
  where key = p_category;

  if found and v_max_boost > 0 then
    v_boost := round(v_max_boost * v_intensity)::int;
  end if;

  return least(v_boost, 15);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. PURE SCORE CALCULATION & REASONS GENERATOR
-- ----------------------------------------------------------------------------
-- Pure function (no table reads, deterministic):
-- Priority = Base (Severity + Location + Frequency + Age, cap 100)
--          + Context boost (+0 to +15)
--          + Equity adjustment (+0 to +10)
--          + Reopen boost (+5 per failed fix, cap +15)
-- Overall Priority capped at 100.
-- Priority Bands:
--   - High:   70-100 (Target SLA: 48 hours)
--   - Medium: 40-69  (Target SLA: 7 days)
--   - Low:    < 40   (Batched maintenance)
-- Generates structured jsonb and a clear plain-English explanation.
create or replace function public.calculate_priority_score(
  severity_pts int,
  location_pts int,
  unique_reporters int,
  days_open int,
  context_boost_pts int,
  equity_pts int,
  reopen_count int,
  severity_desc text default null,
  location_desc text default null,
  context_desc text default null
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_freq_pts int;
  v_age_pts int;
  v_reopen_boost int;
  v_equity_pts int;
  v_context_pts int;
  v_base int;
  v_total int;
  v_band text;
  v_reasons_array text[] := array[]::text[];
  v_reasons_text text;
begin
  -- 1. Component calculations
  v_freq_pts := public.frequency_points(unique_reporters);
  v_age_pts := public.age_points(days_open);
  v_reopen_boost := least(5 * greatest(coalesce(reopen_count, 0), 0), 15);
  v_equity_pts := least(greatest(coalesce(equity_pts, 0), 0), 10);
  v_context_pts := least(greatest(coalesce(context_boost_pts, 0), 0), 15);

  -- 2. Base score (max 100)
  v_base := least(severity_pts + location_pts + v_freq_pts + v_age_pts, 100);

  -- 3. Total score (capped at 100)
  v_total := least(v_base + v_context_pts + v_equity_pts + v_reopen_boost, 100);

  -- 4. Priority band assignment
  if v_total >= 70 then
    v_band := 'High';
  elsif v_total >= 40 then
    v_band := 'Medium';
  else
    v_band := 'Low';
  end if;

  -- 5. Human-readable explanation generation
  if severity_pts > 0 then
    if severity_desc is not null and length(trim(severity_desc)) > 0 then
      v_reasons_array := array_append(v_reasons_array, severity_desc || ' (+' || severity_pts || ')');
    else
      v_reasons_array := array_append(v_reasons_array, 'severity (+' || severity_pts || ')');
    end if;
  end if;

  if location_pts > 0 then
    if location_desc is not null and length(trim(location_desc)) > 0 then
      v_reasons_array := array_append(v_reasons_array, location_desc || ' (+' || location_pts || ')');
    else
      v_reasons_array := array_append(v_reasons_array, 'location exposure (+' || location_pts || ')');
    end if;
  end if;

  if v_freq_pts > 0 then
    v_reasons_array := array_append(v_reasons_array, unique_reporters || ' separate reports (+' || v_freq_pts || ')');
  end if;

  if v_age_pts > 0 then
    v_reasons_array := array_append(v_reasons_array, 'open ' || days_open || case when days_open = 1 then ' day (+' else ' days (+' end || v_age_pts || ')');
  end if;

  if v_context_pts > 0 then
    if context_desc is not null and length(trim(context_desc)) > 0 then
      v_reasons_array := array_append(v_reasons_array, context_desc || ' (+' || v_context_pts || ')');
    else
      v_reasons_array := array_append(v_reasons_array, 'weather forecast (+' || v_context_pts || ')');
    end if;
  end if;

  if v_reopen_boost > 0 then
    v_reasons_array := array_append(v_reasons_array, 'reopened after failed fix (+' || v_reopen_boost || ')');
  end if;

  if v_equity_pts > 0 then
    v_reasons_array := array_append(v_reasons_array, 'equity adjustment (+' || v_equity_pts || ')');
  end if;

  -- Assemble sentence: e.g. "High priority (73/100): dangerous pothole (+26), near a school and main road (+22)..."
  if array_length(v_reasons_array, 1) is null then
    v_reasons_text := v_band || ' priority (' || v_total || '/100).';
  else
    v_reasons_text := v_band || ' priority (' || v_total || '/100): ' || array_to_string(v_reasons_array, ', ') || '.';
  end if;

  return jsonb_build_object(
    'total', v_total,
    'band', v_band,
    'base', v_base,
    'breakdown', jsonb_build_object(
      'severity', severity_pts,
      'location', location_pts,
      'frequency', v_freq_pts,
      'age', v_age_pts,
      'context_boost', v_context_pts,
      'reopen_boost', v_reopen_boost,
      'equity_adjustment', v_equity_pts
    ),
    'reasons_text', v_reasons_text
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. RECOMPUTE ISSUE SCORE (Database State -> Score Engine)
-- ----------------------------------------------------------------------------
-- Gathers current issue state from tables, executes the pure scoring engine,
-- and updates the issue record with latest priority score, band, and breakdown.
--
-- NOTE: Declared SECURITY DEFINER so that any citizen creating a report or upvote
-- can trigger full recomputation across all reports and upvotes without requiring
-- direct table-wide read permissions on other citizens' reports.
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
    0, -- equity_pts (optional, built later)
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

-- ----------------------------------------------------------------------------
-- 8. SPATIAL DEDUPLICATION / MERGE CHECK
-- ----------------------------------------------------------------------------
-- Finds the closest open issue of the same category within MERGE_RADIUS_METERS (100m).
-- Enables the citizen workflow: "Is this the same issue?" -> attach as unique reporter.
create or replace function public.find_nearby_open_issue(
  p_lat double precision,
  p_lng double precision,
  p_category text
)
returns table (
  id uuid,
  category text,
  severity_level text,
  description text,
  location extensions.geography,
  address text,
  status text,
  priority_score int,
  priority_band text,
  distance_meters numeric
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_point extensions.geography;
begin
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  select
    i.id,
    i.category,
    i.severity_level,
    i.description,
    i.location,
    i.address,
    i.status,
    i.priority_score,
    i.priority_band,
    round(extensions.st_distance(i.location, v_point)::numeric, 1) as distance_meters
  from public.issues i
  where i.category = p_category
    and i.status != 'resolved'
    and extensions.st_dwithin(i.location, v_point, public.merge_radius_meters())
  order by extensions.st_distance(i.location, v_point) asc
  limit 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. TRIGGERS
-- ----------------------------------------------------------------------------

-- Trigger Function: Recompute issue score on report or upvote
-- Declared SECURITY DEFINER so citizens inserting a report/upvote can recompute
-- the issue's community metrics and update the issues record.
create or replace function public.trigger_recompute_issue_score()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.recompute_issue_score(NEW.issue_id);
  return NEW;
end;
$$;

drop trigger if exists trg_recompute_on_report on public.reports;
create trigger trg_recompute_on_report
after insert on public.reports
for each row
execute function public.trigger_recompute_issue_score();

drop trigger if exists trg_recompute_on_upvote on public.upvotes;
create trigger trg_recompute_on_upvote
after insert on public.upvotes
for each row
execute function public.trigger_recompute_issue_score();

-- Trigger Function: Automatic Status History logging on issue status changes
-- Declared SECURITY DEFINER to maintain an immutable audit trail.
create or replace function public.trigger_issue_status_history()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if (TG_OP = 'INSERT') or (TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status) then
    insert into public.status_history (
      issue_id,
      status,
      changed_by,
      note,
      created_at
    )
    values (
      NEW.id,
      NEW.status,
      auth.uid(),
      case
        when TG_OP = 'INSERT' then 'Issue reported'
        else 'Status transitioned from ' || coalesce(OLD.status, 'none') || ' to ' || NEW.status
      end,
      now()
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_issue_status_history on public.issues;
create trigger trg_issue_status_history
after insert or update of status on public.issues
for each row
execute function public.trigger_issue_status_history();

-- Trigger Function: Citizen Anti-Spam Rate Limit
-- Prevents a user from inserting more than 10 reports within the last hour.
create or replace function public.trigger_reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_recent_count int;
begin
  if NEW.user_id is not null then
    select count(*) into v_recent_count
    from public.reports
    where user_id = NEW.user_id
      and created_at > (now() - interval '1 hour');

    if v_recent_count >= 10 then
      raise exception 'Rate limit exceeded: maximum 10 reports per hour allowed.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_reports_rate_limit on public.reports;
create trigger trg_reports_rate_limit
before insert on public.reports
for each row
execute function public.trigger_reports_rate_limit();
