-- ============================================================================
-- 010_officer.sql
-- Civic Issue Tracker - Officer Workflow, Queue Management, & Resolution RPCs
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- 1. `officer_scope`:
--    Inspects profiles.role, department_id, and ward_id for auth.uid().
--    SECURITY DEFINER allows reading current user's profile metadata securely
--    under Row Level Security.
-- 2. `officer_queue`:
--    Retrieves ranked civic issues scoped to the officer's jurisdiction
--    (department and ward). Orders strictly by priority_score desc, then created_at asc.
--    SECURITY DEFINER safely extracts earliest report evidence photos while
--    strictly concealing reporter citizen IDs.
-- 3. `officer_issue`:
--    Retrieves single-issue details, score breakdown, status timeline, and resolution
--    proof. Verifies officer/admin jurisdiction scope before returning.
-- 4. `list_department_officers`:
--    Retrieves officer list in the caller's department for assignment delegation.
-- 5. `officer_set_status`:
--    Enforces workflow transitions (reported -> verified, assigned -> in_progress).
--    Reuses trg_issue_status_history trigger on public.issues without manual insertions.
-- 6. `officer_assign`:
--    Validates assignee role and updates assigned_to and status to 'assigned'.
-- 7. `officer_resolve`:
--    Enforces photographic proof and GPS proximity (<= 100 meters via PostGIS).
--    Records resolution audit entry and transitions issue status to 'resolved'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RESOLUTION RADIUS HELPER
-- ----------------------------------------------------------------------------
-- Maximum allowable distance (in meters) between an officer's resolution photo
-- and the original issue location (matches merge_radius_meters = 100m).
create or replace function public.resolution_radius_meters()
returns int
language sql
immutable
set search_path = public, extensions
as $$
  select 100;
$$;

grant execute on function public.resolution_radius_meters to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. OFFICER SCOPE HELPER
-- ----------------------------------------------------------------------------
-- Returns caller's role, department_id, and ward_id from public.profiles.
-- A null department_id or ward_id on an officer means "all".
-- An admin sees everything (represented by returning null department & ward).
create or replace function public.officer_scope()
returns table (
  role text,
  department_id int,
  ward_id int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Helper: Resolves caller's role and municipal jurisdiction scope.
-- SECURITY DEFINER is required to inspect caller profile metadata under RLS.
declare
  v_role text;
  v_dept int;
  v_ward int;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  select p.role, p.department_id, p.ward_id
  into v_role, v_dept, v_ward
  from public.profiles p
  where p.id = auth.uid();

  if v_role is null or v_role not in ('officer', 'admin') then
    raise exception 'Unauthorized: Officer or admin access required.';
  end if;

  -- Admin sees everything: treat department_id and ward_id as null (all)
  if v_role = 'admin' then
    return query select v_role, null::int, null::int;
  else
    return query select v_role, v_dept, v_ward;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. OFFICER QUEUE RPC
-- ----------------------------------------------------------------------------
-- Returns a jsonb array of issues ordered by priority_score desc, then created_at asc.
-- Strictly limited to the caller's jurisdiction scope.
-- Default (p_statuses null or empty): all except 'resolved'.
-- Reporter user IDs are never returned.
create or replace function public.officer_queue(
  p_statuses text[] default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Officer RPC: Returns ranked issue queue within the caller's department/ward jurisdiction.
-- SECURITY DEFINER is required to read evidence photos across citizen reports
-- while enforcing role validation and concealing citizen identities.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_effective_limit int;
  v_results jsonb;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Cap limit between 1 and 500, default 200
  v_effective_limit := coalesce(least(greatest(p_limit, 1), 500), 200);

  -- 3. Query ranked issues
  select coalesce(jsonb_agg(issue_row), '[]'::jsonb)
  into v_results
  from (
    select jsonb_build_object(
      'id', i.id,
      'category', i.category,
      'category_label', c.label,
      'status', i.status,
      'priority_score', i.priority_score,
      'priority_band', i.priority_band,
      'reasons_text', i.reasons_text,
      'score_breakdown', i.score_breakdown,
      'unique_reporters', i.unique_reporters,
      'lat', extensions.st_y(i.location::geometry),
      'lng', extensions.st_x(i.location::geometry),
      'ward_id', i.ward_id,
      'ward_name', w.name,
      'department_name', d.name,
      'road_class', i.road_class,
      'created_at', i.created_at,
      'days_open', greatest(0, floor(extract(epoch from (
        case
          when i.status = 'resolved' and i.resolved_at is not null then i.resolved_at
          else now()
        end - i.created_at
      )) / 86400)::int),
      'sla_hours', c.sla_hours,
      'assigned_to', i.assigned_to,
      'assigned_to_name', ap.display_name,
      'photo_url', (
        select r.photo_url
        from public.reports r
        where r.issue_id = i.id and r.photo_url is not null
        order by r.created_at asc
        limit 1
      )
    ) as issue_row
    from public.issues i
    left join public.categories c on c.key = i.category
    left join public.wards w on w.id = i.ward_id
    left join public.departments d on d.id = i.department_id
    left join public.profiles ap on ap.id = i.assigned_to
    where (
      case
        when p_statuses is null or array_length(p_statuses, 1) is null then i.status != 'resolved'
        else i.status = any(p_statuses)
      end
    )
    and (v_role = 'admin' or v_dept is null or i.department_id = v_dept)
    and (v_role = 'admin' or v_ward is null or i.ward_id = v_ward)
    order by i.priority_score desc, i.created_at asc
    limit v_effective_limit
  ) sub;

  return v_results;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. OFFICER ISSUE DETAIL RPC
-- ----------------------------------------------------------------------------
-- Returns full details for a single issue including audit status history,
-- resolution proof, and breakdown metrics. Scope-checked.
create or replace function public.officer_issue(
  p_issue_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Officer RPC: Returns complete details and lifecycle timeline for an issue.
-- SECURITY DEFINER is required to inspect report and resolution records
-- across citizen boundaries while strictly enforcing officer jurisdiction.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_issue_dept int;
  v_issue_ward int;
  v_result jsonb;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Fetch issue jurisdiction columns for scope check
  select i.department_id, i.ward_id
  into v_issue_dept, v_issue_ward
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'Issue not found';
  end if;

  -- 3. Scope verification
  if v_role != 'admin' then
    if v_dept is not null and v_issue_dept is distinct from v_dept then
      raise exception 'Unauthorized: Issue is outside your department jurisdiction.';
    end if;
    if v_ward is not null and v_issue_ward is distinct from v_ward then
      raise exception 'Unauthorized: Issue is outside your ward jurisdiction.';
    end if;
  end if;

  -- 4. Build complete issue detail object
  select jsonb_build_object(
    'id', i.id,
    'category', i.category,
    'category_label', c.label,
    'severity_level', i.severity_level,
    'description', i.description,
    'address', i.address,
    'status', i.status,
    'priority_score', i.priority_score,
    'priority_band', i.priority_band,
    'reasons_text', i.reasons_text,
    'score_breakdown', i.score_breakdown,
    'unique_reporters', i.unique_reporters,
    'lat', extensions.st_y(i.location::geometry),
    'lng', extensions.st_x(i.location::geometry),
    'ward_id', i.ward_id,
    'ward_name', w.name,
    'department_name', d.name,
    'road_class', i.road_class,
    'created_at', i.created_at,
    'days_open', greatest(0, floor(extract(epoch from (
      case
        when i.status = 'resolved' and i.resolved_at is not null then i.resolved_at
        else now()
      end - i.created_at
    )) / 86400)::int),
    'sla_hours', c.sla_hours,
    'assigned_to', i.assigned_to,
    'assigned_to_name', ap.display_name,
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
    'distance_from_issue_m', (
      select res.distance_from_issue_m
      from public.resolutions res
      where res.issue_id = i.id
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
    ), '[]'::jsonb)
  )
  into v_result
  from public.issues i
  left join public.categories c on c.key = i.category
  left join public.wards w on w.id = i.ward_id
  left join public.departments d on d.id = i.department_id
  left join public.profiles ap on ap.id = i.assigned_to
  where i.id = p_issue_id;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. LIST DEPARTMENT OFFICERS RPC
-- ----------------------------------------------------------------------------
-- Returns jsonb array of {id, display_name} for officers and admins in the
-- caller's department (or all officers if caller is admin or has no department).
create or replace function public.list_department_officers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Officer helper: Lists eligible assignee officers within caller's department.
-- SECURITY DEFINER is required to query officer profile listings under RLS.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_officers jsonb;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Query officers based on department scope
  if v_role = 'admin' or v_dept is null then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'display_name', coalesce(p.display_name, 'Officer ' || substr(p.id::text, 1, 8))
      ) order by coalesce(p.display_name, p.id::text) asc
    ), '[]'::jsonb)
    into v_officers
    from public.profiles p
    where p.role in ('officer', 'admin');
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'display_name', coalesce(p.display_name, 'Officer ' || substr(p.id::text, 1, 8))
      ) order by coalesce(p.display_name, p.id::text) asc
    ), '[]'::jsonb)
    into v_officers
    from public.profiles p
    where p.role in ('officer', 'admin')
      and (p.department_id = v_dept or p.role = 'admin');
  end if;

  return v_officers;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. OFFICER SET STATUS RPC
-- ----------------------------------------------------------------------------
-- Allowed transitions: reported -> verified; assigned -> in_progress.
-- Never allows setting 'resolved' here (resolving requires officer_resolve).
-- Updates issues.status and issues.updated_at.
-- Automatically activates existing trg_issue_status_history trigger.
create or replace function public.officer_set_status(
  p_issue_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
-- Officer action: Advances issue status along authorized lifecycle steps.
-- SECURITY DEFINER is required to update issues status while strictly validating
-- caller role and jurisdiction boundaries.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_issue record;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Fetch issue
  select id, status, department_id, ward_id
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'Issue not found';
  end if;

  -- 3. Scope check
  if v_role != 'admin' then
    if v_dept is not null and v_issue.department_id is distinct from v_dept then
      raise exception 'Unauthorized: Issue is outside your department jurisdiction.';
    end if;
    if v_ward is not null and v_issue.ward_id is distinct from v_ward then
      raise exception 'Unauthorized: Issue is outside your ward jurisdiction.';
    end if;
  end if;

  -- 4. Never allow setting resolved here
  if p_new_status = 'resolved' then
    raise exception 'Transition not allowed: resolving requires an after-photo';
  end if;

  -- 5. Allowed transitions only: reported -> verified; assigned -> in_progress
  if (v_issue.status = 'reported' and p_new_status = 'verified')
     or (v_issue.status = 'assigned' and p_new_status = 'in_progress') then
    update public.issues
    set
      status = p_new_status,
      updated_at = now()
    where id = p_issue_id;

    return jsonb_build_object('status', p_new_status);
  else
    raise exception 'Transition not allowed';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. OFFICER ASSIGN RPC
-- ----------------------------------------------------------------------------
-- Allowed from reported, verified, assigned, reopened.
-- Assignee must be an officer or admin in profiles.
-- Sets assigned_to, status = 'assigned', and updated_at.
-- Automatically activates existing trg_issue_status_history trigger.
create or replace function public.officer_assign(
  p_issue_id uuid,
  p_assignee uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
-- Officer action: Assigns an issue to a designated officer or administrator.
-- SECURITY DEFINER is required to update issue assignments and validate
-- assignee eligibility under RLS.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_issue record;
  v_assignee_name text;
  v_assignee_role text;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Fetch issue
  select id, status, department_id, ward_id
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'Issue not found';
  end if;

  -- 3. Scope check
  if v_role != 'admin' then
    if v_dept is not null and v_issue.department_id is distinct from v_dept then
      raise exception 'Unauthorized: Issue is outside your department jurisdiction.';
    end if;
    if v_ward is not null and v_issue.ward_id is distinct from v_ward then
      raise exception 'Unauthorized: Issue is outside your ward jurisdiction.';
    end if;
  end if;

  -- 4. Allowed from reported, verified, assigned, reopened
  if v_issue.status not in ('reported', 'verified', 'assigned', 'reopened') then
    raise exception 'Transition not allowed: issue cannot be assigned from status %', v_issue.status;
  end if;

  -- 5. The assignee must be an officer or admin
  select display_name, role
  into v_assignee_name, v_assignee_role
  from public.profiles
  where id = p_assignee;

  if not found or v_assignee_role not in ('officer', 'admin') then
    raise exception 'Assignee must be an officer or admin';
  end if;

  -- 6. Update issue: sets assigned_to, status = 'assigned', updated_at
  update public.issues
  set
    assigned_to = p_assignee,
    status = 'assigned',
    updated_at = now()
  where id = p_issue_id;

  return jsonb_build_object(
    'status', 'assigned',
    'assigned_to_name', coalesce(v_assignee_name, 'Officer ' || substr(p_assignee::text, 1, 8))
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. OFFICER RESOLVE RPC
-- ----------------------------------------------------------------------------
-- Allowed only from assigned or in_progress.
-- Requires after_photo_url and valid GPS coordinates.
-- Enforces ST_Distance <= resolution_radius_meters() (100m).
-- Inserts into public.resolutions and sets issues.status = 'resolved'.
-- Automatically activates existing trg_issue_status_history trigger.
create or replace function public.officer_resolve(
  p_issue_id uuid,
  p_after_photo_url text,
  p_photo_lat double precision,
  p_photo_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
-- Officer action: Marks an issue as resolved with geotagged photographic proof.
-- SECURITY DEFINER is required to execute PostGIS proximity verification,
-- insert resolution audit records, and close issues securely.
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_issue record;
  v_photo_geom extensions.geography;
  v_distance numeric;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Validate after-photo URL
  if p_after_photo_url is null or trim(p_after_photo_url) = '' then
    raise exception 'After-photo URL is required';
  end if;

  -- 3. Photo lat/lng required
  if p_photo_lat is null or p_photo_lng is null then
    raise exception 'After-photo location is required to verify the fix';
  end if;

  -- 4. Fetch issue
  select id, status, location, department_id, ward_id
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'Issue not found';
  end if;

  -- 5. Scope check
  if v_role != 'admin' then
    if v_dept is not null and v_issue.department_id is distinct from v_dept then
      raise exception 'Unauthorized: Issue is outside your department jurisdiction.';
    end if;
    if v_ward is not null and v_issue.ward_id is distinct from v_ward then
      raise exception 'Unauthorized: Issue is outside your ward jurisdiction.';
    end if;
  end if;

  -- 6. Allowed only from assigned or in_progress
  if v_issue.status not in ('assigned', 'in_progress') then
    raise exception 'Transition not allowed: issue must be assigned or in_progress to be resolved';
  end if;

  -- 7. Compute distance from issue location
  v_photo_geom := extensions.st_setsrid(extensions.st_makepoint(p_photo_lng, p_photo_lat), 4326)::extensions.geography;
  v_distance := round(extensions.st_distance(v_issue.location, v_photo_geom)::numeric, 1);

  if v_distance > public.resolution_radius_meters() then
    raise exception 'After-photo is too far from the original issue location';
  end if;

  -- 8. Insert into resolutions
  insert into public.resolutions (
    issue_id,
    officer_id,
    after_photo_url,
    after_photo_location,
    distance_from_issue_m
  )
  values (
    p_issue_id,
    auth.uid(),
    p_after_photo_url,
    v_photo_geom,
    v_distance
  );

  -- 9. Update issues table
  update public.issues
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  where id = p_issue_id;

  return jsonb_build_object(
    'status', 'resolved',
    'distance_from_issue_m', v_distance
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. GRANTS AND REVOKES
-- ----------------------------------------------------------------------------
-- Grant execute permissions to authenticated role (functions enforce roles internally).
-- Explicitly revoke execute from anonymous users for sensitive officer actions.

grant execute on function public.officer_scope to authenticated;
grant execute on function public.officer_queue to authenticated;
grant execute on function public.officer_issue to authenticated;
grant execute on function public.list_department_officers to authenticated;
grant execute on function public.officer_set_status to authenticated;
grant execute on function public.officer_assign to authenticated;
grant execute on function public.officer_resolve to authenticated;

revoke execute on function public.officer_scope from anon;
revoke execute on function public.officer_queue from anon;
revoke execute on function public.officer_issue from anon;
revoke execute on function public.list_department_officers from anon;
revoke execute on function public.officer_set_status from anon;
revoke execute on function public.officer_assign from anon;
revoke execute on function public.officer_resolve from anon;
