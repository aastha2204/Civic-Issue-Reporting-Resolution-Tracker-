"use client";

import React, { useEffect, useState } from "react";
import { getDemoActive } from "@/lib/demo";

interface DemoBannerProps {
  className?: string;
}

/**
 * Slim notification banner displayed when synthetic demo data is active.
 * Queries `demo_data_active` RPC on mount. Completely hidden if demo data is absent.
 */
export default function DemoBanner({ className = "" }: DemoBannerProps) {
  const [isDemoActive, setIsDemoActive] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    getDemoActive()
      .then((active) => {
        if (isMounted) {
          setIsDemoActive(active);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsDemoActive(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!isDemoActive) {
    return null;
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`w-full bg-amber-500/10 border border-amber-500/30 text-amber-900 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between gap-3 shadow-2xs ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none select-none" aria-hidden="true">
          🧪
        </span>
        <span>
          <strong className="font-semibold">Demo data:</strong> The reports shown here are sample data for demonstration.
        </span>
      </div>
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/60 text-amber-950 uppercase tracking-wider shrink-0">
        Sample Mode
      </span>
    </aside>
  );
}
