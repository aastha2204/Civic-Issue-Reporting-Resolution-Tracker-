-- ============================================================================
-- 009_tracker.sql
-- Civic Issue Tracker - Public Tracker Queries, Aggregates, & Summary RPCs
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- 1. `list_public_issues`:
--    Under Row Level Security (RLS) on public.reports, individual citizen reports
--    are restricted to their submitting user_id (and municipal officers).
--    However, the public tracker map and listing must display the earliest photo
--    evidence uploaded for each issue so that citizens and officials can verify
--    the problem visually.
--    Executing `list_public_issues` under SECURITY DEFINER allows safely extracting
--    the earliest report's photo_url without leaking any citizen user UUIDs,
--    identity information, or private report metadata.
-- 2. `tracker_summary`:
--    Computes system-wide aggregate metrics across all 6 pipeline statuses and
--    active priority bands for civic transparency dashboards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LIST PUBLIC ISSUES RPC
-- ----------------------------------------------------------------------------
-- Returns a jsonb array of public issues ordered by priority_score desc,
-- then created_at asc.
-- Filters:
--   - p_statuses: array of status strings (e.g. ARRAY['reported', 'in_progress']). Null = no filter.
--   - p_categories: array of category keys (e.g. ARRAY['pothole', 'waterlogging']). Null = no filter.
--   - p_ward_id: integer ward foreign key. Null = no filter.
--   - p_limit: maximum number of records to return, capped at 500 (default 200).
--
-- Each element contains:
--   - id: uuid
--   - category: text
--   - category_label: text (from categories, null if missing related row)
--   - status: text
--   - priority_score: integer
--   - priority_band: text
--   - reasons_text: text
--   - unique_reporters: integer
--   - lat, lng: double precision (extracted from issues.location PostGIS geography)
--   - ward_id: integer (matching public.wards.id type)
--   - ward_name: text (from wards, null if missing related row)
--   - department_name: text (from departments, null if missing related row)
--   - road_class: text
--   - created_at: timestamptz
--   - days_open: integer (whole calendar days since created_at, or until resolved_at if resolved)
--   - photo_url: text (earliest report photo url)
create or replace function public.list_public_issues(
  p_statuses text[] default null,
  p_categories text[] default null,
  p_ward_id int default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_effective_limit int;
  v_results jsonb;
begin
  -- Cap limit between 1 and 500, default 200
  v_effective_limit := coalesce(least(greatest(p_limit, 1), 500), 200);

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
    where (p_statuses is null or array_length(p_statuses, 1) is null or i.status = any(p_statuses))
      and (p_categories is null or array_length(p_categories, 1) is null or i.category = any(p_categories))
      and (p_ward_id is null or i.ward_id = p_ward_id)
    order by i.priority_score desc, i.created_at asc
    limit v_effective_limit
  ) sub;

  return v_results;
end;
$$;

grant execute on function public.list_public_issues to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. TRACKER SUMMARY RPC
-- ----------------------------------------------------------------------------
-- Computes aggregate counts for the public tracker summary strip:
--   - total: total issues count
--   - by_status: counts for all six statuses in the pipeline (reported, verified,
--                assigned, in_progress, resolved, reopened; 0 if none)
--   - by_band: counts of open issues (status != 'resolved') per priority band (High, Medium, Low; 0 if none)
--   - reopened_issues: total number of issues currently in 'reopened' status
create or replace function public.tracker_summary()
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
    'total', count(*),
    'by_status', jsonb_build_object(
      'reported', count(*) filter (where status = 'reported'),
      'verified', count(*) filter (where status = 'verified'),
      'assigned', count(*) filter (where status = 'assigned'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'resolved', count(*) filter (where status = 'resolved'),
      'reopened', count(*) filter (where status = 'reopened')
    ),
    'by_band', jsonb_build_object(
      'High', count(*) filter (where status != 'resolved' and priority_band = 'High'),
      'Medium', count(*) filter (where status != 'resolved' and priority_band = 'Medium'),
      'Low', count(*) filter (where status != 'resolved' and priority_band = 'Low')
    ),
    'reopened_issues', count(*) filter (where status = 'reopened')
  )
  into v_result
  from public.issues;

  return coalesce(v_result, jsonb_build_object(
    'total', 0,
    'by_status', jsonb_build_object(
      'reported', 0,
      'verified', 0,
      'assigned', 0,
      'in_progress', 0,
      'resolved', 0,
      'reopened', 0
    ),
    'by_band', jsonb_build_object(
      'High', 0,
      'Medium', 0,
      'Low', 0
    ),
    'reopened_issues', 0
  ));
end;
$$;

grant execute on function public.tracker_summary to anon, authenticated;
