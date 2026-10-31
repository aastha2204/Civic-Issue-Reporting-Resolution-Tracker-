"use client";

import Link from "next/link";
import { useLanguage } from "@/i18n/LanguageContext";

export default function Home() {
  const { t } = useLanguage();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Bar / Branding */}
      <header className="w-full max-w-md mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-500">
            Civic Platform • India
          </span>
        </div>
      </header>

      {/* Hero / Main Content */}
      <section className="w-full max-w-md mx-auto my-auto text-center py-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium mb-6">
          <span>📍</span>
          <span>{t("home.badge", "Geo-Tagged Resolution System")}</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mb-4">
          {t("home.title", "Civic Issue Tracker")}
        </h1>

        <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal mb-8">
          {t("home.tagline", "Report it. See why it ranks. Watch it get fixed.")}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 w-full">
          <Link
            href="/report"
            className="w-full flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all px-6 py-4 text-white font-semibold text-base shadow-sm shadow-blue-500/20"
          >
            {t("home.reportButton", "Report an issue")}
          </Link>

          <Link
            href="/tracker"
            className="w-full flex items-center justify-center rounded-xl bg-white hover:bg-slate-100 active:scale-[0.98] transition-all border border-slate-300 px-6 py-4 text-slate-800 font-semibold text-base shadow-xs"
          >
            {t("home.trackerButton", "Public tracker")}
          </Link>

          <div className="flex flex-col items-center gap-2 pt-2">
            <Link
              href="/how-scoring-works"
              className="text-xs sm:text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors underline underline-offset-4 inline-flex items-center min-h-[44px]"
            >
              {t("home.howScoringWorks", "How scoring works")}
            </Link>

            <Link
              href="/accountability"
              className="text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors underline underline-offset-4 inline-flex items-center"
            >
              {t("home.accountabilityLink", "Municipal Scoreboard & Equity")}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-md mx-auto text-center text-xs text-slate-400 py-4">
        {t("home.footer", "Transparent civic governance & verified resolutions")}
      </footer>
    </main>
  );
}
