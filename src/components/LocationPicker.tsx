"use client";

import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Ensure default icon paths are resolved or fall back cleanly
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom SVG marker for crisp rendering on high-DPI mobile screens
const createCustomMarker = () => {
  return L.divIcon({
    className: "civic-pin-container",
    html: `
      <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3)); display: flex; flex-direction: column; align-items: center; cursor: grab;">
        <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 0C7.16344 0 0 7.16344 0 16C0 28 16 40 16 40C16 40 32 28 32 16C32 7.16344 24.8366 0 16 0Z" fill="#2563EB"/>
          <circle cx="16" cy="16" r="6.5" fill="#FFFFFF"/>
        </svg>
      </div>
    `,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });
};

interface LocationPickerProps {
  lat: number;
  lng: number;
  onChange: (coords: { lat: number; lng: number }) => void;
  onRequestGps?: () => void;
  gpsStatus?: "prompt" | "granted" | "denied" | "unavailable";
}

export default function LocationPicker({
  lat,
  lng,
  onChange,
  onRequestGps,
  gpsStatus = "prompt",
}: LocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [lat, lng],
      zoom: 16,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const marker = L.marker([lat, lng], {
      draggable: true,
      icon: createCustomMarker(),
    }).addTo(map);

    marker.on("dragend", () => {
      const position = marker.getLatLng();
      onChange({ lat: position.lat, lng: position.lng });
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;

    // Invalidate size once DOM layout completes
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  }, []); // Run once on mount

  // Update map and marker if props lat/lng change from outside (e.g. GPS update)
  useEffect(() => {
    if (!mapInstanceRef.current || !markerRef.current) return;
    const currentPos = markerRef.current.getLatLng();
    // Only update if difference is noticeable (> ~1 meter)
    if (
      Math.abs(currentPos.lat - lat) > 0.00001 ||
      Math.abs(currentPos.lng - lng) > 0.00001
    ) {
      markerRef.current.setLatLng([lat, lng]);
      mapInstanceRef.current.panTo([lat, lng], { animate: true });
    }
  }, [lat, lng]);

  return (
    <div className="w-full space-y-2">
      <div className="relative w-full h-64 sm:h-72 rounded-xl overflow-hidden border border-slate-300 shadow-xs z-0">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating action button to re-trigger GPS */}
        {onRequestGps && (
          <button
            type="button"
            onClick={onRequestGps}
            className="absolute top-3 right-3 z-1000 bg-white/95 backdrop-blur-xs hover:bg-white text-slate-800 text-xs font-semibold px-3 py-2 rounded-lg shadow-md border border-slate-200 flex items-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
            title="Recenter to current GPS location"
          >
            <span>🎯</span>
            <span>Locate Me</span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>📍 Drag pin or tap map to adjust</span>
        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}
