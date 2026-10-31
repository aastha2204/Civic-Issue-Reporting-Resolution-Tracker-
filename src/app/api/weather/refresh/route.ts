import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ParsedCoords {
  lat: number;
  lng: number;
}

/**
 * Extracts latitude and longitude from PostgreSQL/PostGIS geography point representations.
 * Handles GeoJSON objects, GeoJSON strings, WKT ("POINT(lng lat)"), and EWKB hex strings.
 */
function parseCentreCoordinates(centre: any): ParsedCoords | null {
  if (!centre) return null;

  // 1. GeoJSON object representation
  if (typeof centre === "object" && Array.isArray(centre.coordinates) && centre.coordinates.length >= 2) {
    return {
      lng: Number(centre.coordinates[0]),
      lat: Number(centre.coordinates[1]),
    };
  }

  // 2. String representations
  if (typeof centre === "string") {
    const trimmed = centre.trim();

    // GeoJSON string
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
          return {
            lng: Number(parsed.coordinates[0]),
            lat: Number(parsed.coordinates[1]),
          };
        }
      } catch {
        // Fall through to other string formats
      }
    }

    // WKT format: POINT(lng lat)
    const wktMatch = trimmed.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (wktMatch) {
      return {
        lng: parseFloat(wktMatch[1]),
        lat: parseFloat(wktMatch[2]),
      };
    }

    // EWKB hex string: 0101000020E6100000... (little endian 4326 Point)
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 42) {
      try {
        const buf = Buffer.from(trimmed, "hex");
        const isLittleEndian = buf[0] === 1;
        const geomType = isLittleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
        const hasSrid = (geomType & 0x20000000) !== 0;
        const offset = 5 + (hasSrid ? 4 : 0);

        const x = isLittleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
        const y = isLittleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);

        return { lng: x, lat: y };
      } catch {
        // Parsing error
      }
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const force = searchParams.get("force") === "1";

    // 1. Check age of existing cache unless force=1 is passed
    if (!force) {
      const { data: latestCache, error: cacheCheckErr } = await supabaseAdmin
        .from("weather_cache")
        .select("fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1);

      if (!cacheCheckErr && latestCache && latestCache.length > 0) {
        const lastFetched = new Date(latestCache[0].fetched_at).getTime();
        const diffMinutes = (Date.now() - lastFetched) / (1000 * 60);

        if (diffMinutes < 30) {
          return NextResponse.json({
            skipped: true,
            reason: `Weather cache was updated ${diffMinutes.toFixed(1)} minutes ago (less than 30 minutes). Pass ?force=1 to override.`,
          });
        }
      }
    }

    // 2. Fetch all wards
    const { data: wards, error: wardsErr } = await supabaseAdmin
      .from("wards")
      .select("id, name, centre");

    if (wardsErr) {
      return NextResponse.json(
        { error: `Failed to fetch wards: ${wardsErr.message}` },
        { status: 500 }
      );
    }

    if (!wards || wards.length === 0) {
      return NextResponse.json({
        skipped: true,
        reason: "No wards found in database.",
      });
    }

    const wardResults: Array<{
      id: number;
      name: string;
      past_24h_mm: number;
      next_24h_mm: number;
      rain_intensity?: number;
      error?: string;
    }> = [];

    // 3. Query Open-Meteo and update weather_cache per ward
    for (const ward of wards) {
      const coords = parseCentreCoordinates(ward.centre);
      if (!coords) {
        console.warn(`[Weather] Ward ${ward.id} (${ward.name}) missing valid coordinates.`);
        wardResults.push({
          id: ward.id,
          name: ward.name,
          past_24h_mm: 0,
          next_24h_mm: 0,
          error: "Invalid or missing ward coordinates.",
        });
        continue;
      }

      try {
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&hourly=precipitation&past_days=1&forecast_days=1&timezone=auto`;
        const res = await fetch(meteoUrl, {
          headers: { "User-Agent": "CivicTracker/1.0" },
          next: { revalidate: 0 },
        });

        if (!res.ok) {
          throw new Error(`Open-Meteo returned status ${res.status}`);
        }

        const data = await res.json();
        const precip: number[] = data?.hourly?.precipitation || [];

        // Sum precipitation for past 24 hours (first 24 values) and next 24 hours (next 24 values)
        const past24Hours = precip.slice(0, 24);
        const next24Hours = precip.slice(24, 48);

        const past_24h_mm = Number(
          past24Hours.reduce((sum, val) => sum + (typeof val === "number" ? val : 0), 0).toFixed(2)
        );
        const next_24h_mm = Number(
          next24Hours.reduce((sum, val) => sum + (typeof val === "number" ? val : 0), 0).toFixed(2)
        );

        // Never convert rainfall to points in TypeScript!
        // Pass millimeters directly to the database RPC which normalizes against heavy_rain_mm().
        const { error: rpcErr } = await supabaseAdmin.rpc("set_ward_weather", {
          p_ward_id: ward.id,
          p_past_24h_mm: past_24h_mm,
          p_next_24h_mm: next_24h_mm,
        });

        if (rpcErr) {
          throw rpcErr;
        }

        wardResults.push({
          id: ward.id,
          name: ward.name,
          past_24h_mm,
          next_24h_mm,
        });
      } catch (err: any) {
        console.error(`[Weather] Error refreshing ward ${ward.id} (${ward.name}):`, err);
        wardResults.push({
          id: ward.id,
          name: ward.name,
          past_24h_mm: 0,
          next_24h_mm: 0,
          error: err?.message || String(err),
        });
      }
    }

    // 4. Recompute all open issues once across the database
    let recomputedCount = 0;
    try {
      const { data: count, error: recomputeErr } = await supabaseAdmin.rpc(
        "recompute_all_open_issues"
      );
      if (!recomputeErr && typeof count === "number") {
        recomputedCount = count;
      }
    } catch (recomputeEx) {
      console.error("[Weather] Failed to recompute open issues:", recomputeEx);
    }

    // 5. Read back latest intensity from weather_cache for each ward
    const { data: cachedRows } = await supabaseAdmin
      .from("weather_cache")
      .select("ward_id, rain_intensity");

    const intensityMap = new Map<number, number>();
    if (cachedRows) {
      for (const row of cachedRows) {
        intensityMap.set(row.ward_id, Number(row.rain_intensity));
      }
    }

    const finalWards = wardResults.map((w) => ({
      name: w.name,
      past_24h_mm: w.past_24h_mm,
      next_24h_mm: w.next_24h_mm,
      rain_intensity: intensityMap.get(w.id) ?? 0.0,
      ...(w.error ? { error: w.error } : {}),
    }));

    return NextResponse.json({
      refreshed: true,
      recomputed_issues: recomputedCount,
      wards: finalWards,
    });
  } catch (globalErr: any) {
    console.error("[Weather] Unhandled error in weather refresh route:", globalErr);
    return NextResponse.json(
      { error: globalErr?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
