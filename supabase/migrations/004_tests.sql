-- ============================================================================
-- 004_tests.sql
-- Civic Issue Tracker - Test Verification Suite for docs/SPEC.md Cases
-- ============================================================================
--
-- This script executes calculate_priority_score for each of the 4 canonical
-- test cases specified in docs/SPEC.md:
--   Case 1: Pothole (sev 26, loc 22, 6 rep, 7 days, weather 0)     => 73, High
--   Case 2: Waterlogging (sev 24, loc 20, 3 rep, 1 day, weather 15) => 70, High
--   Case 3: Waterlogging (sev 24, loc 20, 3 rep, 1 day, weather 0)  => 55, Medium
--   Case 4: Pothole (sev 8, loc 3, 1 rep, 10 days, weather 0)       => 21, Low
-- ============================================================================

set search_path = public, extensions;

with test_inputs as (
  select
    1 as test_id,
    'Case 1: Pothole (Dangerous, Near School/Main Rd, 6 Reports, 7 Days)' as scenario,
    26 as sev_pts,
    22 as loc_pts,
    6 as reporters,
    7 as days_open,
    0 as context_pts,
    0 as equity_pts,
    0 as reopen_count,
    73 as expected_total,
    'High' as expected_band
  union all
  select
    2 as test_id,
    'Case 2: Waterlogging with Heavy Rain (Sev 24, Loc 20, 3 Reports, 1 Day, Weather 1.0)' as scenario,
    24 as sev_pts,
    20 as loc_pts,
    3 as reporters,
    1 as days_open,
    15 as context_pts,
    0 as equity_pts,
    0 as reopen_count,
    70 as expected_total,
    'High' as expected_band
  union all
  select
    3 as test_id,
    'Case 3: Same Waterlogging with Dry Weather (Sev 24, Loc 20, 3 Reports, 1 Day, Weather 0.0)' as scenario,
    24 as sev_pts,
    20 as loc_pts,
    3 as reporters,
    1 as days_open,
    0 as context_pts,
    0 as equity_pts,
    0 as reopen_count,
    55 as expected_total,
    'Medium' as expected_band
  union all
  select
    4 as test_id,
    'Case 4: Minor Pothole (Sev 8, Loc 3, 1 Report, 10 Days)' as scenario,
    8 as sev_pts,
    3 as loc_pts,
    1 as reporters,
    10 as days_open,
    0 as context_pts,
    0 as equity_pts,
    0 as reopen_count,
    21 as expected_total,
    'Low' as expected_band
),
test_results as (
  select
    t.test_id,
    t.scenario,
    t.expected_total,
    (res->>'total')::int as actual_total,
    t.expected_band,
    res->>'band' as actual_band,
    case
      when (res->>'total')::int = t.expected_total and res->>'band' = t.expected_band then 'PASS'
      else 'FAIL'
    end as status,
    res->>'reasons_text' as generated_reasons_text
  from test_inputs t
  cross join lateral public.calculate_priority_score(
    t.sev_pts,
    t.loc_pts,
    t.reporters,
    t.days_open,
    t.context_pts,
    t.equity_pts,
    t.reopen_count
  ) as res
)
select
  test_id,
  status,
  scenario,
  expected_total,
  actual_total,
  expected_band,
  actual_band,
  generated_reasons_text
from test_results
order by test_id;
