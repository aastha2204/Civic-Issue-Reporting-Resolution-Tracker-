"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/i18n/LanguageContext";
import { LOCALES, LOCALE_META, Locale } from "@/i18n/config";

export default function Navbar() {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const navLinks = [
    { href: "/report", labelKey: "nav.report" },
    { href: "/tracker", labelKey: "nav.tracker" },
    { href: "/accountability", labelKey: "nav.scoreboard" },
    { href: "/officer", labelKey: "nav.officer" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md transition-colors shadow-2xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo & Brand */}
          <Link
            href="/"
            className="flex items-center gap-2.5 min-h-[44px] group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
          >
            <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-xs font-bold tracking-wider uppercase text-slate-800 group-hover:text-blue-600 transition-colors">
                {t("nav.platformTitle", "Civic Platform • India")}
              </span>
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                {t("nav.geoTagged", "Geo-Tagged Resolution System")}
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] flex items-center ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-bold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>

          {/* Right Side: Language Selector & Mobile Menu Toggle */}
          <div className="flex items-center gap-2">
            {/* Language Selector Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 hover:bg-white text-xs font-bold text-slate-800 shadow-2xs transition-all min-h-[40px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label={t("nav.language", "Language")}
                aria-expanded={langMenuOpen}
              >
                <span className="text-sm">🌐</span>
                <span className="hidden xs:inline">{LOCALE_META[locale].nativeName}</span>
                <span className="xs:hidden uppercase text-[11px] font-extrabold">{locale}</span>
                <span className="text-[10px] text-slate-400">▼</span>
              </button>

              {langMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setLangMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-white border border-slate-200 shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      {t("nav.language", "Select Language")}
                    </div>
                    {LOCALES.map((loc) => {
                      const meta = LOCALE_META[loc];
                      const isSelected = locale === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => {
                            setLocale(loc);
                            setLangMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-left transition-colors min-h-[40px] ${
                            isSelected
                              ? "bg-blue-50 text-blue-700 font-bold"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{meta.flag}</span>
                            <span>{meta.nativeName}</span>
                            <span className="text-[11px] text-slate-400">({meta.label})</span>
                          </div>
                          {isSelected && <span className="text-blue-600 font-bold">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center border border-slate-200"
              aria-label="Toggle navigation menu"
            >
              <span className="text-base">{mobileMenuOpen ? "✕" : "☰"}</span>
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-3 border-t border-slate-200 space-y-1 animate-in fade-in duration-100">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors min-h-[44px] flex items-center ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-bold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
}
