"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  Locale,
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  LOCALE_META,
} from "./config";
import enMessages from "./messages/en.json";
import hiMessages from "./messages/hi.json";
import paMessages from "./messages/pa.json";

export const MESSAGES: Record<Locale, Record<string, any>> = {
  en: enMessages,
  hi: hiMessages,
  pa: paMessages,
};

interface LanguageContextType {
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  t: (path: string, fallback?: string) => string;
  isReady: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (path: string, fallback?: string) => fallback || path,
  isReady: false,
});

function getNestedValue(obj: Record<string, any>, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [isReady, setIsReady] = useState<boolean>(false);

  // Initialize locale from localStorage or cookie on client mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null;
      if (stored && LOCALES.includes(stored)) {
        setLocaleState(stored);
        document.documentElement.lang = stored;
        setIsReady(true);
        return;
      }

      // Check cookie fallback
      const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_KEY}=([^;]*)`));
      const cookieLocale = match ? (decodeURIComponent(match[1]) as Locale) : null;
      if (cookieLocale && LOCALES.includes(cookieLocale)) {
        setLocaleState(cookieLocale);
        document.documentElement.lang = cookieLocale;
        setIsReady(true);
        return;
      }
    } catch {
      // Storage access may fail in restricted iframes
    }
    setIsReady(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    if (!LOCALES.includes(newLocale)) return;
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
      // Set cookie for 1 year across whole domain
      document.cookie = `${LOCALE_COOKIE_KEY}=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
      if (typeof document !== "undefined") {
        document.documentElement.lang = newLocale;
      }
    } catch (err) {
      console.warn("Could not persist locale to storage", err);
    }
  }, []);

  const t = useCallback(
    (path: string, fallback?: string): string => {
      const activeDict = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
      const translated = getNestedValue(activeDict, path);
      if (translated !== undefined) {
        return translated;
      }

      // Fallback to English dictionary if not found in active locale
      if (locale !== DEFAULT_LOCALE) {
        const enFallback = getNestedValue(MESSAGES[DEFAULT_LOCALE], path);
        if (enFallback !== undefined) return enFallback;
      }

      return fallback !== undefined ? fallback : path;
    },
    [locale]
  );

  const contextValue = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      isReady,
    }),
    [locale, setLocale, t, isReady]
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        {children}
      </NextIntlClientProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * Category translation helper that retrieves the localized category label.
 */
export function getCategoryTranslation(
  categoryKey: string | null | undefined,
  locale: Locale,
  fallbackLabel?: string
): string {
  if (!categoryKey) return fallbackLabel || "Other";
  const normalized = categoryKey.toLowerCase();
  const dict = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
  return (
    dict?.categories?.[normalized] ||
    MESSAGES.en?.categories?.[normalized] ||
    fallbackLabel ||
    categoryKey
  );
}

/**
 * Status translation helper for pipeline states.
 */
export function getStatusTranslation(statusKey: string | null | undefined, locale: Locale): string {
  if (!statusKey) return "";
  const normalized = statusKey.toLowerCase();
  const dict = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
  return dict?.statuses?.[normalized] || MESSAGES.en?.statuses?.[normalized] || statusKey;
}

/**
 * Severity level translation helper.
 */
export function getSeverityTranslation(severityKey: string | null | undefined, locale: Locale): string {
  if (!severityKey) return "";
  const normalized = severityKey.toLowerCase();
  const dict = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
  return dict?.severities?.[normalized] || MESSAGES.en?.severities?.[normalized] || severityKey;
}

/**
 * Priority band translation helper.
 */
export function getPriorityBandTranslation(band: string | null | undefined, locale: Locale): string {
  if (!band) return "";
  const dict = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
  return dict?.priorityBands?.[band] || MESSAGES.en?.priorityBands?.[band] || band;
}
