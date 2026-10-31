# Civic Issue Tracker Spec

## Purpose
A platform that does not just collect complaints. It decides what to fix first, shows its reasoning, and proves fixes really happened.

## Roles
citizen (can report anonymously), officer (assigned to a department and ward), admin.

## Status pipeline
reported -> verified -> assigned -> in_progress -> resolved. Also: reopened (citizen disputes a fix). Every status change is stored with a timestamp for the issue timeline.

## Categories
pothole, waterlogging, garbage, broken_streetlight, open_manhole, water_leak, drainage, damaged_road_marking, other.
Each has a severity base weight (0-1) and an SLA in hours. Starting weights: open_manhole 1.0, pothole 0.8, waterlogging 0.8, water_leak 0.7, garbage 0.5, broken_streetlight 0.6, drainage 0.6, damaged_road_marking 0.3, other 0.4.

## Priority Score
Priority = Base + Context boost + Equity adjustment + Reopen boost, capped at 100.
Base (max 100) = Severity (30) + Location and exposure (25) + Frequency (25) + Age (20).
- Severity (max 30) = category base weight x level multiplier (minor 0.5 / moderate 0.75 / dangerous 1.0) x 30. Level chosen by the citizen, or suggested by AI and overridable.
- Location and exposure (max 25): school or hospital within 200 m, road class (main road scores higher), bus stop, market, ward population density (mock data, labelled simulated). Cap 25.
- Frequency (max 25): unique reporters including "I'm affected too" upvotes. 1 = 0, 2-3 = 10, 4-6 = 18, 7+ = 25.
- Age (max 20): 1 point per day open, cap 20.
- Context boost (max +15), weather from Open-Meteo (no API key), by category: waterlogging up to +15 (heavy rain in last 24h or forecast), pothole up to +8, garbage up to +8, broken_streetlight up to +5 (main road only, not weather). Weather intensity is 0 to 1. Fetch once per ward area and cache it. A "Simulate heavy rain" demo toggle forces intensity to 1.
- Equity adjustment (max +10, optional, built later): low-reporting but high-risk wards.
- Reopen boost: +5 per confirmed "not fixed" dispute, cap +15.
- Every modifier must appear in the reasons text.

## Priority bands
High 70-100 (target 48 hours), Medium 40-69 (7 days), Low below 40 (batched).

## Test cases the scoring function must pass
1. Pothole, severity 26, location 22, 6 reporters, 7 days, no weather => 73, High.
2. Waterlogging, severity 24, location 20, 3 reporters, 1 day, weather 1.0 => base 55 + 15 = 70, High.
3. Same waterlogging, weather 0 => 55, Medium.
4. Pothole, severity 8, location 3, 1 reporter, 10 days => 21, Low.

## Reasons text
Every score stores a breakdown and a sentence, e.g.
"High priority (73/100): dangerous pothole (+26), near a school and main road (+22), 6 separate reports (+18), open 7 days (+7)."
With weather: "... heavy rain forecast (+15)."

## Duplicate handling
MERGE_RADIUS_METERS = 100 (single config constant). A new report within the radius of an open issue of the same category asks "Is this the same issue?". If yes, attach it to the existing issue as a unique reporter and recompute the score. Duplicates are a signal, never closed as noise. Frequency counts unique users only.

## Verified resolution
Officer must upload an after-photo within 100 m of the original location. Citizen is asked "Is it really fixed? Yes / No". If enough say No, the issue reopens with a score boost. Public reopen rate is shown per ward and department.

## Anti-abuse
Photo required, photo location must match report location, per-user rate limit, unique-user frequency, AI spam flag (later).

## Data honesty
Ward population and ward boundaries are simulated unless real data is used. Label them as simulated in the UI.

## Tech stack
Next.js (App Router, TypeScript), Tailwind, Supabase (Postgres + PostGIS, auth, storage, realtime), Leaflet + OpenStreetMap, Leaflet.heat, Open-Meteo, Gemini API, Telegram bot, Vercel.

## Rules for the agent
- Keep the scoring logic in ONE place, readable, with comments, because I must explain it to judges.
- Mobile-first UI. Never commit secrets.
- Small working steps. After each task, tell me exactly how to run and test it.
