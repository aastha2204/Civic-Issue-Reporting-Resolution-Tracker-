-- ============================================================================
-- 008_backfill.sql
-- Civic Issue Tracker - Road Classification Backfill & Issue Recomputation
-- ============================================================================
-- IMPORTANT: Run this migration AFTER roads_seed.sql has been executed in Supabase.
-- It maps existing open issues to the nearest road in the roads table and recomputes
-- all open issue scores with the updated road_class bonus.

-- 1. Update road_class for all issues based on nearest road within 25 meters
update public.issues
set road_class = public.road_class_at(
  extensions.st_y(location::extensions.geometry),
  extensions.st_x(location::extensions.geometry)
);

-- 2. Recompute priority scores for all open issues
select public.recompute_all_open_issues();
