# Civic Issue Tracker Database & Scoring Documentation

This document provides a plain-English guide to the database architecture, tables, and mathematical scoring functions powering the Civic Issue Tracker.

---

## 1. Tables Overview

### `wards`
- **Purpose**: Represents municipal administrative units (zones).
- **Key Columns**:
  - `name`: Ward title (e.g. "Ward 101 - Shanti Nagar").
  - `population`: Resident count (simulated mock value).
  - `density_score`: Population density rank from 0 (sparse) to 4 (densely populated).
  - `centre`: Geographic coordinates (`geography(Point, 4326)`) of the ward center.
  - `is_simulated`: Always `true` for demo/mock wards to ensure data honesty.

### `departments`
- **Purpose**: Government bodies responsible for executing civic fixes.
- **Key Columns**:
  - `name`: Department name (`Roads & Infrastructure`, `Solid Waste Management`, `Water Supply & Sewerage`).

### `profiles`
- **Purpose**: Extends Supabase `auth.users` with civic roles and assignments.
- **Key Columns**:
  - `id`: Foreign key matching `auth.users(id)`.
  - `display_name`: Name or pseudonym of the user.
  - `role`: Role rank (`citizen`, `officer`, `admin`). Protected against self-escalation.
  - `department_id` & `ward_id`: Department and jurisdiction ward assigned to officers.

### `categories`
- **Purpose**: Defines civic issue types, baseline hazard weights, SLAs, and weather sensitivities.
- **Key Columns**:
  - `key`: Identifier (e.g. `pothole`, `open_manhole`, `waterlogging`).
  - `base_weight`: Hazard factor between 0.0 and 1.0 (e.g., `open_manhole` = 1.0, `pothole` = 0.8).
  - `sla_hours`: Target turnaround time in hours (24h to 168h).
  - `max_weather_boost`: Maximum boost applied during heavy storms (e.g., `waterlogging` = +15).

### `issues`
- **Purpose**: The core civic problem record shown on the public map and ranking queue.
- **Key Columns**:
  - `location`: Exact geographic coordinates (`geography(Point, 4326)`).
  - `road_class`: Road type (`main`, `secondary`, `local`). Main roads receive higher exposure points.
  - `status`: Current state (`reported` $\rightarrow$ `verified` $\rightarrow$ `assigned` $\rightarrow$ `in_progress` $\rightarrow$ `resolved`, or `reopened`).
  - `unique_reporters`: Count of distinct citizens who filed reports or upvoted ("I'm affected too").
  - `reopen_count`: Number of times citizens rejected a fix.
  - `priority_score`: Calculated priority rank from 0 to 100.
  - `priority_band`: `High` (70–100), `Medium` (40–69), or `Low` (<40).
  - `reasons_text`: Plain-English explanation of why this issue received its priority score.

### `reports`
- **Purpose**: Individual complaints submitted by citizens (including initial reports and duplicates).
- **Key Columns**:
  - `issue_id`: The parent issue this report is attached to.
  - `user_id`: Submitting user UUID (hidden from public view via `public_issue_reports`).
  - `is_anonymous`: Whether the citizen chose to conceal their name publicly.
  - `photo_url`: URL of the submitted photo evidence in `report-photos` storage.
  - `report_location` & `photo_location`: Coordinates for spatial verification.

### `upvotes`
- **Purpose**: Represents citizen "I'm affected too" endorsements.
- **Key Columns**:
  - `issue_id` + `user_id`: Composite primary key ensuring one upvote per user per issue.

### `status_history`
- **Purpose**: Immutable audit timeline logging every transition in an issue's lifecycle.
- **Key Columns**:
  - `issue_id`: Related issue.
  - `status`: New status value.
  - `changed_by`: UUID of the user or officer who triggered the change.
  - `note`: Audit description.

### `resolutions`
- **Purpose**: Officer proof-of-work records confirming an issue has been fixed.
- **Key Columns**:
  - `officer_id`: Submitting municipal official.
  - `after_photo_url`: Photo of the repaired site.
  - `after_photo_location`: Geotag of the photo.
  - `distance_from_issue_m`: Calculated distance from original issue (must be within 100m).

### `fix_confirmations`
- **Purpose**: Citizen verification voting on whether a resolution actually resolved the problem.
- **Key Columns**:
  - `is_fixed`: `true` (fix confirmed) or `false` (citizen disputes the fix).

### `places`
- **Purpose**: Spatial reference landmarks that amplify public vulnerability.
- **Key Columns**:
  - `kind`: `school`, `hospital`, `bus_stop`, `market`.
  - `location`: Point coordinates used for proximity calculations (e.g., within 200m).

### `weather_cache`
- **Purpose**: Cached weather conditions per ward from Open-Meteo.
- **Key Columns**:
  - `ward_id`: Associated ward.
  - `rain_intensity`: Normalized precipitation intensity from `0.0` (dry) to `1.0` (severe rain).

### `app_settings`
- **Purpose**: Global key-value operational flags.
- **Key Columns**:
  - `simulate_heavy_rain`: Toggle (`'true'` / `'false'`) allowing judges and testers to preview storm escalation behavior without waiting for real rain.

---

## 2. Scoring Functions Explained

All scoring logic lives in `supabase/migrations/002_scoring.sql`.

### 1. `severity_points(category, level)` $\rightarrow$ Max 30 pts
- **Logic**: Evaluates intrinsic physical danger.
- **Formula**:
  $$\text{Severity Points} = \text{round}(\text{Category Base Weight} \times \text{Level Multiplier} \times 30)$$
  - Minor: $0.50$
  - Moderate: $0.75$
  - Dangerous: $1.00$
- **Example**: A dangerous pothole with base weight $0.8$ yields $0.8 \times 1.0 \times 30 = 24$ points (or adjusted by category level).

### 2. `location_points(issue_id)` $\rightarrow$ Max 25 pts
- **Logic**: Evaluates who is exposed to the danger using spatial proximity to sensitive landmarks:
  - School within 200m: **+8** (child safety)
  - Hospital within 200m: **+8** (emergency access / ambulances)
  - Bus stop within 100m: **+3** (pedestrian density)
  - Market within 150m: **+4** (commercial foot traffic)
  - Road class: **+6** for main road, **+3** for secondary road, **+0** for local
  - Ward density score: **+0 to +4**
- **Cap**: The total sum is capped at **25 points**.

### 3. `frequency_points(reporters)` $\rightarrow$ Max 25 pts
- **Logic**: Community amplification based on verified distinct citizens (reports + upvotes):
  - 1 reporter: **0 pts**
  - 2 to 3 reporters: **10 pts**
  - 4 to 6 reporters: **18 pts**
  - 7+ reporters: **25 pts**

### 4. `age_points(days)` $\rightarrow$ Max 20 pts
- **Logic**: Prevents bureaucratic stagnation by adding urgency to neglected issues:
  - **1 point** per calendar day open.
  - Capped at **20 points**.

### 5. `context_boost(category, weather_intensity, road_class)` $\rightarrow$ Max +15 pts
- **Logic**: Dynamic real-time amplification based on environmental conditions:
  - Waterlogging: up to **+15** during heavy rain.
  - Pothole: up to **+8** (rain hides submerged potholes).
  - Garbage: up to **+8** (standing water leaches waste into drinking supplies).
  - Broken streetlight: **+5** on main roads (nighttime accident prevention).
- **Cap**: Capped at **15 points**.

### 6. `calculate_priority_score(...)` $\rightarrow$ Returns JSON & Reasons
- **Logic**: Pure mathematical formula aggregating all dimensions:
  $$\text{Base Score} = \min(\text{Severity} + \text{Location} + \text{Frequency} + \text{Age}, 100)$$
  $$\text{Priority Score} = \min(\text{Base Score} + \text{Context Boost} + \text{Equity} + \text{Reopen Boost}, 100)$$
  - Reopen boost = $\min(5 \times \text{reopen\_count}, 15)$
  - Priority Bands:
    - **High**: $70 - 100$ (Target SLA: 48 hours)
    - **Medium**: $40 - 69$ (Target SLA: 7 days)
    - **Low**: $< 40$ (Batched maintenance)
- **Radical Transparency**: Generates `reasons_text` detailing every non-zero component (e.g. *"High priority (73/100): dangerous pothole (+26), near school and main road (+22), 6 separate reports (+18), open 7 days (+7)."*).

### 7. `recompute_issue_score(issue_id)`
- Pulls live database state, calculates days open, checks the heavy rain toggle, gathers unique reporters, runs `calculate_priority_score`, and updates the `issues` row.
- Declared `SECURITY DEFINER` so ordinary citizens filing reports trigger full score recalculation without needing broad administrative table privileges.

### 8. `find_nearby_open_issue(lat, lng, category)`
- Uses PostGIS spatial indexing (`ST_DWithin`) to find existing open issues within `merge_radius_meters()` ($100\text{ m}$).
- Powers the deduplication workflow: instead of creating noisy duplicate tickets, new reports attach to existing issues, increasing the unique reporter count and recomputing priority.

---

## 3. Migration Execution Order in Supabase SQL Editor

Paste and run the migration files in this exact sequence:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_scoring.sql`
3. `supabase/migrations/003_security.sql`
4. `supabase/migrations/004_tests.sql`
