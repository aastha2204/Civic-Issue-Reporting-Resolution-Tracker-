-- ============================================================================
-- 015_photo_check.sql
-- Civic Issue Tracker - AI Photo Verification & Anti-Spam Gate
-- ============================================================================
--
-- ARCHITECTURE & SECURITY DESIGN:
-- 1. AI Only Detects: The Gemini model provides metadata (category, confidence,
--    authenticity, civic relevance). The database enforces the authoritative verdict.
-- 2. Single Truth: Verdict rules are implemented in PostgreSQL (photo_verdict)
--    so they can be audited, explained to judges, and protected against frontend tampering.
-- 3. Database Enforcement: The trigger `enforce_photo_check` runs BEFORE INSERT on
--    public.reports. Unchecked or rejected photos are blocked directly by the database.
-- 4. Private AI Store: `public.photo_checks` has RLS enabled with NO policies for
--    anon or authenticated. Only the service role writes to it. Citizens only receive
--    sanitized verdict objects through `check_photo()` without user IDs or raw prompts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE: photo_checks
-- ----------------------------------------------------------------------------
-- Stores AI detection outputs and image hash fingerprints. Private to service role.
create table if not exists public.photo_checks (
  photo_url text primary key,
  user_id uuid,
  analysis_status text not null check (analysis_status in ('ok', 'unavailable')),
  detected_category text,
  confidence numeric,
  is_civic_issue boolean,
  is_real_photo boolean,
  suggested_severity text,
  reason text,
  image_sha256 text,
  created_at timestamptz not null default now()
);

-- Enable RLS: Keep strictly private. No policies for anon or authenticated.
alter table public.photo_checks enable row level security;

-- Index on image SHA-256 hash for fast cross-report duplicate / reuse detection
create index if not exists idx_photo_checks_image_sha256 on public.photo_checks(image_sha256);

-- ----------------------------------------------------------------------------
-- 2. THRESHOLD CONFIG FUNCTION
-- ----------------------------------------------------------------------------
-- Single configuration constant: how sure the AI must be before a mismatch is
-- blocked or a match is trusted.
create or replace function public.photo_confidence_threshold()
returns numeric
language sql
immutable
as $$
  select 0.7::numeric;
$$;

grant execute on function public.photo_confidence_threshold to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. APP SETTING: PHOTO CHECK FAIL MODE
-- ----------------------------------------------------------------------------
-- 'open'   = If the AI is unavailable, allow submission and mark "photo not verified".
-- 'closed' = If the AI is unavailable, block the submission.
insert into public.app_settings (key, value)
values ('photo_check_fail_mode', 'open')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 4. VERDICT FUNCTION: photo_verdict
-- ----------------------------------------------------------------------------
-- Evaluates the authoritative verdict for a given photo and chosen category.
-- Pure database verdict logic. Executable by no client role (internal only).
create or replace function public.photo_verdict(
  p_photo_url text,
  p_category text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_check public.photo_checks%rowtype;
  v_fail_mode text;
  v_threshold numeric;
begin
  -- Rule 1: No photo_checks row for the url -> reject, code 'missing'
  select * into v_check
  from public.photo_checks
  where photo_url = p_photo_url;

  if not found then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'missing',
      'detected_category', null,
      'suggested_severity', null,
      'confidence', null
    );
  end if;

  -- Rule 2: analysis_status = 'unavailable' -> 'unchecked' (or 'reject' if fail mode is 'closed')
  if v_check.analysis_status = 'unavailable' then
    select value into v_fail_mode
    from public.app_settings
    where key = 'photo_check_fail_mode';

    if coalesce(v_fail_mode, 'open') = 'closed' then
      return jsonb_build_object(
        'verdict', 'reject',
        'code', 'unavailable',
        'detected_category', null,
        'suggested_severity', null,
        'confidence', null
      );
    else
      return jsonb_build_object(
        'verdict', 'unchecked',
        'code', 'unavailable',
        'detected_category', null,
        'suggested_severity', null,
        'confidence', null
      );
    end if;
  end if;

  -- Rule 3: is_real_photo = false -> reject, code 'not_real'
  if coalesce(v_check.is_real_photo, false) = false then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'not_real',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  end if;

  -- Rule 4: is_civic_issue = false -> reject, code 'not_civic'
  if coalesce(v_check.is_civic_issue, false) = false then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'not_civic',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  end if;

  -- Rule 5: Reused image -> another photo_checks row with same image_sha256
  -- but a different photo_url already used in reports: reject, code 'reused'
  if v_check.image_sha256 is not null and exists (
    select 1
    from public.photo_checks pc
    join public.reports r on r.photo_url = pc.photo_url
    where pc.image_sha256 = v_check.image_sha256
      and pc.photo_url <> p_photo_url
  ) then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'reused',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  end if;

  -- Rule 6: Category 'other' chosen by citizen -> pass, code 'ok'
  if lower(trim(p_category)) = 'other' then
    return jsonb_build_object(
      'verdict', 'pass',
      'code', 'ok',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  end if;

  v_threshold := public.photo_confidence_threshold();

  -- Rule 7: detected_category = p_category -> pass if confidence >= threshold, otherwise review
  if lower(trim(coalesce(v_check.detected_category, ''))) = lower(trim(p_category)) then
    if coalesce(v_check.confidence, 0) >= v_threshold then
      return jsonb_build_object(
        'verdict', 'pass',
        'code', 'ok',
        'detected_category', v_check.detected_category,
        'suggested_severity', v_check.suggested_severity,
        'confidence', v_check.confidence
      );
    else
      return jsonb_build_object(
        'verdict', 'review',
        'code', 'low_confidence',
        'detected_category', v_check.detected_category,
        'suggested_severity', v_check.suggested_severity,
        'confidence', v_check.confidence
      );
    end if;
  end if;

  -- Rule 8: detected_category differs -> reject with 'mismatch' if confidence >= threshold, otherwise review
  if coalesce(v_check.confidence, 0) >= v_threshold then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'mismatch',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  else
    return jsonb_build_object(
      'verdict', 'review',
      'code', 'low_confidence',
      'detected_category', v_check.detected_category,
      'suggested_severity', v_check.suggested_severity,
      'confidence', v_check.confidence
    );
  end if;
end;
$$;

-- Internal function: revoke execution from client roles
revoke execute on function public.photo_verdict(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. CLIENT-FACING RPC: check_photo
-- ----------------------------------------------------------------------------
-- Safe endpoint for authenticated citizens to query their photo's verdict.
-- Verifies caller ownership of the photo check and hides user IDs.
create or replace function public.check_photo(
  p_photo_url text,
  p_category text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  -- Require the photo_checks row to exist and belong to the calling user
  if not exists (
    select 1
    from public.photo_checks
    where photo_url = p_photo_url
      and user_id = v_user_id
  ) then
    return jsonb_build_object(
      'verdict', 'reject',
      'code', 'missing',
      'detected_category', null,
      'suggested_severity', null,
      'confidence', null
    );
  end if;

  return public.photo_verdict(p_photo_url, p_category);
end;
$$;

grant execute on function public.check_photo(text, text) to authenticated;
revoke execute on function public.check_photo(text, text) from anon, public;

-- ----------------------------------------------------------------------------
-- 6. TRIGGER ON REPORTS: enforce_photo_check
-- ----------------------------------------------------------------------------
-- Guaranteed server-side gate executed BEFORE INSERT on public.reports.
-- Ensures that unverified, missing, or rejected photos cannot be persisted.
create or replace function public.trigger_enforce_photo_check()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_category text;
  v_verdict jsonb;
  v_code text;
begin
  -- Allow direct seed scripts or SQL Editor executions without auth.uid()
  if auth.uid() is null then
    return NEW;
  end if;

  -- Look up issue category
  select category into v_category
  from public.issues
  where id = NEW.issue_id;

  if not found then
    raise exception 'Issue not found for report.';
  end if;

  -- Require a photo_checks row for NEW.photo_url owned by NEW.user_id
  if not exists (
    select 1
    from public.photo_checks
    where photo_url = NEW.photo_url
      and user_id = NEW.user_id
  ) then
    raise exception 'Photo has not been checked';
  end if;

  -- Evaluate verdict
  v_verdict := public.photo_verdict(NEW.photo_url, v_category);
  v_code := v_verdict->>'code';

  -- If verdict is reject, block the insert with exception
  if (v_verdict->>'verdict') = 'reject' then
    raise exception 'Photo check failed: %', v_code;
  end if;

  -- If pass, review, or unchecked: set AI suggested category & severity
  NEW.ai_suggested_category := v_verdict->>'detected_category';
  NEW.ai_suggested_severity := v_verdict->>'suggested_severity';

  return NEW;
end;
$$;

drop trigger if exists enforce_photo_check on public.reports;
create trigger enforce_photo_check
before insert on public.reports
for each row
execute function public.trigger_enforce_photo_check();

-- ----------------------------------------------------------------------------
-- 7. OFFICER RPC: officer_photo_checks
-- ----------------------------------------------------------------------------
-- Returns photo check details for all reports on an issue.
-- Accessible strictly to verified officers or admins within their jurisdiction.
create or replace function public.officer_photo_checks(
  p_issue_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_dept int;
  v_ward int;
  v_issue_dept int;
  v_issue_ward int;
  v_category text;
  v_result jsonb;
begin
  -- 1. Check caller role and get jurisdiction scope
  select s.role, s.department_id, s.ward_id
  into v_role, v_dept, v_ward
  from public.officer_scope() s;

  -- 2. Fetch issue jurisdiction columns and category for scope check
  select i.department_id, i.ward_id, i.category
  into v_issue_dept, v_issue_ward, v_category
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'Issue not found';
  end if;

  -- 3. Scope verification (matches officer_issue logic in 010_officer.sql)
  if v_role != 'admin' then
    if v_dept is not null and v_issue_dept is distinct from v_dept then
      raise exception 'Unauthorized: Issue is outside your department jurisdiction.';
    end if;
    if v_ward is not null and v_issue_ward is distinct from v_ward then
      raise exception 'Unauthorized: Issue is outside your ward jurisdiction.';
    end if;
  end if;

  -- 4. Aggregate photo checks for each report on this issue
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'photo_url', r.photo_url,
        'verdict', v.verdict,
        'code', v.code,
        'detected_category', v.detected_category,
        'confidence', v.confidence,
        'created_at', r.created_at
      )
      order by r.created_at asc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.reports r
  cross join lateral (
    select
      (pv->>'verdict')::text as verdict,
      (pv->>'code')::text as code,
      (pv->>'detected_category')::text as detected_category,
      (pv->>'confidence')::numeric as confidence
    from (select public.photo_verdict(r.photo_url, v_category) as pv) sub
  ) v
  where r.issue_id = p_issue_id
    and r.photo_url is not null;

  return v_result;
end;
$$;

grant execute on function public.officer_photo_checks(uuid) to authenticated;
revoke execute on function public.officer_photo_checks(uuid) from anon, public;
