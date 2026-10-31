"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import SimulateRainToggle from "@/components/SimulateRainToggle";
import { supabase } from "@/lib/supabase/client";

interface WardWeatherRow {
  wardId: number;
  wardName: string;
  rainIntensity: number;
  fetchedAt: string | null;
}

export default function DemoPage() {
  const [weatherRows, setWeatherRows] = useState<WardWeatherRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshingRoute, setIsRefreshingRoute] = useState<boolean>(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const loadWardWeatherData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch wards
      const { data: wards, error: wardsErr } = await supabase
        .from("wards")
        .select("id, name")
        .order("id", { ascending: true });

      if (wardsErr) throw wardsErr;

      // 2. Fetch cached weather
      const { data: cacheData, error: cacheErr } = await supabase
        .from("weather_cache")
        .select("ward_id, rain_intensity, fetched_at");

      if (cacheErr) throw cacheErr;

      const cacheMap = new Map<number, { rain_intensity: number; fetched_at: string }>();
      if (cacheData) {
        for (const row of cacheData) {
          cacheMap.set(row.ward_id, {
            rain_intensity: Number(row.rain_intensity),
            fetched_at: row.fetched_at,
          });
        }
      }

      const rows: WardWeatherRow[] = (wards || []).map((w) => {
        const cached = cacheMap.get(w.id);
        return {
          wardId: w.id,
          wardName: w.name,
          rainIntensity: cached ? cached.rain_intensity : 0.0,
          fetchedAt: cached ? cached.fetched_at : null,
        };
      });

      setWeatherRows(rows);
    } catch (err: any) {
      console.error("Failed to load demo weather data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWardWeatherData();
  }, [loadWardWeatherData]);

  const handleManualWeatherSync = async () => {
    setIsRefreshingRoute(true);
    setRefreshMessage(null);
    try {
      const res = await fetch("/api/weather/refresh?force=1");
      const json = await res.json();
      if (json.refreshed) {
        setRefreshMessage(`Weather refreshed! Recomputed ${json.recomputed_issues} open issues.`);
        await loadWardWeatherData();
      } else if (json.skipped) {
        setRefreshMessage(`Skipped: ${json.reason}`);
      } else if (json.error) {
        setRefreshMessage(`Error: ${json.error}`);
      }
    } catch (err: any) {
      setRefreshMessage(err?.message || "Failed to trigger weather refresh");
    } finally {
      setIsRefreshingRoute(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-8 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <header className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <span>←</span>
            <span>Back to Map</span>
          </Link>
          <span className="text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-100 text-purple-800">
            Evaluation Demo
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">
          Scoring &amp; Weather Demo
        </h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          Simulate heavy rain: forces rain intensity to maximum so you can see the weather boost live.
        </p>
      </header>

      {/* Heavy Rain Simulation Control */}
      <section className="space-y-2">
        <SimulateRainToggle onToggleComplete={() => loadWardWeatherData()} />
      </section>

      {/* Current Ward Weather Cache Table */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Ward Weather Cache
            </h2>
            <p className="text-[11px] text-slate-400">
              Cached Open-Meteo precipitation intensity per ward
            </p>
          </div>
          <button
            type="button"
            disabled={isRefreshingRoute}
            onClick={handleManualWeatherSync}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
          >
            {isRefreshingRoute ? "Syncing..." : "Sync Live Weather"}
          </button>
        </div>

        {refreshMessage && (
          <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-md p-2">
            {refreshMessage}
          </p>
        )}

        {isLoading ? (
          <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
            Loading ward weather status...
          </div>
        ) : weatherRows.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">
            No wards or weather records found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] text-slate-400 uppercase tracking-wider">
                  <th className="pb-2 font-semibold">Ward</th>
                  <th className="pb-2 font-semibold text-center">Intensity</th>
                  <th className="pb-2 font-semibold text-right">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {weatherRows.map((row) => (
                  <tr key={row.wardId} className="hover:bg-slate-50/60">
                    <td className="py-2.5 font-medium text-slate-800 pr-2">
                      {row.wardName}
                    </td>
                    <td className="py-2.5 text-center font-bold text-blue-700">
                      {row.rainIntensity.toFixed(2)}
                      <span className="text-[10px] text-slate-400 font-normal ml-1">
                        ({Math.round(row.rainIntensity * 100)}%)
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-[11px] text-slate-500">
                      {row.fetchedAt
                        ? new Date(row.fetchedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Data Honesty Disclaimer */}
      <footer className="text-center pt-2">
        <p className="text-[11px] text-slate-400 leading-normal">
          Ward density values are simulated. Road and place data: OpenStreetMap contributors. Weather: Open-Meteo.
        </p>
      </footer>
    </main>
  );
}
