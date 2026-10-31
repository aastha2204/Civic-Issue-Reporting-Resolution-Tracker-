#!/usr/bin/env node

/**
 * scripts/fetch-osm-data.mjs
 * 
 * Fetches spatial landmarks (schools, hospitals, bus stops, markets) and classified
 * road networks from OpenStreetMap via the Overpass API, generating idempotent, batched
 * SQL seed files for Supabase.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SEED_DIR = path.resolve(ROOT_DIR, 'supabase', 'seed');

// Default ward centres from supabase/migrations/001_schema.sql
const DEFAULT_WARD_CENTRES = [
  { name: 'Ward 101 - Shanti Nagar (Simulated)', lat: 12.9716, lng: 77.5946 },
  { name: 'Ward 102 - Pragati Vihar (Simulated)', lat: 12.9816, lng: 77.6046 },
  { name: 'Ward 103 - Udyog Kendra (Simulated)', lat: 12.9616, lng: 77.5846 },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const MAX_FILE_SIZE_BYTES = 480 * 1024; // ~500 KB limit for splitting
const BATCH_SIZE = 200;

function escapeSqlString(str) {
  if (!str) return "''";
  return "'" + str.replace(/'/g, "''") + "'";
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  let customBbox = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bbox' && args[i + 1]) {
      customBbox = args[i + 1].trim();
      i++;
    } else if (args[i].startsWith('--bbox=')) {
      customBbox = args[i].split('=')[1].trim();
    }
  }

  return { customBbox };
}

function calculateDefaultBbox() {
  const minLat = Math.min(...DEFAULT_WARD_CENTRES.map((w) => w.lat));
  const maxLat = Math.max(...DEFAULT_WARD_CENTRES.map((w) => w.lat));
  const minLng = Math.min(...DEFAULT_WARD_CENTRES.map((w) => w.lng));
  const maxLng = Math.max(...DEFAULT_WARD_CENTRES.map((w) => w.lng));

  const avgLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const kmPerDegreeLat = 111.0;
  const kmPerDegreeLng = 111.0 * Math.cos(avgLatRad);

  const marginKm = 3.0;
  const latMargin = marginKm / kmPerDegreeLat;
  const lngMargin = marginKm / kmPerDegreeLng;

  return {
    south: Number((minLat - latMargin).toFixed(5)),
    west: Number((minLng - lngMargin).toFixed(5)),
    north: Number((maxLat + latMargin).toFixed(5)),
    east: Number((maxLng + lngMargin).toFixed(5)),
  };
}

async function queryOverpass(query, description) {
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt];
    console.log(`[OSM] Fetching ${description} from ${endpoint} (attempt ${attempt + 1}/${OVERPASS_ENDPOINTS.length})...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000); // 40s timeout

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'CivicTracker/1.0',
        },
        body: query,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      if (!text.trim().startsWith('{')) {
        throw new Error(`Non-JSON response received: ${text.slice(0, 120)}`);
      }

      const data = JSON.parse(text);
      console.log(`[OSM] Successfully received ${data.elements?.length || 0} elements for ${description}.`);
      return data.elements || [];
    } catch (err) {
      console.warn(`[OSM] Attempt failed on ${endpoint}: ${err.message}`);
      if (attempt < OVERPASS_ENDPOINTS.length - 1) {
        console.log(`[OSM] Retrying next attempt in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        throw new Error(`Failed to query Overpass API across all endpoints for ${description}: ${err.message}`);
      }
    }
  }

  return [];
}

function processPlaces(elements) {
  const places = [];

  for (const el of elements) {
    const tags = el.tags || {};
    let kind = null;

    if (tags.amenity === 'school') {
      kind = 'school';
    } else if (tags.amenity === 'hospital') {
      kind = 'hospital';
    } else if (tags.highway === 'bus_stop') {
      kind = 'bus_stop';
    } else if (tags.amenity === 'marketplace' || tags.shop === 'mall') {
      kind = 'market';
    }

    if (!kind) continue;

    let lat = el.lat;
    let lon = el.lon;

    if (lat === undefined && el.center) {
      lat = el.center.lat;
      lon = el.center.lon;
    }

    if (lat === undefined || lon === undefined) continue;

    const roundedLat = Number(lat.toFixed(5));
    const roundedLng = Number(lon.toFixed(5));
    const rawName = tags.name || tags['name:en'] || 'Unnamed';
    const cleanName = rawName.trim().slice(0, 200) || 'Unnamed';

    places.push({
      kind,
      name: cleanName,
      lat: roundedLat,
      lng: roundedLng,
    });
  }

  return places;
}

function processRoads(elements) {
  const roads = [];

  for (const el of elements) {
    if (el.type !== 'way') continue;
    const tags = el.tags || {};
    const highway = tags.highway;
    if (!highway) continue;

    let roadClass = null;
    if (['trunk', 'trunk_link', 'primary', 'primary_link'].includes(highway)) {
      roadClass = 'main';
    } else if (['secondary', 'secondary_link', 'tertiary'].includes(highway)) {
      roadClass = 'secondary';
    }

    if (!roadClass) continue;

    const geom = el.geometry || [];
    if (geom.length < 2) continue;

    // Filter consecutive duplicate coordinates
    const points = [];
    for (const pt of geom) {
      const lat = Number(pt.lat.toFixed(5));
      const lng = Number(pt.lon.toFixed(5));
      if (
        points.length === 0 ||
        points[points.length - 1].lat !== lat ||
        points[points.length - 1].lng !== lng
      ) {
        points.push({ lat, lng });
      }
    }

    if (points.length < 2) continue;

    const rawName = tags.name || tags['name:en'] || 'Unnamed';
    const cleanName = rawName.trim().slice(0, 200) || 'Unnamed';

    roads.push({
      osm_id: el.id,
      name: cleanName,
      highway,
      road_class: roadClass,
      points,
    });
  }

  return roads;
}

function writePlacesSeed(places) {
  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }

  const filePath = path.join(SEED_DIR, 'places_seed.sql');
  const lines = [];

  lines.push('-- ============================================================================');
  lines.push('-- supabase/seed/places_seed.sql');
  lines.push('-- OpenStreetMap Sensitive Places Seed (Schools, Hospitals, Bus Stops, Markets)');
  lines.push('-- ============================================================================');
  lines.push('-- Safe delete-then-insert: Deletes ONLY rows previously generated by this seed');
  lines.push("-- (marked with source = 'osm_seed') so manually added places are never removed.");
  lines.push("delete from public.places where source = 'osm_seed';\n");

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const chunk = places.slice(i, i + BATCH_SIZE);
    lines.push('insert into public.places (kind, name, location, source) values');

    const valueRows = chunk.map((p, idx) => {
      const isLast = idx === chunk.length - 1;
      const pointSql = `extensions.st_setsrid(extensions.st_makepoint(${p.lng}, ${p.lat}), 4326)::extensions.geography`;
      return `  (${escapeSqlString(p.kind)}, ${escapeSqlString(p.name)}, ${pointSql}, 'osm_seed')${isLast ? ';' : ','}`;
    });

    lines.push(valueRows.join('\n'));
    lines.push('');
  }

  const content = lines.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[OSM] Written ${places.length} places to ${path.relative(ROOT_DIR, filePath)} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
}

function writeRoadsSeed(roads) {
  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }

  // Pre-generate SQL statement chunks
  const batchStatements = [];
  for (let i = 0; i < roads.length; i += BATCH_SIZE) {
    const chunk = roads.slice(i, i + BATCH_SIZE);
    const chunkLines = [];
    chunkLines.push('insert into public.roads (osm_id, name, highway, road_class, geom, source) values');

    const valueRows = chunk.map((r, idx) => {
      const isLast = idx === chunk.length - 1;
      const coordString = r.points.map((p) => `${p.lng} ${p.lat}`).join(', ');
      const linestringSql = `extensions.st_geogfromtext('SRID=4326;LINESTRING(${coordString})')`;
      return `  (${r.osm_id}, ${escapeSqlString(r.name)}, ${escapeSqlString(r.highway)}, ${escapeSqlString(r.road_class)}, ${linestringSql}, 'osm_seed')${isLast ? ';' : ','}`;
    });

    chunkLines.push(valueRows.join('\n'));
    batchStatements.push(chunkLines.join('\n'));
  }

  // Determine total size to decide whether to split into numbered files
  const headerLines = [
    '-- ============================================================================',
    '-- supabase/seed/roads_seed.sql',
    '-- OpenStreetMap Road Network Seed (Main, Secondary roads)',
    '-- Data from OpenStreetMap contributors (ODbL)',
    '-- ============================================================================',
    '-- Safe delete-then-insert: Deletes ONLY rows previously generated by this seed',
    "-- (marked with source = 'osm_seed') so manually added roads are never removed.",
    "delete from public.roads where source = 'osm_seed';\n",
  ].join('\n');

  const totalContent = headerLines + '\n\n' + batchStatements.join('\n\n');
  const totalBytes = Buffer.byteLength(totalContent);

  if (totalBytes <= MAX_FILE_SIZE_BYTES) {
    const filePath = path.join(SEED_DIR, 'roads_seed.sql');
    fs.writeFileSync(filePath, totalContent, 'utf8');
    console.log(`[OSM] Written ${roads.length} roads to ${path.relative(ROOT_DIR, filePath)} (${(totalBytes / 1024).toFixed(1)} KB)`);
  } else {
    // Split into numbered parts
    console.log(`[OSM] Roads file size (${(totalBytes / 1024).toFixed(1)} KB) exceeds 500 KB limit. Splitting into numbered parts...`);
    let currentPart = 1;
    let currentLines = [];
    let currentBytes = 0;

    const startNewFile = (partNum) => {
      currentLines = [
        '-- ============================================================================',
        `-- supabase/seed/roads_seed_${partNum}.sql (Part ${partNum})`,
        '-- OpenStreetMap Road Network Seed',
        '-- Data from OpenStreetMap contributors (ODbL)',
        '-- ============================================================================',
      ];
      if (partNum === 1) {
        currentLines.push('-- Safe delete-then-insert: Delete prior seeded rows on first part');
        currentLines.push("delete from public.roads where source = 'osm_seed';\n");
      }
      currentLines.push('');
      currentBytes = Buffer.byteLength(currentLines.join('\n'));
    };

    startNewFile(currentPart);

    for (const stmt of batchStatements) {
      const stmtBytes = Buffer.byteLength(stmt) + 2;
      if (currentBytes + stmtBytes > MAX_FILE_SIZE_BYTES && currentLines.length > 5) {
        // Write out current part
        const partPath = path.join(SEED_DIR, `roads_seed_${currentPart}.sql`);
        fs.writeFileSync(partPath, currentLines.join('\n'), 'utf8');
        console.log(`[OSM] Written part ${currentPart} to ${path.relative(ROOT_DIR, partPath)} (${(currentBytes / 1024).toFixed(1)} KB)`);
        currentPart++;
        startNewFile(currentPart);
      }
      currentLines.push(stmt);
      currentLines.push('');
      currentBytes += stmtBytes;
    }

    if (currentLines.length > 0) {
      const partPath = path.join(SEED_DIR, `roads_seed_${currentPart}.sql`);
      fs.writeFileSync(partPath, currentLines.join('\n'), 'utf8');
      console.log(`[OSM] Written part ${currentPart} to ${path.relative(ROOT_DIR, partPath)} (${(currentBytes / 1024).toFixed(1)} KB)`);
    }
  }
}

async function main() {
  console.log('=== Civic Tracker OpenStreetMap Ingestion Pipeline ===\n');

  const { customBbox } = parseCliArgs();
  let bboxStr;
  let south, west, north, east;

  if (customBbox) {
    const parts = customBbox.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length !== 4 || parts.some(isNaN)) {
      console.error('Error: Invalid --bbox format. Expected: --bbox south,west,north,east');
      process.exit(1);
    }
    [south, west, north, east] = parts;
    bboxStr = `${south},${west},${north},${east}`;
    console.log(`[OSM] Using user-specified bounding box: ${bboxStr}`);
  } else {
    console.warn('----------------------------------------------------------------------');
    console.warn('WARNING: No --bbox flag provided!');
    console.warn('Using default bounding box derived from the simulated dummy ward centres');
    console.warn('in supabase/migrations/001_schema.sql plus a 3 km buffer.');
    console.warn('To specify your demo jurisdiction area, run with:');
    console.warn('  npm run seed:osm -- --bbox south,west,north,east');
    console.warn('----------------------------------------------------------------------\n');

    console.log('Seeded Ward Centres used:');
    for (const w of DEFAULT_WARD_CENTRES) {
      console.log(`  - ${w.name}: lat ${w.lat}, lng ${w.lng}`);
    }

    const calculated = calculateDefaultBbox();
    south = calculated.south;
    west = calculated.west;
    north = calculated.north;
    east = calculated.east;
    bboxStr = `${south},${west},${north},${east}`;
    console.log(`\nCalculated Bounding Box (3 km margin): ${bboxStr}`);
    console.log(`(south=${south}, west=${west}, north=${north}, east=${east})\n`);
  }

  // 1. Query Places
  const placesQuery = `[out:json][timeout:60];
(
  node[amenity=school](${bboxStr});
  way[amenity=school](${bboxStr});
  node[amenity=hospital](${bboxStr});
  way[amenity=hospital](${bboxStr});
  node[highway=bus_stop](${bboxStr});
  way[highway=bus_stop](${bboxStr});
  node[amenity=marketplace](${bboxStr});
  way[amenity=marketplace](${bboxStr});
  node[shop=mall](${bboxStr});
  way[shop=mall](${bboxStr});
);
out center tags;`;

  const rawPlaces = await queryOverpass(placesQuery, 'landmarks (schools, hospitals, bus stops, markets)');
  const places = processPlaces(rawPlaces);

  // Polite 3-second delay between Overpass queries
  console.log('[OSM] Pausing 3 seconds before requesting road network...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // 2. Query Roads
  const roadsQuery = `[out:json][timeout:60];
(
  way[highway=trunk](${bboxStr});
  way[highway=trunk_link](${bboxStr});
  way[highway=primary](${bboxStr});
  way[highway=primary_link](${bboxStr});
  way[highway=secondary](${bboxStr});
  way[highway=secondary_link](${bboxStr});
  way[highway=tertiary](${bboxStr});
);
out geom tags;`;

  const rawRoads = await queryOverpass(roadsQuery, 'classified road network');
  const roads = processRoads(rawRoads);

  // 3. Write SQL files
  writePlacesSeed(places);
  writeRoadsSeed(roads);

  // 4. Print summary counts
  console.log('\n=== Ingestion Summary ===');
  const placeCounts = places.reduce((acc, p) => {
    acc[p.kind] = (acc[p.kind] || 0) + 1;
    return acc;
  }, {});

  console.log('Places counts by kind:');
  for (const [kind, count] of Object.entries(placeCounts)) {
    console.log(`  - ${kind}: ${count}`);
  }
  console.log(`  Total Places: ${places.length}`);

  const roadCounts = roads.reduce((acc, r) => {
    acc[r.road_class] = (acc[r.road_class] || 0) + 1;
    return acc;
  }, {});

  console.log('\nRoads counts by road_class:');
  for (const [cls, count] of Object.entries(roadCounts)) {
    console.log(`  - ${cls}: ${count}`);
  }
  console.log(`  Total Roads: ${roads.length}`);

  console.log('\n=== Seeding files generated successfully! ===');
}

main().catch((err) => {
  console.error('\nFatal error in OSM seed script:', err);
  process.exit(1);
});
