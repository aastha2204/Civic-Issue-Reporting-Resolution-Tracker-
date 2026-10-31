/**
 * scripts/seed-demo.mjs
 * Civic Issue Tracker - Reproducible Demo Data Seed & Safe Reset Engine
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-demo.mjs --yes
 *   node --env-file=.env.local scripts/seed-demo.mjs --reset --yes
 *
 * Strict Rules:
 *   - Plain Node ESM, local execution only.
 *   - Uses SUPABASE_SERVICE_ROLE_KEY to perform setup without exposing secrets to client.
 *   - Idempotent and tracked via demo_seed_issues and demo_seed_users tables.
 *   - All scoring runs through database recompute functions; no scores are set by hand.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// 1. CLI FLAGS & ENVIRONMENT VALIDATION
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const hasYesFlag = args.includes("--yes");
const isResetMode = args.includes("--reset");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("==================================================================");
console.log(" Civic Issue Tracker - Demo Seeder");
console.log("==================================================================");
console.log(`Supabase URL: ${supabaseUrl || "NOT SET"}`);
console.log(`Mode:         ${isResetMode ? "RESET (Teardown demo data)" : "SEED (Generate ~40 demo issues)"}`);
console.log("------------------------------------------------------------------");

if (!hasYesFlag) {
  console.error("ERROR: Refusing to run without the --yes flag.");
  console.error("Please run with explicit confirmation:");
  if (isResetMode) {
    console.error("  npm run seed:demo:reset -- --yes");
  } else {
    console.error("  npm run seed:demo -- --yes");
  }
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Ensure .env.local exists and contains valid service-role credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// -----------------------------------------------------------------------------
// 2. DETERMINISTIC PSEUDO-RANDOM NUMBER GENERATOR (Mulberry32)
// -----------------------------------------------------------------------------

function createPrng(seed = 42) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createPrng(20261006);

function randomChoice(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randomFloat(min, max) {
  return min + rng() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomFloat(min, max + 1));
}

// -----------------------------------------------------------------------------
// 3. SPATIAL GEOMETRY & JITTER HELPERS (around JIIT Sector 62, Noida)
// -----------------------------------------------------------------------------

/**
 * Offsets a coordinate by dx, dy meters (roughly 1 deg lat = 111,000m).
 */
function offsetMeters(lat, lng, dxMeters, dyMeters) {
  const dLat = dyMeters / 111000;
  const dLng = dxMeters / (111000 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number((lat + dLat).toFixed(6)),
    lng: Number((lng + dLng).toFixed(6)),
  };
}

function jitterPoint(lat, lng, minMeters = 10, maxMeters = 60) {
  const dist = randomFloat(minMeters, maxMeters);
  const angle = randomFloat(0, Math.PI * 2);
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist;
  return offsetMeters(lat, lng, dx, dy);
}

function toWktPoint(lat, lng) {
  return `POINT(${lng} ${lat})`;
}

function parsePoint(val) {
  if (!val) return null;
  if (typeof val === "object" && Array.isArray(val.coordinates)) {
    return { lng: val.coordinates[0], lat: val.coordinates[1] };
  }
  if (typeof val === "string") {
    const match = val.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
  }
  return null;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// -----------------------------------------------------------------------------
// 4. RESET ROUTINE
// -----------------------------------------------------------------------------

async function runReset() {
  console.log("\n[Reset] Initiating demo data teardown...");

  // 1. Get tracked demo issue IDs
  const { data: demoIssues, error: issuesErr } = await supabase
    .from("demo_seed_issues")
    .select("issue_id");

  if (issuesErr) {
    console.error("[Reset] Error checking demo_seed_issues:", issuesErr.message);
  }

  const issueIds = (demoIssues || []).map((row) => row.issue_id);
  console.log(`[Reset] Found ${issueIds.length} tracked demo issues to purge.`);

  // 2. Delete issues (CASCADE cleans reports, upvotes, resolutions, fix_confirmations, status_history, escalations)
  let deletedIssuesCount = 0;
  if (issueIds.length > 0) {
    const { error: delIssuesErr, count } = await supabase
      .from("issues")
      .delete({ count: "exact" })
      .in("id", issueIds);

    if (delIssuesErr) {
      console.error("[Reset] Error deleting issues:", delIssuesErr.message);
    } else {
      deletedIssuesCount = count ?? issueIds.length;
    }
  }

  // 3. Clear tracked demo users from auth
  const { data: demoUsers, error: usersErr } = await supabase
    .from("demo_seed_users")
    .select("user_id");

  if (usersErr) {
    console.error("[Reset] Error checking demo_seed_users:", usersErr.message);
  }

  const userIds = (demoUsers || []).map((row) => row.user_id);
  console.log(`[Reset] Found ${userIds.length} synthetic demo users to purge.`);

  let deletedUsersCount = 0;
  for (const uid of userIds) {
    try {
      const { error: delUserErr } = await supabase.auth.admin.deleteUser(uid);
      if (!delUserErr) deletedUsersCount++;
    } catch {
      // Ignored if user already missing
    }
  }

  // 4. Clean storage files under seed/ prefixes
  let deletedFilesCount = 0;
  const seedPhotoFiles = [
    "open_manhole.jpg",
    "pothole.jpg",
    "waterlogging.jpg",
    "water_leak.jpg",
    "garbage.jpg",
    "broken_streetlight.jpg",
    "drainage.jpg",
    "damaged_road_marking.jpg",
    "other.jpg",
  ].map((f) => `seed/${f}`);

  const { error: delReportPhotosErr } = await supabase.storage
    .from("report-photos")
    .remove(seedPhotoFiles);
  if (!delReportPhotosErr) deletedFilesCount += seedPhotoFiles.length;

  const { error: delResPhotosErr } = await supabase.storage
    .from("resolution-photos")
    .remove(["seed/fixed.jpg"]);
  if (!delResPhotosErr) deletedFilesCount += 1;

  // 5. Clean photo_checks records matching exact seed photo URLs
  const exactSeedUrls = [];
  for (const f of seedPhotoFiles) {
    const { data: pubData } = supabase.storage.from("report-photos").getPublicUrl(f);
    if (pubData?.publicUrl) exactSeedUrls.push(pubData.publicUrl);
  }
  const { data: fixedPubData } = supabase.storage
    .from("resolution-photos")
    .getPublicUrl("seed/fixed.jpg");
  if (fixedPubData?.publicUrl) exactSeedUrls.push(fixedPubData.publicUrl);

  if (exactSeedUrls.length > 0) {
    await supabase.from("photo_checks").delete().in("photo_url", exactSeedUrls);
  }

  // 6. Clear tracking tables
  await supabase.from("demo_seed_issues").delete().neq("issue_id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("demo_seed_users").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");

  console.log(`[Reset] Reset complete.`);
  console.log(`  - Issues deleted:       ${deletedIssuesCount}`);
  console.log(`  - Auth users removed:   ${deletedUsersCount}`);
  console.log(`  - Storage files purged: ${deletedFilesCount}`);
}

// -----------------------------------------------------------------------------
// 5. SEED ROUTINE
// -----------------------------------------------------------------------------

async function runSeed() {
  // 1. Guard check: simulate_heavy_rain MUST be 'false'
  console.log("\n[Pre-flight] Verifying application settings...");
  const { data: rainSetting, error: settingErr } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "simulate_heavy_rain")
    .maybeSingle();

  if (settingErr) {
    console.error("[Pre-flight] Failed to check app_settings:", settingErr.message);
  }

  if (rainSetting?.value === "true") {
    console.error("\n==================================================================");
    console.error("FATAL: 'simulate_heavy_rain' is currently set to 'true'.");
    console.error("Per instructions, please switch it off first in Supabase SQL editor:");
    console.error("  UPDATE public.app_settings SET value = 'false' WHERE key = 'simulate_heavy_rain';");
    console.error("Then rerun this seed script.");
    console.error("==================================================================\n");
    process.exit(1);
  }

  // 2. Check if demo data is already active; if so, run reset first
  const { data: isActive } = await supabase.rpc("demo_data_active");
  if (isActive) {
    console.log("[Seed] Existing demo data detected. Running clean reset first...");
    await runReset();
  }

  // 3. Load database context: Wards, Departments, Officers, Places, Roads
  console.log("\n[Context] Loading database metadata...");

  const { data: wards, error: wardsErr } = await supabase.from("wards").select("*");
  if (wardsErr || !wards || wards.length === 0) {
    console.error("FATAL: No wards found in database. Seed cannot proceed.", wardsErr?.message);
    process.exit(1);
  }
  console.log(`[Context] Loaded ${wards.length} wards:`);
  for (const w of wards) {
    console.log(`  - Ward ID ${w.id}: "${w.name}" (Pop: ${w.population}, Density: ${w.density_score})`);
  }

  const { data: departments } = await supabase.from("departments").select("*");
  const deptMap = {};
  for (const d of departments || []) {
    deptMap[d.name] = d.id;
  }

  const { data: officerProfiles } = await supabase
    .from("profiles")
    .select("id, display_name, role, department_id, ward_id")
    .eq("role", "officer");

  const officers = officerProfiles || [];
  if (officers.length === 0) {
    console.warn("WARNING: No profiles with role 'officer' found. Assigned/in_progress issues will have assigned_to = null.");
  } else {
    console.log(`[Context] Found ${officers.length} real officer profiles for assignments.`);
  }

  const { data: places } = await supabase.from("places").select("*");
  const placesByKind = { school: [], hospital: [], bus_stop: [], market: [] };
  for (const p of places || []) {
    const pt = parsePoint(p.location);
    if (pt && placesByKind[p.kind]) {
      placesByKind[p.kind].push({ ...p, lat: pt.lat, lng: pt.lng });
    }
  }

  const { data: roads } = await supabase.from("roads").select("road_class, name, geom").limit(100);
  const mainRoads = [];
  for (const r of roads || []) {
    if (r.road_class === "main") mainRoads.push(r);
  }

  // 4. Create 15 Synthetic Users
  console.log("\n[Users] Generating 15 synthetic citizen accounts...");
  const fakeUserIds = [];
  for (let i = 1; i <= 15; i++) {
    const numStr = String(i).padStart(2, "0");
    const email = `seed${numStr}@seed.civic.test`;
    const password = `CivicSeedPass${numStr}!123`;

    // Attempt to create user with admin API
    const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Citizen Seed ${numStr}` },
    });

    let userId = userRes?.user?.id;
    if (userErr) {
      // If already exists, query user ID by listing
      const { data: listRes } = await supabase.auth.admin.listUsers();
      const existing = listRes?.users?.find((u) => u.email === email);
      if (existing) userId = existing.id;
    }

    if (!userId) {
      console.error(`FATAL: Failed to create or resolve seed user ${email}:`, userErr?.message);
      process.exit(1);
    }

    fakeUserIds.push(userId);
    await supabase.from("demo_seed_users").upsert({ user_id: userId });
  }
  console.log(`[Users] Registered ${fakeUserIds.length} synthetic users in demo_seed_users.`);

  // 5. Upload Seed Photos
  console.log("\n[Photos] Checking and uploading sample photos from seed/photos/...");
  const categoryKeys = [
    "pothole",
    "waterlogging",
    "garbage",
    "broken_streetlight",
    "open_manhole",
    "water_leak",
    "drainage",
    "damaged_road_marking",
    "other",
  ];

  const photoUrlByCategory = {};
  const missingPhotos = [];
  const seedPhotosDir = path.resolve(process.cwd(), "seed/photos");

  for (const cat of categoryKeys) {
    const filename = `${cat}.jpg`;
    const localPath = path.join(seedPhotosDir, filename);

    if (fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      const storagePath = `seed/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from("report-photos")
        .upload(storagePath, buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadErr) {
        console.warn(`[Photos] Failed to upload ${filename}:`, uploadErr.message);
        photoUrlByCategory[cat] = null;
        missingPhotos.push(cat);
      } else {
        const { data: pubData } = supabase.storage
          .from("report-photos")
          .getPublicUrl(storagePath);
        photoUrlByCategory[cat] = pubData?.publicUrl || null;
      }
    } else {
      photoUrlByCategory[cat] = null;
      missingPhotos.push(cat);
    }
  }

  let resolutionPhotoUrl = null;
  const fixedLocalPath = path.join(seedPhotosDir, "fixed.jpg");
  if (fs.existsSync(fixedLocalPath)) {
    const buffer = fs.readFileSync(fixedLocalPath);
    const storagePath = "seed/fixed.jpg";
    const { error: uploadErr } = await supabase.storage
      .from("resolution-photos")
      .upload(storagePath, buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (!uploadErr) {
      const { data: pubData } = supabase.storage
        .from("resolution-photos")
        .getPublicUrl(storagePath);
      resolutionPhotoUrl = pubData?.publicUrl || null;
    }
  }

  console.log(`[Photos] Uploaded photos for ${categoryKeys.length - missingPhotos.length} categories.`);
  if (missingPhotos.length > 0) {
    console.log(`[Photos] Missing category photos (set to null): ${missingPhotos.join(", ")}`);
  }
  if (resolutionPhotoUrl) {
    console.log(`[Photos] Uploaded resolution after-photo: fixed.jpg`);
  }

  // 6. Define Issue Anchors around JIIT Noida (28.6298, 77.3723)
  console.log("\n[Geocoding] Establishing spatial anchors in Noida Sector 62...");
  const fallbacksUsed = [];

  const schoolAnchor = placesByKind.school[0] || {
    lat: 28.6298,
    lng: 77.3723,
    name: "JIIT Noida / Sector 62 (Anchor Fallback)",
  };
  if (!placesByKind.school[0]) fallbacksUsed.push("School anchor fallback to JIIT");

  const waterAnchor = placesByKind.bus_stop[0]
    ? { lat: placesByKind.bus_stop[0].lat + 0.002, lng: placesByKind.bus_stop[0].lng - 0.001 }
    : { lat: 28.6255, lng: 77.3742 };

  const marketAnchor = placesByKind.market[0] || placesByKind.bus_stop[1] || {
    lat: 28.634,
    lng: 77.3693,
    name: "Sector 62 Market area",
  };
  if (!placesByKind.market[0]) fallbacksUsed.push("Market anchor fallback");

  const hospitalAnchor = placesByKind.hospital[0] || {
    lat: 28.6183,
    lng: 77.3739,
    name: "Fortis Hospital area",
  };
  if (!placesByKind.hospital[0]) fallbacksUsed.push("Hospital anchor fallback");

  const mainRoadAnchor = { lat: 28.6273, lng: 77.3934 }; // FNG Expressway stretch

  // 7. Plan the 40 Issues
  // Status breakdown: 14 reported, 5 verified, 5 assigned, 4 in_progress, 8 resolved, 2 reopened, 2 overdue reported.
  // Uneven Ward allocation: ~17 in Ward 101, ~15 in Ward 102, ~8 in Ward 103
  // All timestamps strictly <= (now - 2 hours)
  const now = Date.now();
  const MIN_AGE_HOURS = 2; // Strict requirement: no created_at later than now - 2 hours
  const MS_PER_HOUR = 3600 * 1000;
  const MS_PER_DAY = 24 * MS_PER_HOUR;

  // Rate limiter track: ensure no user has > 5 reports in any 1-hour window
  const userReportTimestamps = {};
  for (const uid of fakeUserIds) userReportTimestamps[uid] = [];

  function pickUserForReport(desiredTimestampMs) {
    // Shuffle users and find one with < 5 reports within [timestamp - 1h, timestamp + 1h]
    const candidates = [...fakeUserIds].sort(() => rng() - 0.5);
    for (const uid of candidates) {
      const history = userReportTimestamps[uid];
      const countInHour = history.filter(
        (t) => Math.abs(t - desiredTimestampMs) < MS_PER_HOUR
      ).length;
      if (countInHour < 4) {
        history.push(desiredTimestampMs);
        return uid;
      }
    }
    // Fallback if tight
    const uid = candidates[0];
    userReportTimestamps[uid].push(desiredTimestampMs);
    return uid;
  }

  // Category to Department mapping (from 005_submit_report.sql)
  function getDeptId(cat) {
    if (["pothole", "open_manhole", "broken_streetlight", "damaged_road_marking", "other"].includes(cat)) {
      return deptMap["Roads & Infrastructure"];
    }
    if (cat === "garbage") {
      return deptMap["Solid Waste Management"];
    }
    if (["waterlogging", "water_leak", "drainage"].includes(cat)) {
      return deptMap["Water Supply & Sewerage"];
    }
    return deptMap["Roads & Infrastructure"];
  }

  // Find nearest ward by coordinate
  function getNearestWard(lat, lng) {
    let bestWard = wards[0];
    let bestDist = Infinity;
    for (const w of wards) {
      const pt = parsePoint(w.centre);
      if (pt) {
        const d = distanceMeters(lat, lng, pt.lat, pt.lng);
        if (d < bestDist) {
          bestDist = d;
          bestWard = w;
        }
      }
    }
    return bestWard.id;
  }

  // Pre-planned issue specifications
  const plannedIssues = [
    // --- Cluster 1: Pothole cluster near school (Ward 101/102) ---
    {
      cat: "pothole",
      sev: "dangerous",
      desc: "Deep crater on school approach road, hazard to bicycles and vans",
      anchor: schoolAnchor,
      targetReporters: 7, // Highly reported issue (passes spec case: 6-7 reporters)
      status: "in_progress",
      ageDays: 7,
    },
    {
      cat: "pothole",
      sev: "moderate",
      desc: "Multiple potholes forming near pedestrian crossing",
      anchor: schoolAnchor,
      targetReporters: 4,
      status: "assigned",
      ageDays: 5,
    },
    {
      cat: "pothole",
      sev: "minor",
      desc: "Surface asphalt peeling off along school bus bay",
      anchor: schoolAnchor,
      targetReporters: 2,
      status: "verified",
      ageDays: 3,
    },
    {
      cat: "pothole",
      sev: "moderate",
      desc: "Pothole in middle of service lane",
      anchor: schoolAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 1,
    },

    // --- Cluster 2: Waterlogging cluster in low-lying area ---
    {
      cat: "waterlogging",
      sev: "dangerous",
      desc: "Severe water accumulation submerging pavement and curb",
      anchor: waterAnchor,
      targetReporters: 3,
      status: "reported",
      ageDays: 4,
      isOverdue: true, // SLA is 24h -> 4 days open breaches Level 2!
    },
    {
      cat: "waterlogging",
      sev: "moderate",
      desc: "Stagnant stormwater blocking residential gate access",
      anchor: waterAnchor,
      targetReporters: 2,
      status: "in_progress",
      ageDays: 2,
    },
    {
      cat: "waterlogging",
      sev: "moderate",
      desc: "Rain runoff ponding across two traffic lanes",
      anchor: waterAnchor,
      targetReporters: 1,
      status: "resolved",
      ageDays: 6,
      resolvedDaysAgo: 1,
    },

    // --- Cluster 3: Garbage cluster near market/bus stop ---
    {
      cat: "garbage",
      sev: "moderate",
      desc: "Overflowing commercial garbage mound attracting strays",
      anchor: marketAnchor,
      targetReporters: 5,
      status: "assigned",
      ageDays: 6,
    },
    {
      cat: "garbage",
      sev: "minor",
      desc: "Uncollected plastic crates and vegetable refuse",
      anchor: marketAnchor,
      targetReporters: 2,
      status: "reported",
      ageDays: 1,
    },
    {
      cat: "garbage",
      sev: "dangerous",
      desc: "Rotting waste pile obstructing main market footpath",
      anchor: marketAnchor,
      targetReporters: 3,
      status: "resolved",
      ageDays: 5,
      resolvedDaysAgo: 2,
    },

    // --- Cluster 4: Broken streetlight stretch on main road ---
    {
      cat: "broken_streetlight",
      sev: "moderate",
      desc: "Non-functional sodium vapor lamp pole on highway median",
      anchor: mainRoadAnchor,
      targetReporters: 2,
      status: "reported",
      ageDays: 5, // SLA 96h -> 5 days breaches Level 1
      isOverdue: true,
    },
    {
      cat: "broken_streetlight",
      sev: "dangerous",
      desc: "Flickering high-mast lamp causing dark blindspot at junction",
      anchor: mainRoadAnchor,
      targetReporters: 3,
      status: "assigned",
      ageDays: 3,
    },
    {
      cat: "broken_streetlight",
      sev: "minor",
      desc: "Damaged junction box with exposed wires on light post",
      anchor: mainRoadAnchor,
      targetReporters: 1,
      status: "resolved",
      ageDays: 8,
      resolvedDaysAgo: 3,
    },

    // --- Open Manhole near hospital ---
    {
      cat: "open_manhole",
      sev: "dangerous",
      desc: "Broken concrete manhole slab near emergency ambulance bay",
      anchor: hospitalAnchor,
      targetReporters: 4,
      status: "reported",
      ageDays: 2, // SLA 24h -> 2 days breaches Level 1
      isOverdue: true,
    },
    {
      cat: "open_manhole",
      sev: "dangerous",
      desc: "Uncovered stormwater drain opening on pedestrian sidewalk",
      anchor: hospitalAnchor,
      targetReporters: 3,
      status: "in_progress",
      ageDays: 1,
    },

    // --- Reopened issues (2 issues) ---
    {
      cat: "water_leak",
      sev: "moderate",
      desc: "High pressure pipeline rupture bubbling up through tarmac",
      anchor: schoolAnchor,
      targetReporters: 3,
      status: "reopened",
      ageDays: 8,
      reopenCount: 1,
    },
    {
      cat: "drainage",
      sev: "dangerous",
      desc: "Sewer backflow flooding market back alley",
      anchor: marketAnchor,
      targetReporters: 4,
      status: "reopened",
      ageDays: 10,
      reopenCount: 1,
    },

    // --- Heavily Overdue reported issues (2 issues) ---
    {
      cat: "open_manhole",
      sev: "dangerous",
      desc: "Uncovered sewer opening left unbarricaded for over a week",
      anchor: waterAnchor,
      targetReporters: 5,
      status: "reported",
      ageDays: 9, // Heavily overdue SLA breach (level 2)
      isOverdue: true,
    },
    {
      cat: "waterlogging",
      sev: "dangerous",
      desc: "Severe stagnant stormwater pool lingering for 8 days",
      anchor: marketAnchor,
      targetReporters: 4,
      status: "reported",
      ageDays: 8, // Heavily overdue SLA breach (level 2)
      isOverdue: true,
    },

    // --- Resolved issues with proof (remaining of the 8 resolved issues) ---
    {
      cat: "pothole",
      sev: "moderate",
      desc: "Filled and compacted pothole along Vishwakarma Road",
      anchor: mainRoadAnchor,
      targetReporters: 3,
      status: "resolved",
      ageDays: 9,
      resolvedDaysAgo: 2,
      hasFixConfirmation: true,
    },
    {
      cat: "garbage",
      sev: "minor",
      desc: "Cleared waste bin surround near bus depot",
      anchor: marketAnchor,
      targetReporters: 2,
      status: "resolved",
      ageDays: 7,
      resolvedDaysAgo: 3,
      hasFixConfirmation: true,
    },
    {
      cat: "water_leak",
      sev: "moderate",
      desc: "Replaced faulty valve collar on supply main",
      anchor: hospitalAnchor,
      targetReporters: 3,
      status: "resolved",
      ageDays: 6,
      resolvedDaysAgo: 1,
      hasFixConfirmation: true,
    },
    {
      cat: "drainage",
      sev: "moderate",
      desc: "Desilted culvert beneath pedestrian walkway",
      anchor: waterAnchor,
      targetReporters: 2,
      status: "resolved",
      ageDays: 8,
      resolvedDaysAgo: 4,
    },
    {
      cat: "damaged_road_marking",
      sev: "minor",
      desc: "Repainted faded zebra crossing at intersection",
      anchor: schoolAnchor,
      targetReporters: 1,
      status: "resolved",
      ageDays: 11,
      resolvedDaysAgo: 5,
    },

    // --- Singles across categories to complete ~40 issues ---
    // (Singles distributed across Ward 101, 102, and 103)
    {
      cat: "damaged_road_marking",
      sev: "minor",
      desc: "Worn lane dividing markers along express corridor",
      anchor: mainRoadAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 4,
    },
    {
      cat: "damaged_road_marking",
      sev: "moderate",
      desc: "Missing speed breaker yellow hazard lines",
      anchor: schoolAnchor,
      targetReporters: 2,
      status: "verified",
      ageDays: 3,
    },
    {
      cat: "other",
      sev: "minor",
      desc: "Fallen tree branch hanging over low voltage cable",
      anchor: hospitalAnchor,
      targetReporters: 2,
      status: "reported",
      ageDays: 2,
    },
    {
      cat: "other",
      sev: "moderate",
      desc: "Broken traffic bollard dislodged on highway shoulder",
      anchor: mainRoadAnchor,
      targetReporters: 1,
      status: "verified",
      ageDays: 1,
    },
    {
      cat: "water_leak",
      sev: "minor",
      desc: "Slow tap leakage at public water station",
      anchor: marketAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 1,
    },
    {
      cat: "water_leak",
      sev: "moderate",
      desc: "Pressurized spray from roadside pipeline joint",
      anchor: schoolAnchor,
      targetReporters: 2,
      status: "assigned",
      ageDays: 2,
    },
    {
      cat: "drainage",
      sev: "moderate",
      desc: "Clogged stormwater grate causing minor puddling",
      anchor: waterAnchor,
      targetReporters: 2,
      status: "reported",
      ageDays: 2,
    },
    {
      cat: "drainage",
      sev: "dangerous",
      desc: "Blocked culvert backing up into service lane",
      anchor: marketAnchor,
      targetReporters: 3,
      status: "verified",
      ageDays: 4,
    },
    {
      cat: "pothole",
      sev: "minor",
      desc: "Small depression in asphalt near residential gate",
      anchor: schoolAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 1,
    },
    {
      cat: "pothole",
      sev: "moderate",
      desc: "Series of surface ruts along bus turn bay",
      anchor: mainRoadAnchor,
      targetReporters: 3,
      status: "reported",
      ageDays: 3,
    },
    {
      cat: "broken_streetlight",
      sev: "minor",
      desc: "Unlit lamp post along colony connector road",
      anchor: hospitalAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 2,
    },
    {
      cat: "garbage",
      sev: "minor",
      desc: "Litter scattered near neighborhood bus bench",
      anchor: marketAnchor,
      targetReporters: 1,
      status: "reported",
      ageDays: 1,
    },
    {
      cat: "pothole",
      sev: "dangerous",
      desc: "Large cavity on hospital entry ramp",
      anchor: hospitalAnchor,
      targetReporters: 4,
      status: "in_progress",
      ageDays: 4,
    },
    {
      cat: "waterlogging",
      sev: "moderate",
      desc: "Drainage runoff ponding outside primary school gate",
      anchor: schoolAnchor,
      targetReporters: 2,
      status: "reported",
      ageDays: 2,
    },
    {
      cat: "other",
      sev: "minor",
      desc: "Loose paving stones on central pedestrian median",
      anchor: mainRoadAnchor,
      targetReporters: 1,
      status: "assigned",
      ageDays: 3,
    },
    {
      cat: "broken_streetlight",
      sev: "moderate",
      desc: "Row of 3 dark light poles on secondary ring road",
      anchor: waterAnchor,
      targetReporters: 2,
      status: "verified",
      ageDays: 3,
    },
  ];

  console.log(`[Seed] Generating ${plannedIssues.length} issues with realistic spatial clusters...`);

  const createdIssueIds = [];
  const statusCounts = {};
  const categoryCounts = {};
  const wardCounts = {};
  let totalReports = 0;
  let totalUpvotes = 0;
  let totalResolutions = 0;

  for (let idx = 0; idx < plannedIssues.length; idx++) {
    const plan = plannedIssues[idx];
    const cat = plan.cat;

    // 1. Coordinates with jitter
    const coords = jitterPoint(plan.anchor.lat, plan.anchor.lng, 10, 60);
    const locationWkt = toWktPoint(coords.lat, coords.lng);

    // 2. Ward assignment: ensure uneven spread across available wards (e.g., ~17, ~15, ~8)
    // Primary by proximity, with slight rotation for tail issues to balance
    let assignedWardId = getNearestWard(coords.lat, coords.lng);
    if (idx >= 32 && wards[2]) {
      assignedWardId = wards[2].id; // Give Ward 103 some issues
    } else if (idx % 2 === 0 && wards[1]) {
      assignedWardId = wards[1].id;
    } else if (wards[0]) {
      assignedWardId = wards[0].id;
    }

    const deptId = getDeptId(cat);

    // 3. Timestamps: all strictly before (now - 2 hours)
    // Issue age in ms: minimum 2 hours, max 12 days
    const ageHours = Math.max(MIN_AGE_HOURS, plan.ageDays * 24 + randomInt(0, 6));
    const issueCreatedAtMs = now - ageHours * MS_PER_HOUR;
    const issueCreatedAtIso = new Date(issueCreatedAtMs).toISOString();

    let resolvedAtIso = null;
    let resolvedAtMs = null;
    if (plan.status === "resolved") {
      const resolvedHoursAgo = Math.max(
        MIN_AGE_HOURS,
        (plan.resolvedDaysAgo || 1) * 24 + randomInt(0, 4)
      );
      resolvedAtMs = now - resolvedHoursAgo * MS_PER_HOUR;
      if (resolvedAtMs <= issueCreatedAtMs) {
        resolvedAtMs = issueCreatedAtMs + 12 * MS_PER_HOUR;
      }
      resolvedAtIso = new Date(resolvedAtMs).toISOString();
    }

    // Assign officer if status is assigned or in_progress
    let assignedToOfficerId = null;
    if (["assigned", "in_progress"].includes(plan.status) && officers.length > 0) {
      // Pick officer matching department or any officer
      const match = officers.find((o) => o.department_id === deptId) || officers[0];
      assignedToOfficerId = match.id;
    }

    // 4. Insert issue row with FINAL status
    const issuePayload = {
      category: cat,
      severity_level: plan.sev,
      description: plan.desc,
      location: locationWkt,
      address: `Near ${plan.anchor.name || "Noida Sector 62"}, Ward ${assignedWardId}`,
      ward_id: assignedWardId,
      department_id: deptId,
      status: plan.status,
      assigned_to: assignedToOfficerId,
      reopen_count: plan.reopenCount || 0,
      unique_reporters: 1, // Will be recomputed
      created_at: issueCreatedAtIso,
      updated_at: issueCreatedAtIso,
      resolved_at: resolvedAtIso,
    };

    const { data: newIssue, error: insertIssueErr } = await supabase
      .from("issues")
      .insert(issuePayload)
      .select("id")
      .single();

    if (insertIssueErr || !newIssue) {
      console.error(`[Seed] Error creating issue ${idx + 1}:`, insertIssueErr?.message);
      continue;
    }

    const issueId = newIssue.id;
    createdIssueIds.push(issueId);

    // Register in tracking table immediately
    await supabase.from("demo_seed_issues").insert({ issue_id: issueId });

    // 5. Replace auto-generated status_history with coherent backdated sequence
    // First, delete any trigger-inserted row for this issue
    await supabase.from("status_history").delete().eq("issue_id", issueId);

    const historyRows = [];
    const t0 = issueCreatedAtMs;

    // Always start with 'reported'
    historyRows.push({
      issue_id: issueId,
      status: "reported",
      note: "Issue reported by citizen",
      created_at: new Date(t0).toISOString(),
    });

    if (["verified", "assigned", "in_progress", "resolved", "reopened"].includes(plan.status)) {
      const t1 = t0 + Math.min(6 * MS_PER_HOUR, (now - t0 - MIN_AGE_HOURS * MS_PER_HOUR) * 0.2);
      historyRows.push({
        issue_id: issueId,
        status: "verified",
        note: "Verified by field team",
        created_at: new Date(t1).toISOString(),
      });

      if (["assigned", "in_progress", "resolved", "reopened"].includes(plan.status)) {
        const t2 = t1 + Math.min(8 * MS_PER_HOUR, (now - t1 - MIN_AGE_HOURS * MS_PER_HOUR) * 0.3);
        historyRows.push({
          issue_id: issueId,
          status: "assigned",
          changed_by: assignedToOfficerId,
          note: "Assigned to department maintenance unit",
          created_at: new Date(t2).toISOString(),
        });

        if (["in_progress", "resolved", "reopened"].includes(plan.status)) {
          const t3 = t2 + Math.min(10 * MS_PER_HOUR, (now - t2 - MIN_AGE_HOURS * MS_PER_HOUR) * 0.4);
          historyRows.push({
            issue_id: issueId,
            status: "in_progress",
            changed_by: assignedToOfficerId,
            note: "Repairs actively underway",
            created_at: new Date(t3).toISOString(),
          });

          if (["resolved", "reopened"].includes(plan.status)) {
            const tResolved = resolvedAtMs || (t3 + 12 * MS_PER_HOUR);
            historyRows.push({
              issue_id: issueId,
              status: "resolved",
              changed_by: officers[0]?.id || null,
              note: "Work completed with geotagged photographic proof",
              created_at: new Date(tResolved).toISOString(),
            });

            if (plan.status === "reopened") {
              const tReopened = tResolved + Math.min(12 * MS_PER_HOUR, (now - tResolved - MIN_AGE_HOURS * MS_PER_HOUR) * 0.5);
              historyRows.push({
                issue_id: issueId,
                status: "reopened",
                note: "Reopened by citizens: fix disputed by community inspection",
                created_at: new Date(tReopened).toISOString(),
              });
            }
          }
        }
      }
    }

    if (historyRows.length > 0) {
      await supabase.from("status_history").insert(historyRows);
    }

    // 6. Reports & Upvotes
    const numReporters = plan.targetReporters || randomInt(1, 4);
    const assignedReporters = [];

    // Distinct reporters from fake users
    for (let r = 0; r < numReporters; r++) {
      const reportTimeMs = issueCreatedAtMs + r * randomInt(15, 60) * 60 * 1000;
      // Guarantee timestamp <= now - 2h
      const safeReportTimeMs = Math.min(reportTimeMs, now - MIN_AGE_HOURS * MS_PER_HOUR);
      const reporterUid = pickUserForReport(safeReportTimeMs);
      assignedReporters.push(reporterUid);

      const repCoord = jitterPoint(coords.lat, coords.lng, 5, 25);
      const photoUrl = photoUrlByCategory[cat] || null;

      const reportPayload = {
        issue_id: issueId,
        user_id: reporterUid,
        is_anonymous: r % 2 === 1,
        on_behalf: false,
        description: r === 0 ? plan.desc : `Follow-up report: issue affects daily commute (${plan.desc})`,
        photo_url: photoUrl,
        report_location: toWktPoint(repCoord.lat, repCoord.lng),
        photo_location: photoUrl ? toWktPoint(repCoord.lat, repCoord.lng) : null,
        created_at: new Date(safeReportTimeMs).toISOString(),
      };

      const { error: repErr } = await supabase.from("reports").insert(reportPayload);
      if (!repErr) totalReports++;
    }

    // Occasional upvotes ("I am affected too") from other fake users
    if (plan.targetReporters > 3) {
      const extraUpvoters = fakeUserIds.filter((uid) => !assignedReporters.includes(uid)).slice(0, 2);
      for (const upUid of extraUpvoters) {
        const { error: upErr } = await supabase.from("upvotes").insert({
          issue_id: issueId,
          user_id: upUid,
          created_at: new Date(issueCreatedAtMs + 3600000).toISOString(),
        });
        if (!upErr) totalUpvotes++;
      }
    }

    // 7. Resolutions & Fix Confirmations
    if (plan.status === "resolved" || plan.status === "reopened") {
      const resCoords = jitterPoint(coords.lat, coords.lng, 5, 30);
      const distMeters = distanceMeters(coords.lat, coords.lng, resCoords.lat, resCoords.lng);

      const resPayload = {
        issue_id: issueId,
        officer_id: officers[0]?.id || null,
        after_photo_url: resolutionPhotoUrl,
        after_photo_location: toWktPoint(resCoords.lat, resCoords.lng),
        distance_from_issue_m: distMeters,
        created_at: resolvedAtIso || new Date(issueCreatedAtMs + 24 * MS_PER_HOUR).toISOString(),
      };

      const { error: resErr } = await supabase.from("resolutions").insert(resPayload);
      if (!resErr) totalResolutions++;

      // Fix confirmations for 3 of the resolved issues
      if (plan.hasFixConfirmation && assignedReporters.length > 0) {
        await supabase.from("fix_confirmations").insert({
          issue_id: issueId,
          user_id: assignedReporters[0],
          is_fixed: true,
          created_at: new Date(now - MIN_AGE_HOURS * MS_PER_HOUR).toISOString(),
        });
      }

      // Reopened dispute votes (2 false votes trigger reopen)
      if (plan.status === "reopened" && assignedReporters.length >= 2) {
        await supabase.from("fix_confirmations").insert([
          {
            issue_id: issueId,
            user_id: assignedReporters[0],
            is_fixed: false,
            created_at: new Date(now - (MIN_AGE_HOURS + 1) * MS_PER_HOUR).toISOString(),
          },
          {
            issue_id: issueId,
            user_id: assignedReporters[1],
            is_fixed: false,
            created_at: new Date(now - MIN_AGE_HOURS * MS_PER_HOUR).toISOString(),
          },
        ]);
      }
    }

    // Track metrics
    statusCounts[plan.status] = (statusCounts[plan.status] || 0) + 1;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    wardCounts[assignedWardId] = (wardCounts[assignedWardId] || 0) + 1;
  }

  // 8. Call recompute_issue_score for EVERY seeded issue
  console.log("\n[Scoring] Recalculating priority scores through the database engine...");
  for (const id of createdIssueIds) {
    const { error: scoreErr } = await supabase.rpc("recompute_issue_score", {
      p_issue_id: id,
    });
    if (scoreErr) {
      console.warn(`[Scoring] recompute_issue_score warning on ${id}:`, scoreErr.message);
    }
  }

  // 9. Run SLA Escalation Processor
  console.log("[SLA] Running automated SLA escalation evaluator (run_sla_escalation)...");
  const { data: slaResult, error: slaErr } = await supabase.rpc("run_sla_escalation");
  if (slaErr) {
    console.warn("[SLA] run_sla_escalation error:", slaErr.message);
  } else {
    console.log(`[SLA] Escalations updated:`, JSON.stringify(slaResult || {}));
  }

  // 10. Call recompute_all_open_issues() to ensure city-wide equity score consistency
  console.log("[Equity] Running recompute_all_open_issues() for city-wide score and equity parity...");
  const { error: allOpenErr } = await supabase.rpc("recompute_all_open_issues");
  if (allOpenErr) {
    console.warn("[Equity] recompute_all_open_issues error:", allOpenErr.message);
  }

  // 11. Fetch final priority bands and escalations for summary table
  const { data: finalIssues } = await supabase
    .from("issues")
    .select("priority_band")
    .in("id", createdIssueIds);

  const bandCounts = { High: 0, Medium: 0, Low: 0 };
  for (const fi of finalIssues || []) {
    if (bandCounts[fi.priority_band] !== undefined) {
      bandCounts[fi.priority_band]++;
    }
  }

  const { data: finalEscalations } = await supabase
    .from("escalations")
    .select("id, level")
    .in("issue_id", createdIssueIds);

  // 12. Print Final Summary Table
  console.log("\n==================================================================");
  console.log(" SEEDING SUMMARY REPORT");
  console.log("==================================================================");
  console.log(`Total Issues Created:      ${createdIssueIds.length}`);
  console.log(`Total Citizen Reports:     ${totalReports}`);
  console.log(`Total Upvotes ("Affected"): ${totalUpvotes}`);
  console.log(`Total Resolutions Added:   ${totalResolutions}`);
  console.log(`Active SLA Escalations:    ${finalEscalations?.length || 0}`);

  console.log("\n--- Issues by Status ---");
  for (const [st, c] of Object.entries(statusCounts)) {
    console.log(`  - ${st.padEnd(14)}: ${c}`);
  }

  console.log("\n--- Issues by Category ---");
  for (const [cat, c] of Object.entries(categoryCounts)) {
    console.log(`  - ${cat.padEnd(24)}: ${c}`);
  }

  console.log("\n--- Issues by Ward ---");
  for (const w of wards) {
    const c = wardCounts[w.id] || 0;
    console.log(`  - Ward ${w.id} (${w.name}): ${c} issues (Pop: ${w.population})`);
  }

  console.log("\n--- Issues by Priority Band ---");
  for (const [b, c] of Object.entries(bandCounts)) {
    console.log(`  - ${b.padEnd(8)}: ${c}`);
  }

  if (missingPhotos.length > 0) {
    console.log(`\nNote: Missing category photos defaulted to null: ${missingPhotos.join(", ")}`);
  }
  if (fallbacksUsed.length > 0) {
    console.log(`Note: Spatial anchor fallbacks utilized: ${fallbacksUsed.join("; ")}`);
  }
  console.log("==================================================================\n");
}

// -----------------------------------------------------------------------------
// 6. MAIN EXECUTION ROUTER
// -----------------------------------------------------------------------------

async function main() {
  try {
    if (isResetMode) {
      await runReset();
    } else {
      await runSeed();
    }
  } catch (err) {
    console.error("FATAL: Unhandled exception during demo script execution:", err);
    process.exit(1);
  }
}

main();
