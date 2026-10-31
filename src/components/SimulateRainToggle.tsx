"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface SimulateRainToggleProps {
  onToggleComplete?: (newValue: boolean) => void;
}

export default function SimulateRainToggle({
  onToggleComplete,
}: SimulateRainToggleProps) {
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [canToggle, setCanToggle] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    async function initToggle() {
      setIsLoading(true);
      try {
        // 1. Fetch current simulate_heavy_rain app setting
        const { data: settingData, error: settingErr } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "simulate_heavy_rain")
          .maybeSingle();

        if (!settingErr && settingData) {
          setIsSimulated(settingData.value === "true");
        }

        // 2. Check authenticated user's role in profiles
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();

          if (!profileErr && profile) {
            setUserRole(profile.role);
            if (profile.role === "officer" || profile.role === "admin") {
              setCanToggle(true);
            }
          }
        }
      } catch (err: any) {
        console.error("Failed to initialize simulate rain toggle:", err);
      } finally {
        setIsLoading(false);
      }
    }

    initToggle();
  }, []);

  const handleToggle = async () => {
    if (!canToggle || isUpdating) return;

    const nextState = !isSimulated;
    setIsUpdating(true);
    setStatusMessage(null);

    try {
      const { error } = await supabase.rpc("set_simulate_rain", {
        p_on: nextState,
      });

      if (error) {
        throw error;
      }

      setIsSimulated(nextState);
      setStatusMessage(
        nextState
          ? "Heavy rain simulation activated. Open issue scores recomputed."
          : "Heavy rain simulation deactivated. Open issue scores recomputed."
      );
      if (onToggleComplete) {
        onToggleComplete(nextState);
      }
    } catch (err: any) {
      console.error("Error setting simulated rain:", err);
      setStatusMessage(err?.message || "Failed to update rain simulation.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌧️</span>
            <span className="text-sm font-bold text-slate-900">
              Simulate Heavy Rain
            </span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Forces rain intensity to maximum (1.0) to preview real-time storm weather boosts.
          </p>
        </div>

        {/* Toggle Switch */}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={isSimulated}
            disabled={!canToggle || isLoading || isUpdating}
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
              isSimulated ? "bg-blue-600" : "bg-slate-300"
            } ${!canToggle || isLoading || isUpdating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                isSimulated ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Role Notice / Badge */}
      {!isLoading && !canToggle && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span>🔒</span>
          <span>
            <strong>Officer login required</strong> to toggle simulation mode.
            {userRole ? ` (Current role: ${userRole})` : " (Currently logged out)"}
          </span>
        </div>
      )}

      {/* Feedback status message */}
      {statusMessage && (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
          {statusMessage}
        </p>
      )}
    </div>
  );
}
