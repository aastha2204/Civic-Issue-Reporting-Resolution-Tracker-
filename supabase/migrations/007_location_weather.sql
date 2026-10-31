-- ============================================================================
-- 007_location_weather.sql
-- Civic Issue Tracker - Road Network, Proximity Trigger, & Weather Scoring
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SOURCE MARKER & ROADS TABLE (From OpenStreetMap)
-- ----------------------------------------------------------------------------
-- Add source marker column to existing places table so OSM seed data can be
-- cleanly identified and safely replaced without wiping manually added places.
alter table public.places add column if not exists source text;

-- Roads table storing OpenStreetMap line strings classified into hierarchy
create table if not exists public.roads (
  id bigserial primary key,
  osm_id bigint,
  name text,
  highway text,
  road_class text not null check (road_class in ('main', 'secondary', 'local')),
  geom extensions.geography(LineString, 4326) not null,
  source text
);

-- Spatial index on road geometries for fast ST_DWithin lookups
create index if not exists idx_roads_geom on public.roads using gist (geom);

-- Row Level Security
alter table public.roads enable row level security;

drop policy if exists "Allow public read on roads" on public.roads;
create policy "Allow public read on roads"
  on public.roads
  for select
  to anon, authenticated
  using (true);

-- Attribution comment adhering to OpenStreetMap license requirements
comment on table public.roads is 'data from OpenStreetMap contributors (ODbL)';


-- ----------------------------------------------------------------------------
-- 2. ROAD CLASS AT LOCATION FUNCTION
-- ----------------------------------------------------------------------------
-- Determines road classification of the nearest road within 25 meters.
-- Returns 'local' if no classified road lies within the 25m buffer.
create or replace function public.road_class_at(
  p_lat double precision,
  p_lng double precision
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_point extensions.geography;
  v_class text;
begin
  if p_lat is null or p_lng is null then
    return 'local';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  select road_class
  into v_class
  from public.roads
  where extensions.st_dwithin(geom, v_point, 25)
  order by extensions.st_distance(geom, v_point) asc
  limit 1;

  return coalesce(v_class, 'local');
end;
$$;

grant execute on function public.road_class_at(double precision, double precision) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. BEFORE INSERT TRIGGER ON ISSUES (Automatic Road Classification)
-- ----------------------------------------------------------------------------
-- Evaluates road_class upon issue submission from coordinates without modifying submit_report.
create or replace function public.trigger_set_issue_road_class()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if NEW.location is not null then
    NEW.road_class := public.road_class_at(
      extensions.st_y(NEW.location::extensions.geometry),
      extensions.st_x(NEW.location::extensions.geometry)
    );
  else
    NEW.road_class := 'local';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_issue_set_road_class on public.issues;
create trigger trg_issue_set_road_class
  before insert on public.issues
  for each row
  execute function public.trigger_set_issue_road_class();


-- ----------------------------------------------------------------------------
-- 4. WEATHER CONSTANTS & INTENSITY NORMALIZATION (For Judges & Auditors)
-- ----------------------------------------------------------------------------
-- In meteorology, 64.5 - 65 mm of precipitation over 24 hours marks the official
-- threshold for a "Heavy Rain" event. This single constant governs how severe
-- a storm must be before civic hazard boosts reach their absolute peak (1.0).
create or replace function public.heavy_rain_mm()
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  select 65.0;
$$;

grant execute on function public.heavy_rain_mm() to anon, authenticated;

-- Converts measured precipitation millimeters into a normalized 0.00 to 1.00 intensity.
-- A dry day (0 mm) yields 0.00. 32.5 mm yields 0.50. 65 mm or more caps at 1.00.
-- This intensity multiplies the category weather boost in context_boost().
create or replace function public.rain_intensity_from_mm(
  mm numeric
)
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  select round(least(1.0, greatest(0.0, coalesce(mm, 0.0)) / public.heavy_rain_mm()), 2);
$$;

grant execute on function public.rain_intensity_from_mm(numeric) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. SET WARD WEATHER (Admin Service Role Only)
-- ----------------------------------------------------------------------------
-- Takes past 24h and next 24h rainfall in millimeters, derives intensity from the
-- highest threat window (past accumulation or incoming forecast), and upserts weather_cache.
create or replace function public.set_ward_weather(
  p_ward_id int,
  p_past_24h_mm numeric,
  p_next_24h_mm numeric
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_max_mm numeric;
  v_intensity numeric;
begin
  v_max_mm := greatest(coalesce(p_past_24h_mm, 0.0), coalesce(p_next_24h_mm, 0.0));
  v_intensity := public.rain_intensity_from_mm(v_max_mm);

  insert into public.weather_cache (ward_id, rain_intensity, fetched_at)
  values (p_ward_id, v_intensity, now())
  on conflict (ward_id) do update set
    rain_intensity = excluded.rain_intensity,
    fetched_at = excluded.fetched_at;
end;
$$;

revoke execute on function public.set_ward_weather(int, numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_ward_weather(int, numeric, numeric) to service_role;


-- ----------------------------------------------------------------------------
-- 6. RECOMPUTE ALL OPEN ISSUES (Admin Service Role Only)
-- ----------------------------------------------------------------------------
-- Iterates over every open issue (status != 'resolved'), recalculates its priority score
-- across updated weather, aging days, and community reports, and returns count of updated rows.
create or replace function public.recompute_all_open_issues()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue record;
  v_count integer := 0;
begin
  for v_issue in
    select id from public.issues where status != 'resolved'
  loop
    perform public.recompute_issue_score(v_issue.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.recompute_all_open_issues() from public, anon, authenticated;
grant execute on function public.recompute_all_open_issues() to service_role;


-- ----------------------------------------------------------------------------
-- 7. SET SIMULATE RAIN (Authenticated Officer / Admin Only)
-- ----------------------------------------------------------------------------
-- Demo control allowing judges and authorized officials to simulate heavy rain.
-- Forces weather_intensity to 1.0 in recompute_issue_score and recalculates all open issues.
create or replace function public.set_simulate_rain(
  p_on boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  -- Validate caller has officer or admin role
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role is null or v_role not in ('officer', 'admin') then
    raise exception 'Access denied: caller must have officer or admin role.';
  end if;

  -- Update global setting
  insert into public.app_settings (key, value)
  values ('simulate_heavy_rain', case when p_on then 'true' else 'false' end)
  on conflict (key) do update set
    value = excluded.value;

  -- Trigger recalculation across all open tickets
  perform public.recompute_all_open_issues();
end;
$$;

grant execute on function public.set_simulate_rain(boolean) to authenticated;
