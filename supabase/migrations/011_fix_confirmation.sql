-- ============================================================================
-- 011_fix_confirmation.sql
-- Civic Issue Tracker - Citizen Fix Confirmation & Dispute Reopen Engine
-- ============================================================================
--
-- SECURITY ARCHITECTURE NOTE ON SECURITY DEFINER:
-- 1. `get_fix_status`:
--    Citizen votes in public.fix_confirmations are private under Row Level
--    Security (RLS). Executing under SECURITY DEFINER allows aggregating the
--    counts of 'fixed' vs 'not fixed' votes and checking caller participation
--    (reports or upvotes) while strictly concealing citizen user UUIDs.
-- 2. `confirm_fix`:
--    Allows authenticated participants to register or alter their fix confirmation
--    vote under RLS. If 'not fixed' votes reach reopen_threshold(), SECURITY DEFINER
--    safely updates the issue status to 'reopened', resets assignments, purges
--    prior votes, and executes recompute_issue_score to apply the urgency boost.
-- 3. `reopen_stats`:
--    Aggregates municipal resolution quality and reopen dispute rates across
--    wards and departments for public transparency dashboards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REOPEN THRESHOLD FUNCTION
-- ----------------------------------------------------------------------------
-- The number of different "not fixed" votes that reopens an issue; it is the single constant to change.
create or replace function public.reopen_threshold()
returns int
language sql
immutable
set search_path = public, extensions
as $$
  -- The number of different "not fixed" votes that reopens an issue; it is the single constant to change.
  select 2;
$$;

grant execute on function public.reopen_threshold to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. GET FIX STATUS RPC
-- ----------------------------------------------------------------------------
-- Returns fix verification status, resolution proof details, aggregate vote counts,
-- and caller eligibility without exposing citizen user UUIDs.
create or replace function public.get_fix_status(
  p_issue_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Fix status inspector: Retrieves fix confirmation vote aggregates, resolution proof,
-- and caller eligibility while strictly concealing citizen user UUIDs under RLS.
declare
  v_user_id uuid;
  v_issue record;
  v_res record;
  v_fixed_yes int := 0;
  v_fixed_no int := 0;
  v_is_participant boolean := false;
  v_my_vote boolean := null;
  v_threshold int;
begin
  -- 1. Fetch issue
  select id, status, resolved_at, reopen_count
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    return null;
  end if;

  -- 2. Fetch latest resolution proof
  select after_photo_url, distance_from_issue_m
  into v_res
  from public.resolutions
  where issue_id = p_issue_id
  order by created_at desc
  limit 1;

  -- 3. Tally fix confirmation votes
  select
    coalesce(count(*) filter (where is_fixed = true), 0),
    coalesce(count(*) filter (where is_fixed = false), 0)
  into v_fixed_yes, v_fixed_no
  from public.fix_confirmations
  where issue_id = p_issue_id;

  -- 4. Check caller participation and personal vote
  v_user_id := auth.uid();
  if v_user_id is not null then
    select exists (
      select 1 from public.reports where issue_id = p_issue_id and user_id = v_user_id
      union all
      select 1 from public.upvotes where issue_id = p_issue_id and user_id = v_user_id
    ) into v_is_participant;

    select is_fixed into v_my_vote
    from public.fix_confirmations
    where issue_id = p_issue_id and user_id = v_user_id;
  else
    v_is_participant := false;
    v_my_vote := null;
  end if;

  v_threshold := public.reopen_threshold();

  return jsonb_build_object(
    'status', v_issue.status,
    'resolved_at', v_issue.resolved_at,
    'after_photo_url', v_res.after_photo_url,
    'distance_from_issue_m', v_res.distance_from_issue_m,
    'fixed_yes', v_fixed_yes,
    'fixed_no', v_fixed_no,
    'reopen_count', v_issue.reopen_count,
    'reopen_threshold', v_threshold,
    'is_participant', v_is_participant,
    'my_vote', v_my_vote,
    'can_vote', (v_issue.status = 'resolved' and v_is_participant)
  );
end;
$$;

grant execute on function public.get_fix_status to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. CONFIRM FIX RPC
-- ----------------------------------------------------------------------------
-- Registers or updates a participant's fix confirmation vote.
-- If 'not fixed' votes reach reopen_threshold(), automatically transitions the issue
-- to 'reopened', resets assignments, purges votes, and triggers score recalculation.
create or replace function public.confirm_fix(
  p_issue_id uuid,
  p_is_fixed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
-- Fix confirmation handler: Upserts participant verification vote, evaluates dispute
-- threshold, and executes automatic reopen escalation with scoring recalculation.
declare
  v_user_id uuid;
  v_issue record;
  v_is_participant boolean := false;
  v_fixed_yes int := 0;
  v_fixed_no int := 0;
  v_threshold int;
  v_reopened boolean := false;
  v_issue_updated record;
begin
  -- 1. Authentication check
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  -- 2. Issue check
  select id, status, reopen_count
  into v_issue
  from public.issues
  where id = p_issue_id;

  if not found or v_issue.status != 'resolved' then
    raise exception 'This issue is not awaiting confirmation';
  end if;

  -- 3. Participant check (reporter or upvoter)
  select exists (
    select 1 from public.reports where issue_id = p_issue_id and user_id = v_user_id
    union all
    select 1 from public.upvotes where issue_id = p_issue_id and user_id = v_user_id
  ) into v_is_participant;

  if not v_is_participant then
    raise exception 'Only people who reported or are affected by this issue can confirm the fix';
  end if;

  -- 4. Upsert vote into fix_confirmations
  insert into public.fix_confirmations (
    issue_id,
    user_id,
    is_fixed,
    created_at
  )
  values (
    p_issue_id,
    v_user_id,
    p_is_fixed,
    now()
  )
  on conflict (issue_id, user_id)
  do update set
    is_fixed = excluded.is_fixed,
    created_at = excluded.created_at;

  -- 5. Count votes
  select
    coalesce(count(*) filter (where is_fixed = true), 0),
    coalesce(count(*) filter (where is_fixed = false), 0)
  into v_fixed_yes, v_fixed_no
  from public.fix_confirmations
  where issue_id = p_issue_id;

  v_threshold := public.reopen_threshold();

  -- 6. Evaluate dispute threshold
  if v_fixed_no >= v_threshold then
    v_reopened := true;

    -- Reopen issue (trg_issue_status_history trigger handles audit log automatically)
    update public.issues
    set
      status = 'reopened',
      reopen_count = reopen_count + 1,
      resolved_at = null,
      assigned_to = null,
      updated_at = now()
    where id = p_issue_id;

    -- Delete prior confirmations so a fresh vote can start after the next fix
    delete from public.fix_confirmations
    where issue_id = p_issue_id;

    -- Recalculate priority score with +5 reopen boost
    perform public.recompute_issue_score(p_issue_id);

    v_fixed_yes := 0;
    v_fixed_no := 0;
  end if;

  -- 7. Read updated state back from issues table
  select status, reopen_count, priority_score, priority_band, reasons_text
  into v_issue_updated
  from public.issues
  where id = p_issue_id;

  return jsonb_build_object(
    'reopened', v_reopened,
    'status', v_issue_updated.status,
    'fixed_yes', v_fixed_yes,
    'fixed_no', v_fixed_no,
    'reopen_threshold', v_threshold,
    'reopen_count', v_issue_updated.reopen_count,
    'priority_score', v_issue_updated.priority_score,
    'priority_band', v_issue_updated.priority_band,
    'reasons_text', v_issue_updated.reasons_text
  );
end;
$$;

grant execute on function public.confirm_fix to authenticated;
revoke execute on function public.confirm_fix from anon;

-- ----------------------------------------------------------------------------
-- 4. REOPEN STATS RPC
-- ----------------------------------------------------------------------------
-- Returns municipal resolution quality metrics grouped by ward, department,
-- and system-wide overall.
create or replace function public.reopen_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- Reopen statistics calculator: Computes public civic resolution accountability metrics
-- across wards and departments for citizen oversight.
declare
  v_by_ward jsonb;
  v_by_dept jsonb;
  v_overall jsonb;
begin
  -- 1. By Ward (LEFT JOIN ensures issues with missing ward are preserved with null name)
  select coalesce(jsonb_agg(ward_row), '[]'::jsonb)
  into v_by_ward
  from (
    select jsonb_build_object(
      'ward_id', i.ward_id,
      'ward_name', w.name,
      'ever_resolved', count(*) filter (where i.status = 'resolved' or i.reopen_count > 0),
      'reopened', count(*) filter (where i.reopen_count > 0),
      'reopen_rate_pct', case
        when count(*) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round(
          (100.0 * count(*) filter (where i.reopen_count > 0) /
           count(*) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric,
          1
        )
      end
    ) as ward_row
    from public.issues i
    left join public.wards w on w.id = i.ward_id
    group by i.ward_id, w.name
    order by i.ward_id nulls last
  ) sub_ward;

  -- 2. By Department (LEFT JOIN ensures issues with missing department are preserved with null name)
  select coalesce(jsonb_agg(dept_row), '[]'::jsonb)
  into v_by_dept
  from (
    select jsonb_build_object(
      'department_id', i.department_id,
      'department_name', d.name,
      'ever_resolved', count(*) filter (where i.status = 'resolved' or i.reopen_count > 0),
      'reopened', count(*) filter (where i.reopen_count > 0),
      'reopen_rate_pct', case
        when count(*) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
        else round(
          (100.0 * count(*) filter (where i.reopen_count > 0) /
           count(*) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric,
          1
        )
      end
    ) as dept_row
    from public.issues i
    left join public.departments d on d.id = i.department_id
    group by i.department_id, d.name
    order by i.department_id nulls last
  ) sub_dept;

  -- 3. Overall
  select jsonb_build_object(
    'ever_resolved', count(*) filter (where i.status = 'resolved' or i.reopen_count > 0),
    'reopened', count(*) filter (where i.reopen_count > 0),
    'reopen_rate_pct', case
      when count(*) filter (where i.status = 'resolved' or i.reopen_count > 0) = 0 then null
      else round(
        (100.0 * count(*) filter (where i.reopen_count > 0) /
         count(*) filter (where i.status = 'resolved' or i.reopen_count > 0))::numeric,
        1
      )
    end
  )
  into v_overall
  from public.issues i;

  return jsonb_build_object(
    'by_ward', v_by_ward,
    'by_department', v_by_dept,
    'overall', coalesce(v_overall, jsonb_build_object(
      'ever_resolved', 0,
      'reopened', 0,
      'reopen_rate_pct', null
    ))
  );
end;
$$;

grant execute on function public.reopen_stats to anon, authenticated;
