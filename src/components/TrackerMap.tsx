"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TrackerIssue } from "@/lib/tracker";
import { fetchWardCentres } from "@/lib/reports";
import { getCategoryEmoji } from "@/lib/categories";

interface TrackerMapProps {
  issues: TrackerIssue[];
  className?: string;
}

// Helpers for marker styling based on priority band and resolution status
function getMarkerColor(issue: TrackerIssue): {
  color: string;
  fillColor: string;
  fillOpacity: number;
  opacity: number;
} {
  if (issue.status === "resolved") {
    return {
      color: "#64748B",      // slate-500
      fillColor: "#94A3B8",  // slate-400
      fillOpacity: 0.4,
      opacity: 0.6,
    };
  }

  switch (issue.priority_band) {
    case "High":
      return {
        color: "#DC2626",      // red-600
        fillColor: "#EF4444",  // red-500
        fillOpacity: 0.85,
        opacity: 0.95,
      };
    case "Medium":
      return {
        color: "#D97706",      // amber-600
        fillColor: "#F59E0B",  // amber-500
        fillOpacity: 0.85,
        opacity: 0.95,
      };
    case "Low":
    default:
      return {
        color: "#059669",      // emerald-600
        fillColor: "#10B981",  // emerald-500
        fillOpacity: 0.85,
        opacity: 0.95,
      };
  }
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function TrackerMap({
  issues,
  className = "h-[450px] w-full rounded-2xl border border-slate-200 shadow-xs",
}: TrackerMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);

  const [mapMode, setMapMode] = useState<"pins" | "heatmap">("pins");
  const [heatmapPluginReady, setHeatmapPluginReady] = useState<boolean>(false);
  const [heatmapNotice, setHeatmapNotice] = useState<string | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Initial default fallback coordinates 28.6298, 77.3723
    const map = L.map(mapContainerRef.current, {
      center: [28.6298, 77.3723],
      zoom: 14,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    markersGroupRef.current = markersGroup;

    // Invalidate size once rendered
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
      markersGroupRef.current = null;
    };
  }, []);

  // 2. Pre-load leaflet.heat client-side dynamically on mount and when heatmap mode selected
  useEffect(() => {
    if (typeof window !== "undefined" && !heatmapPluginReady) {
      (window as unknown as { L: typeof L }).L = L;
      import("leaflet.heat")
        .then(() => {
          setHeatmapPluginReady(true);
          setHeatmapNotice(null);
        })
        .catch((err) => {
          console.error("Failed to dynamically import leaflet.heat:", err);
          if (mapMode === "heatmap") {
            setHeatmapNotice("Heatmap plugin failed to load. Falling back to pins.");
            setMapMode("pins");
          }
        });
    }
  }, [heatmapPluginReady, mapMode]);

  // 3. Render either Markers or Heatmap when issues, mapMode, or plugin readiness changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    // Remove existing heatmap layer if present
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    // Always clear marker layer group
    markersGroup.clearLayers();

    // Collect coordinates for fitBounds
    const bounds: L.LatLngExpression[] = [];

    if (mapMode === "heatmap" && heatmapPluginReady) {
      // Heatmap mode: exclude resolved issues; intensity derived meaningfully from priority_score (0-100)
      const activeIssues = issues.filter(
        (i) =>
          i.status !== "resolved" &&
          typeof i.lat === "number" &&
          typeof i.lng === "number" &&
          Number.isFinite(i.lat) &&
          Number.isFinite(i.lng)
      );

      const heatPoints: Array<[number, number, number]> = activeIssues.map((issue) => {
        const score = Math.max(0, Math.min(100, issue.priority_score || 0));
        // Meaningful intensity: 0.30 (low priority base) to 1.0 (high priority critical)
        const intensity = Math.max(0.3, Number((score / 100).toFixed(2)));
        bounds.push([issue.lat, issue.lng]);
        return [issue.lat, issue.lng, intensity];
      });

      if (
        heatPoints.length > 0 &&
        typeof (L as unknown as { heatLayer?: any }).heatLayer === "function"
      ) {
        // Configure heat layer with calibrated maxZoom, minOpacity, radius, and gradient
        // maxZoom: 13 prevents leaflet-heat from dividing point intensity by 2^(19-zoom) (32x faintness)
        // minOpacity: 0.4 ensures single points remain clearly visible
        const heatLayer = (L as unknown as { heatLayer: any }).heatLayer(heatPoints, {
          radius: 25,
          blur: 15,
          maxZoom: 13,
          max: 1.0,
          minOpacity: 0.4,
          gradient: {
            0.0: "#10B981", // Emerald (Low priority)
            0.4: "#059669", // Deeper Green
            0.6: "#F59E0B", // Amber (Medium priority)
            0.8: "#EF4444", // Red (High priority)
            1.0: "#991B1B", // Deep Red (Critical peak)
          },
        }).addTo(map);

        heatLayerRef.current = heatLayer;
      }
    } else {
      // Pins mode: render circle markers with interactive popups
      if (issues.length > 0) {
        issues.forEach((issue) => {
          if (typeof issue.lat !== "number" || typeof issue.lng !== "number") return;

          const styling = getMarkerColor(issue);
          const radius = Math.max(
            7,
            Math.min(16, 7 + Math.round((Math.max(0, issue.priority_score) / 100) * 8))
          );

          const circle = L.circleMarker([issue.lat, issue.lng], {
            radius,
            color: styling.color,
            fillColor: styling.fillColor,
            fillOpacity: styling.fillOpacity,
            opacity: styling.opacity,
            weight: 2,
          });

          // Construct popup HTML
          const categoryEmoji = getCategoryEmoji(issue.category);
          const categoryLabel = escapeHtml(issue.category_label || issue.category);
          const reasons = escapeHtml(issue.reasons_text || "");
          const statusLabel = escapeHtml(
            issue.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
          );

          let photoHtml = "";
          if (issue.photo_url) {
            photoHtml = `
              <div style="width: 100%; height: 110px; overflow: hidden; border-radius: 8px; margin-bottom: 8px; background: #e2e8f0;">
                <img src="${escapeHtml(issue.photo_url)}" alt="${categoryLabel}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
              </div>
            `;
          }

          const bandBadgeColor =
            issue.priority_band === "High"
              ? "#FEE2E2; color: #991B1B"
              : issue.priority_band === "Medium"
              ? "#FEF3C7; color: #92400E"
              : "#D1FAE5; color: #065F46";

          const popupHtml = `
            <div style="font-family: inherit; font-size: 13px; max-width: 240px; color: #1e293b; padding: 2px;">
              ${photoHtml}
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                <span style="font-weight: 700; font-size: 14px;">${categoryEmoji} ${categoryLabel}</span>
                <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 9999px; background: ${bandBadgeColor};">
                  ${issue.priority_score} pts
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 600;">
                  ${statusLabel}
                </span>
                <span style="font-size: 11px; color: #64748b;">
                  ${issue.unique_reporters} reporter${issue.unique_reporters === 1 ? "" : "s"}
                </span>
              </div>
              ${
                reasons
                  ? `<p style="font-size: 11px; color: #475569; line-height: 1.35; margin: 4px 0 8px 0;">${reasons}</p>`
                  : ""
              }
              <a href="/issue/${issue.id}" style="display: block; text-align: center; background: #2563eb; color: #ffffff; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 600; min-height: 32px; line-height: 20px;">
                View issue →
              </a>
            </div>
          `;

          circle.bindPopup(popupHtml, { maxWidth: 260 });
          circle.addTo(markersGroup);
          bounds.push([issue.lat, issue.lng]);
        });
      }
    }

    // 4. Fit bounds or center fallback
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(bounds), {
          padding: [45, 45],
          maxZoom: 16,
        });
      }
    } else if (issues.length === 0) {
      // Center on ward centres
      fetchWardCentres().then(({ data }) => {
        if (data && data.length > 0) {
          const avgLat = data.reduce((sum, w) => sum + w.lat, 0) / data.length;
          const avgLng = data.reduce((sum, w) => sum + w.lng, 0) / data.length;
          map.setView([avgLat, avgLng], 14);
        } else {
          map.setView([28.6298, 77.3723], 14);
        }
      });
    }
  }, [issues, mapMode, heatmapPluginReady]);

  return (
    <div className="relative w-full h-full min-h-[360px] flex flex-col">
      <div ref={mapContainerRef} className={className} />

      {/* Floating Map Mode Toggle (Pins vs Heatmap) */}
      <div className="absolute top-3 right-3 z-[1000] bg-white/95 backdrop-blur-xs p-1 rounded-xl border border-slate-200/90 shadow-md flex items-center gap-1 pointer-events-auto">
        <button
          type="button"
          onClick={() => setMapMode("pins")}
          aria-pressed={mapMode === "pins"}
          className={`min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            mapMode === "pins"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <span>📍</span>
          <span>Pins</span>
        </button>
        <button
          type="button"
          onClick={() => setMapMode("heatmap")}
          aria-pressed={mapMode === "heatmap"}
          className={`min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            mapMode === "heatmap"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <span>🔥</span>
          <span>Heatmap</span>
        </button>
      </div>

      {/* Fallback Notice if Heatmap fails to load */}
      {heatmapNotice && (
        <div className="absolute top-16 right-3 z-[1000] bg-rose-50 border border-rose-200 text-rose-800 text-xs px-3 py-1.5 rounded-lg shadow-md pointer-events-auto animate-fade-in">
          {heatmapNotice}
        </div>
      )}

      {/* Floating Map Colour Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur-xs px-3 py-2 rounded-xl border border-slate-200/80 shadow-md text-xs text-slate-700 pointer-events-auto flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-800 text-[11px] uppercase tracking-wide">Priority:</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block border border-red-600 shadow-2xs" />
            <span>High</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block border border-amber-600 shadow-2xs" />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block border border-emerald-600 shadow-2xs" />
            <span>Low</span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block border border-slate-500 opacity-60" />
            <span className="text-slate-500">Resolved</span>
          </div>
        </div>

        {/* Heatmap Legend Note */}
        <div className="border-t border-slate-100 pt-1 text-[11px] text-slate-500 font-medium">
          Heatmap: brighter = higher priority density
        </div>
      </div>
    </div>
  );
}
