-- ============================================================================
-- 005_submit_report.sql
-- Civic Issue Tracker - Public Submission RPC & Single-Issue Read Functions
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- The function submit_report is explicitly declared SECURITY DEFINER with
-- search_path set to public, extensions.
-- Why this is required:
--   1. When an authenticated citizen submits a report, the operation must
--      determine the nearest ward from public.wards and appropriate municipal
--      department from public.departments.
--   2. If creating a new issue, it inserts into public.issues, which requires
--      elevated coordinate validation and initial state provisioning.
--   3. When attaching to an existing issue, it must verify the issue's open
--      status and category without requiring broad table-wide privileges.
--   4. The insert into public.reports activates trg_recompute_on_report which
--      recalculates priority_score across all reporters and updates public.issues.
--   5. Executing submit_report under SECURITY DEFINER guarantees that the
--      entire submission, nearest-ward assignment, and score recomputation
--      execute as an atomic, trusted transaction without granting individual
--      citizens direct update privileges on public.issues or read access to
--      other citizens' private records.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PHOTO MATCH RADIUS CONFIG FUNCTION
-- ----------------------------------------------------------------------------
-- Maximum allowable distance (in meters) between the citizen's photo location
-- and the chosen map pin. Mirrors merge_radius_meters().
create or replace function public.photo_match_radius_meters()
returns int
language sql
immutable
set search_path = public, extensions
as $$
  select 200;
$$;

grant execute on function public.photo_match_radius_meters to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. SUBMIT REPORT RPC
-- ----------------------------------------------------------------------------
-- Handles end-to-end report filing from the mobile/web frontend:
--   - Validates authentication (auth.uid() cannot be null)
--   - Requires a valid photo URL in Supabase Storage
--   - Verifies photo GPS proximity against pin (<= 200m) if photo GPS provided;
--     if photo GPS is null (GPS disabled/denied), marks location_verified = false
--   - Resolves nearest ward using PostGIS distance to wards.centre
--   - Maps category to the corresponding municipal department
--   - Creates a new issue OR links to an existing open issue of the same category
--   - Triggers score recalculation and returns complete priority metrics
create or replace function public.submit_report(
  p_category text,
  p_severity text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_photo_lat double precision default null,
  p_photo_lng double precision default null,
  p_photo_url text default null,
  p_is_anonymous boolean default false,
  p_on_behalf boolean default false,
  p_existing_issue_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_report_geom extensions.geography;
  v_photo_geom extensions.geography := null;
  v_location_verified boolean := false;
  v_ward_id int;
  v_ward_name text;
  v_dept_name text;
  v_dept_id int;
  v_issue_id uuid;
  v_report_id uuid;
  v_merged boolean := false;
  v_existing_issue record;
  v_priority_score int;
  v_priority_band text;
  v_reasons_text text;
  v_score_breakdown jsonb;
  v_status text;
begin
  -- 1. Verify user authentication
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required: user must be logged in to submit a report.';
  end if;

  -- 2. Verify photo URL is provided and not empty
  if p_photo_url is null or trim(p_photo_url) = '' then
    raise exception 'Photo is required';
  end if;

  -- 3. Validate coordinates
  if p_lat is null or p_lng is null then
    raise exception 'Invalid report location: pin coordinates are required.';
  end if;

  v_report_geom := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  -- 4. Spatial verification: check photo GPS against pin
  if p_photo_lat is not null and p_photo_lng is not null then
    v_photo_geom := extensions.st_setsrid(extensions.st_makepoint(p_photo_lng, p_photo_lat), 4326)::extensions.geography;
    
    if extensions.st_distance(v_photo_geom, v_report_geom) > public.photo_match_radius_meters() then
      raise exception 'Photo location is too far from the pin';
    end if;

    v_location_verified := true;
  else
    v_photo_geom := null;
    v_location_verified := false;
  end if;

  -- 5. Branch: Attach to existing issue vs Create new issue
  if p_existing_issue_id is not null then
    -- Verify existing issue exists, is not resolved, and has matching category
    select id, ward_id, category, status into v_existing_issue
    from public.issues
    where id = p_existing_issue_id;

    if not found then
      raise exception 'Existing issue not found.';
    end if;

    if v_existing_issue.status = 'resolved' then
      raise exception 'Cannot attach report: existing issue is already resolved.';
    end if;

    if v_existing_issue.category is distinct from p_category then
      raise exception 'Cannot attach report: category mismatch.';
    end if;

    v_issue_id := p_existing_issue_id;
    v_merged := true;
    v_ward_id := v_existing_issue.ward_id;

    select name into v_ward_name
    from public.wards
    where id = v_ward_id;

  else
    -- Find nearest ward by distance to ward centre
    select id, name into v_ward_id, v_ward_name
    from public.wards
    order by extensions.st_distance(centre, v_report_geom) asc
    limit 1;

    -- Map category to department
    -- Exact mapping required:
    -- pothole, damaged_road_marking, open_manhole, broken_streetlight, other => Roads & Infrastructure
    -- garbage => Solid Waste Management
    -- waterlogging, water_leak, drainage => Water Supply & Sewerage
    case lower(trim(p_category))
      when 'pothole' then v_dept_name := 'Roads & Infrastructure';
      when 'damaged_road_marking' then v_dept_name := 'Roads & Infrastructure';
      when 'open_manhole' then v_dept_name := 'Roads & Infrastructure';
      when 'broken_streetlight' then v_dept_name := 'Roads & Infrastructure';
      when 'other' then v_dept_name := 'Roads & Infrastructure';
      when 'garbage' then v_dept_name := 'Solid Waste Management';
      when 'waterlogging' then v_dept_name := 'Water Supply & Sewerage';
      when 'water_leak' then v_dept_name := 'Water Supply & Sewerage';
      when 'drainage' then v_dept_name := 'Water Supply & Sewerage';
      else v_dept_name := 'Roads & Infrastructure';
    end case;

    select id into v_dept_id
    from public.departments
    where name = v_dept_name;

    -- Create new issue
    insert into public.issues (
      category,
      severity_level,
      description,
      location,
      ward_id,
      department_id,
      status,
      unique_reporters
    ) values (
      p_category,
      coalesce(lower(p_severity), 'moderate'),
      p_description,
      v_report_geom,
      v_ward_id,
      v_dept_id,
      'reported',
      1
    ) returning id into v_issue_id;

    v_merged := false;
  end if;

  -- 6. Insert individual report row
  insert into public.reports (
    issue_id,
    user_id,
    is_anonymous,
    on_behalf,
    description,
    photo_url,
    photo_location,
    report_location
  ) values (
    v_issue_id,
    v_user_id,
    coalesce(p_is_anonymous, false),
    coalesce(p_on_behalf, false),
    p_description,
    p_photo_url,
    v_photo_geom,
    v_report_geom
  ) returning id into v_report_id;

  -- 7. Retrieve recalculation results (trg_recompute_on_report will have run)
  select
    priority_score,
    priority_band,
    reasons_text,
    score_breakdown,
    status
  into
    v_priority_score,
    v_priority_band,
    v_reasons_text,
    v_score_breakdown,
    v_status
  from public.issues
  where id = v_issue_id;

  -- 8. Return structured payload
  return jsonb_build_object(
    'issue_id', v_issue_id,
    'report_id', v_report_id,
    'priority_score', v_priority_score,
    'priority_band', v_priority_band,
    'reasons_text', v_reasons_text,
    'score_breakdown', v_score_breakdown,
    'status', v_status,
    'merged', v_merged,
    'ward_name', coalesce(v_ward_name, 'Unknown Ward'),
    'location_verified', v_location_verified
  );
end;
$$;

grant execute on function public.submit_report to authenticated;

-- ----------------------------------------------------------------------------
-- 3. GET PUBLIC ISSUE FUNCTION
-- ----------------------------------------------------------------------------
-- Returns public fields of a single issue (with ward & department names)
-- without leaking any submitting user IDs.
create or replace function public.get_public_issue(
  p_issue_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', i.id,
    'category', i.category,
    'severity_level', i.severity_level,
    'description', i.description,
    'lat', extensions.st_y(i.location::geometry),
    'lng', extensions.st_x(i.location::geometry),
    'address', i.address,
    'ward_id', i.ward_id,
    'ward_name', w.name,
    'department_id', i.department_id,
    'department_name', d.name,
    'road_class', i.road_class,
    'status', i.status,
    'unique_reporters', i.unique_reporters,
    'reopen_count', i.reopen_count,
    'priority_score', i.priority_score,
    'priority_band', i.priority_band,
    'score_breakdown', i.score_breakdown,
    'reasons_text', i.reasons_text,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'resolved_at', i.resolved_at
  )
  into v_result
  from public.issues i
  left join public.wards w on w.id = i.ward_id
  left join public.departments d on d.id = i.department_id
  where i.id = p_issue_id;

  return v_result;
end;
$$;

grant execute on function public.get_public_issue to anon, authenticated;
