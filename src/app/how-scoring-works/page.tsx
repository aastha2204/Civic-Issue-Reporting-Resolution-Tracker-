"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getScoringExplainer, ScoringExplainer } from "@/lib/transparency";
import { getCategoryEmoji } from "@/lib/categories";

export default function HowScoringWorksPage() {
  const [data, setData] = useState<ScoringExplainer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    const res = await getScoringExplainer();
    if (res.error) {
      setError(res.error);
    } else {
      setData(res.data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const constants = data?.constants;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-4 py-8 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Navigation Bar */}
        <header className="flex items-center justify-between border-b border-slate-200 pb-4">
          <Link
            href="/tracker"
            className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors py-2 min-h-[44px]"
          >
            ← Back to Public Tracker
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/accountability"
              className="text-xs sm:text-sm font-semibold text-purple-600 hover:text-purple-800 underline underline-offset-4 inline-flex items-center min-h-[44px]"
            >
              Accountability Scoreboard →
            </Link>
          </div>
        </header>

        {/* Hero Header */}
        <section className="space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
            <span>⚖️</span>
            <span>Algorithmic Transparency</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
            How Civic Scoring Works
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
            Every issue gets a score from 0 to 100. Here is exactly how.
          </p>
        </section>

        {/* Priority Bands Strip */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Priority Action Bands
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-red-200 bg-red-50/60 flex flex-col justify-between">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-red-800">
                  High Priority
                </span>
                <div className="text-xl font-black text-red-900 mt-1">70 – 100</div>
              </div>
              <p className="text-xs text-red-700 mt-2">
                Target turnaround: <strong>48 hours</strong>
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/60 flex flex-col justify-between">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-800">
                  Medium Priority
                </span>
                <div className="text-xl font-black text-amber-900 mt-1">40 – 69</div>
              </div>
              <p className="text-xs text-amber-700 mt-2">
                Target turnaround: <strong>7 days</strong>
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60 flex flex-col justify-between">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                  Low Priority
                </span>
                <div className="text-xl font-black text-emerald-900 mt-1">&lt; 40</div>
              </div>
              <p className="text-xs text-emerald-700 mt-2">
                Scheduled for <strong>batched maintenance</strong>
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic pt-1">
            Total score is mathematically capped at 100.
          </p>
        </section>

        {/* Scoring Formula Breakdown Cards */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            The Base Formula (Max 100)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Severity Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">1. Severity</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  Max 30 pts
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Evaluates intrinsic danger: <code>Category Base Weight × Level Multiplier × 30</code>.
              </p>
              <ul className="text-xs text-slate-500 list-disc list-inside space-y-1 pt-1">
                <li>Minor: 0.50 multiplier</li>
                <li>Moderate: 0.75 multiplier</li>
                <li>Dangerous: 1.00 multiplier</li>
              </ul>
            </div>

            {/* Location & Exposure Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">2. Location &amp; Exposure</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  Max 25 pts
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Measures vulnerability of passersby and public infrastructure:
              </p>
              <ul className="text-xs text-slate-500 list-disc list-inside space-y-1 pt-1">
                <li>School within 200 m: +8 pts</li>
                <li>Hospital within 200 m: +8 pts</li>
                <li>Market within 150 m: +4 pts</li>
                <li>Bus stop within 100 m: +3 pts</li>
                <li>Road class: Main (+6), Secondary (+3), Local (+0)</li>
                <li>Ward density score: +0 to +4 pts</li>
              </ul>
            </div>

            {/* Frequency Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">3. Frequency</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  Max 25 pts
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Community amplification based on unique verified citizens (reports + &ldquo;I&apos;m affected too&rdquo; upvotes):
              </p>
              <ul className="text-xs text-slate-500 list-disc list-inside space-y-1 pt-1">
                <li>1 reporter: 0 pts</li>
                <li>2 to 3 reporters: 10 pts</li>
                <li>4 to 6 reporters: 18 pts</li>
                <li>7 or more reporters: 25 pts</li>
              </ul>
            </div>

            {/* Age Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">4. Age / Stagnation</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  Max 20 pts
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Prevents neglected issues from slipping through the cracks:
              </p>
              <ul className="text-xs text-slate-500 list-disc list-inside space-y-1 pt-1">
                <li>1 point per calendar day open</li>
                <li>Capped at 20 points maximum</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Dynamic Modifiers Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Real-Time Modifiers &amp; Boosts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Weather / Context Boost */}
            <div className="bg-white p-5 rounded-2xl border border-blue-200 bg-blue-50/20 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-blue-950">Context Boost</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                  Up to +15
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Live Open-Meteo precipitation intensity (0.0 to 1.0, normalized against {constants?.heavy_rain_mm ?? 65} mm heavy rain event):
              </p>
              <ul className="text-xs text-slate-500 space-y-1 pt-1">
                <li>• Waterlogging: up to +15</li>
                <li>• Pothole: up to +8</li>
                <li>• Garbage dump: up to +8</li>
                <li>• Broken streetlight: +5 (main road visibility)</li>
              </ul>
            </div>

            {/* Reopen Boost */}
            <div className="bg-white p-5 rounded-2xl border border-rose-200 bg-rose-50/20 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-rose-950">Reopen Boost</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                  Up to +15
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Penalizes unverified or failed fixes:
              </p>
              <ul className="text-xs text-slate-500 space-y-1 pt-1">
                <li>• +5 pts per confirmed dispute</li>
                <li>• Capped at +15 pts (3 reopens)</li>
                <li>• Automatically triggered when {constants?.reopen_threshold ?? 2} citizens vote &ldquo;Not fixed&rdquo;</li>
              </ul>
            </div>

            {/* Fairness Adjustment Card (Part B) */}
            <div className="bg-white p-5 rounded-2xl border border-purple-200 bg-purple-50/20 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-purple-950">Fairness Adjustment</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800">
                  Up to +{constants?.equity_max_points ?? 10}
                </span>
              </div>
              <p className="text-xs text-purple-900 leading-relaxed font-medium">
                Wards where residents report less than the city median get a small boost (up to +{constants?.equity_max_points ?? 10}) for high-exposure issues, so under-reporting does not mean being ignored. It applies only after {constants?.equity_min_reports ?? 10} reports exist city-wide, and only when at least 3 wards have population data.
              </p>
              <p className="text-xs text-slate-500 pt-1">
                When active, an <code>equity adjustment (+N)</code> entry appears in the scoring reasons.
              </p>
            </div>
          </div>
        </section>

        {/* Live Category Weights Table */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              Category Hazard Weights &amp; SLAs
            </h2>
            <span className="text-xs font-semibold text-slate-500">Live Database Values</span>
          </div>

          {isLoading ? (
            <div className="space-y-2 py-4">
              <div className="h-6 bg-slate-100 animate-pulse rounded" />
              <div className="h-6 bg-slate-100 animate-pulse rounded" />
              <div className="h-6 bg-slate-100 animate-pulse rounded" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 text-red-700 text-xs">
              Failed to load categories: {error}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-2">Category</th>
                    <th className="py-2.5 px-2">Base Weight</th>
                    <th className="py-2.5 px-2">Target SLA</th>
                    <th className="py-2.5 px-2">Max Weather Boost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.categories.map((cat) => (
                    <tr key={cat.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-2 font-semibold text-slate-900 flex items-center gap-1.5">
                        <span>{getCategoryEmoji(cat.key)}</span>
                        <span>{cat.label}</span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-700">
                        {cat.base_weight}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700">
                        {cat.sla_hours} hours ({Math.round((cat.sla_hours / 24) * 10) / 10} days)
                      </td>
                      <td className="py-2.5 px-2 text-blue-700 font-semibold">
                        {cat.max_weather_boost > 0 ? `+${cat.max_weather_boost} pts` : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Database-Generated Worked Examples */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Worked Examples (Database-Computed)
            </h2>
            <p className="text-xs text-slate-500">
              Dynamically evaluated by <code>calculate_priority_score()</code> in Postgres
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              <div className="h-28 bg-slate-100 animate-pulse rounded-2xl" />
              <div className="h-28 bg-slate-100 animate-pulse rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-3">
              {data?.examples.map((ex, idx) => {
                const isHigh = ex.result.band === "High";
                const isMed = ex.result.band === "Medium";
                const badgeStyle = isHigh
                  ? "bg-red-100 text-red-800 border-red-200"
                  : isMed
                  ? "bg-amber-100 text-amber-800 border-amber-200"
                  : "bg-emerald-100 text-emerald-800 border-emerald-200";

                return (
                  <div
                    key={idx}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {idx + 1}. {ex.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Inputs: Sev {ex.inputs.severity_pts} pts, Loc {ex.inputs.location_pts} pts, {ex.inputs.unique_reporters} reporters, open {ex.inputs.days_open}d, context {ex.inputs.context_boost_pts} pts
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-black text-slate-950 tracking-tight">
                          {ex.result.total} <span className="text-xs text-slate-400 font-semibold">/ 100</span>
                        </div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-extrabold uppercase border ${badgeStyle}`}
                        >
                          {ex.result.band}
                        </span>
                      </div>
                    </div>

                    {/* Breakdown Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100 text-[11px]">
                      <div>
                        <span className="text-slate-500">Severity: </span>
                        <strong className="text-slate-800">+{ex.result.breakdown.severity}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Location: </span>
                        <strong className="text-slate-800">+{ex.result.breakdown.location}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Frequency: </span>
                        <strong className="text-slate-800">+{ex.result.breakdown.frequency}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Age: </span>
                        <strong className="text-slate-800">+{ex.result.breakdown.age}</strong>
                      </div>
                      {ex.result.breakdown.context_boost > 0 && (
                        <div className="text-blue-700 font-semibold">
                          Weather: +{ex.result.breakdown.context_boost}
                        </div>
                      )}
                      {ex.result.breakdown.reopen_boost > 0 && (
                        <div className="text-rose-700 font-semibold">
                          Reopen: +{ex.result.breakdown.reopen_boost}
                        </div>
                      )}
                      {ex.result.breakdown.equity_adjustment > 0 && (
                        <div className="text-purple-700 font-semibold">
                          Equity: +{ex.result.breakdown.equity_adjustment}
                        </div>
                      )}
                    </div>

                    {/* Generated Sentence */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 italic">
                      &ldquo;{ex.result.reasons_text}&rdquo;
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Built-in Safeguards */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            Built-in Anti-Abuse &amp; Quality Safeguards
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600 leading-relaxed">
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Duplicates Raise the Score</strong>
              Duplicates are treated as valuable community signal, not noise. Nearby reports merge and boost frequency.
            </div>
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Unique Reporters Only</strong>
              Frequency points count unique user identities across reports and upvotes. Spamming multiple tickets has no effect.
            </div>
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Photo Spatial Match</strong>
              Citizen photo metadata must be within {constants?.photo_match_radius_m ?? 200} m of the selected map coordinates.
            </div>
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Verified Resolution Photo</strong>
              Officer proof-of-work photo must be taken within {constants?.resolution_radius_m ?? 100} m of the original issue.
            </div>
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Citizen Fix Confirmation</strong>
              Residents vote &ldquo;Is it fixed?&rdquo;. If {constants?.reopen_threshold ?? 2} citizens dispute a fix, it reopens with an urgency penalty.
            </div>
            <div className="p-3 rounded-xl bg-slate-50 space-y-1">
              <strong className="text-slate-900 block">Automated SLA Escalation</strong>
              Escalates to Department Head at Level 1 ({constants?.sla_level1_factor ?? 1.0}x SLA) and City Admin at Level 2 ({constants?.sla_level2_factor ?? 2.0}x SLA).
            </div>
          </div>
        </section>

        {/* Honest Limits Box */}
        <section className="p-5 rounded-2xl border border-amber-200 bg-amber-50/70 text-xs text-amber-900 space-y-2">
          <div className="flex items-center gap-2 font-bold text-amber-950 text-sm">
            <span>🛡️</span>
            <span>Honest Data Limits</span>
          </div>
          <p className="leading-relaxed">
            To ensure complete integrity during evaluation, please note the following data boundaries:
          </p>
          <ul className="list-disc list-inside space-y-1 text-amber-800">
            <li>Ward boundaries, population figures, and density scores are <strong>simulated mock values</strong> for prototype testing.</li>
            <li>Road network and place landmarks are provided by <strong>OpenStreetMap contributors</strong> and may have community variations.</li>
            <li>Precipitation forecasts and rain intensity readings are retrieved from <strong>Open-Meteo</strong> APIs.</li>
            <li>Administrative escalation hierarchy is simulated for civic auditing demonstrations.</li>
            <li>Photos are checked by an AI model (Google Gemini) before a report is accepted. It can be wrong, so uncertain photos are flagged for an officer instead of silently accepted. Photos are sent to Google for analysis.</li>
          </ul>
        </section>

        {/* Navigation Action Buttons */}
        <section className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href="/tracker"
            className="flex-1 flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all px-6 py-3.5 text-white font-semibold text-sm shadow-xs min-h-[44px]"
          >
            Explore Public Tracker
          </Link>
          <Link
            href="/accountability"
            className="flex-1 flex items-center justify-center rounded-xl bg-white hover:bg-slate-100 active:scale-[0.98] transition-all border border-slate-300 px-6 py-3.5 text-slate-800 font-semibold text-sm shadow-2xs min-h-[44px]"
          >
            View Accountability Scoreboard
          </Link>
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-slate-400 pt-6 border-t border-slate-200">
          Civic Issue Tracker • Transparent Governance Platform
        </footer>
      </div>
    </main>
  );
}
