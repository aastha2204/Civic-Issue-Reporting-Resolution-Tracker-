-- ============================================================================
-- 006_duplicates_upvotes.sql
-- Civic Issue Tracker - Duplicate Detection, Upvotes ("I'm affected too"),
-- and Enhanced Single-Issue Public Inspection
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- 1. `check_duplicates`: Citizen reports are private under Row Level Security
--    on public.reports. However, duplicate detection needs to retrieve the
--    earliest uploaded photo URL across any citizen's report for candidate issues
--    within the merge radius. Executing under SECURITY DEFINER enables reading
--    this evidence safely while guaranteeing no submitter user IDs are exposed.
-- 2. `affected_too`: Inserting an upvote into public.upvotes triggers the automated
--    recalculation of priority scores across all distinct reporters and updates
--    public.issues. Executing under SECURITY DEFINER allows the system to verify
--    if the user previously reported or upvoted without requiring broad table
--    privileges for citizens.
-- 3. `get_public_issue`: Reads the issue's earliest evidence photo and resolves
--    the caller's support status (`i_support_this`) without exposing user IDs.
-- 4. `submit_report`: Updated to return `unique_reporters` and `already_reported`
--    while preserving all validation, nearest-ward assignment, and scoring triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CHECK DUPLICATES RPC
-- ----------------------------------------------------------------------------
-- Returns up to 3 open issues (status not resolved) of the SAME category
-- within merge_radius_meters() (100 m) of the coordinates, ordered nearest first.
-- Returns: issue_id, category, status, distance_m (rounded), unique_reporters,
-- priority_score, priority_band, reasons_text, created_at, photo_url.
-- Never returns user IDs.
create or replace function public.check_duplicates(
  p_lat double precision,
  p_lng double precision,
  p_category text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_point extensions.geography;
  v_results jsonb;
begin
  if p_lat is null or p_lng is null or p_category is null then
    return '[]'::jsonb;
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  select coalesce(jsonb_agg(dup_item), '[]'::jsonb)
  into v_results
  from (
    select jsonb_build_object(
      'issue_id', i.id,
      'category', i.category,
      'status', i.status,
      'distance_m', round(extensions.st_distance(i.location, v_point)::numeric),
      'unique_reporters', i.unique_reporters,
      'priority_score', i.priority_score,
      'priority_band', i.priority_band,
      'reasons_text', i.reasons_text,
      'created_at', i.created_at,
      'photo_url', (
        select r.photo_url
        from public.reports r
        where r.issue_id = i.id and r.photo_url is not null
        order by r.created_at asc
        limit 1
      )
    ) as dup_item
    from public.issues i
    where i.category = p_category
      and i.status != 'resolved'
      and extensions.st_dwithin(i.location, v_point, public.merge_radius_meters())
    order by extensions.st_distance(i.location, v_point) asc
    limit 3
  ) sub;

  return v_results;
end;
$$;

grant execute on function public.check_duplicates to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. AFFECTED TOO RPC ("I'm affected too")
-- ----------------------------------------------------------------------------
-- Allows an authenticated citizen to upvote an issue.
-- Recomputes score via trg_recompute_on_upvote if this is a new supporter.
-- If user already supports (has upvote or report), returns already_counted = true
-- and changes nothing.
create or replace function public.affected_too(
  p_issue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_issue record;
begin
  -- 1. Ensure user is authenticated
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required: user must be logged in to support an issue.';
  end if;

  -- 2. Verify issue exists and is not resolved
  select id, status, unique_reporters, priority_score, priority_band, reasons_text
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'Issue not found.';
  end if;

  if v_issue.status = 'resolved' then
    raise exception 'Cannot support a resolved issue.';
  end if;

  -- 3. Check if user already supports this issue (has upvote OR has report)
  if exists (
    select 1 from public.upvotes where issue_id = p_issue_id and user_id = v_user_id
    union all
    select 1 from public.reports where issue_id = p_issue_id and user_id = v_user_id
  ) then
    return jsonb_build_object(
      'already_counted', true,
      'unique_reporters', v_issue.unique_reporters,
      'priority_score', v_issue.priority_score,
      'priority_band', v_issue.priority_band,
      'reasons_text', v_issue.reasons_text
    );
  end if;

  -- 4. Record new upvote
  insert into public.upvotes (issue_id, user_id)
  values (p_issue_id, v_user_id)
  on conflict (issue_id, user_id) do nothing;

  -- 5. Trigger trg_recompute_on_upvote has fired and recomputed score
  select unique_reporters, priority_score, priority_band, reasons_text
  into v_issue
  from public.issues
  where id = p_issue_id;

  return jsonb_build_object(
    'already_counted', false,
    'unique_reporters', v_issue.unique_reporters,
    'priority_score', v_issue.priority_score,
    'priority_band', v_issue.priority_band,
    'reasons_text', v_issue.reasons_text
  );
end;
$$;

grant execute on function public.affected_too to authenticated;

-- ----------------------------------------------------------------------------
-- 3. GET PUBLIC ISSUE FUNCTION (REPLACE)
-- ----------------------------------------------------------------------------
-- Returns public fields of an issue including reasons_text, score_breakdown,
-- unique_reporters, status, status_history array, earliest photo_url,
-- resolution after_photo_url, and the caller's own i_support_this flag.
-- Never exposes submitter user IDs.
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
  v_user_id uuid;
  v_i_support boolean := false;
begin
  v_user_id := auth.uid();
  if v_user_id is not null then
    select exists (
      select 1 from public.reports where issue_id = p_issue_id and user_id = v_user_id
      union all
      select 1 from public.upvotes where issue_id = p_issue_id and user_id = v_user_id
    ) into v_i_support;
  else
    v_i_support := false;
  end if;

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
    'resolved_at', i.resolved_at,
    'photo_url', (
      select r.photo_url
      from public.reports r
      where r.issue_id = i.id and r.photo_url is not null
      order by r.created_at asc
      limit 1
    ),
    'after_photo_url', (
      select res.after_photo_url
      from public.resolutions res
      where res.issue_id = i.id and res.after_photo_url is not null
      order by res.created_at desc
      limit 1
    ),
    'status_history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'status', sh.status,
          'created_at', sh.created_at
        ) order by sh.created_at asc
      )
      from public.status_history sh
      where sh.issue_id = i.id
    ), '[]'::jsonb),
    'i_support_this', v_i_support
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

-- ----------------------------------------------------------------------------
-- 4. SUBMIT REPORT RPC (ENHANCED RETURN FIELDS)
-- ----------------------------------------------------------------------------
-- Identical logic and signature to 005_submit_report.sql, with two additional
-- return fields: unique_reporters and already_reported.
-- already_reported is evaluated BEFORE inserting the new report.
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
  v_unique_reporters int;
  v_already_reported boolean := false;
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

    -- Evaluate whether the user was already counted BEFORE inserting the new report
    select exists (
      select 1 from public.reports where issue_id = p_existing_issue_id and user_id = v_user_id
      union all
      select 1 from public.upvotes where issue_id = p_existing_issue_id and user_id = v_user_id
    ) into v_already_reported;

    v_issue_id := p_existing_issue_id;
    v_merged := true;
    v_ward_id := v_existing_issue.ward_id;

    select name into v_ward_name
    from public.wards
    where id = v_ward_id;

  else
    v_already_reported := false;

    -- Find nearest ward by distance to ward centre
    select id, name into v_ward_id, v_ward_name
    from public.wards
    order by extensions.st_distance(centre, v_report_geom) asc
    limit 1;

    -- Map category to department
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
    status,
    unique_reporters
  into
    v_priority_score,
    v_priority_band,
    v_reasons_text,
    v_score_breakdown,
    v_status,
    v_unique_reporters
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
    'location_verified', v_location_verified,
    'unique_reporters', v_unique_reporters,
    'already_reported', v_already_reported
  );
end;
$$;

grant execute on function public.submit_report to authenticated;
