export const LOCALES = ["en", "hi", "pa"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleMeta {
  code: Locale;
  label: string;
  nativeName: string;
  flag: string;
  speechCode: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    code: "en",
    label: "English",
    nativeName: "English",
    flag: "🇬🇧",
    speechCode: "en-IN",
  },
  hi: {
    code: "hi",
    label: "Hindi",
    nativeName: "हिन्दी",
    flag: "🇮🇳",
    speechCode: "hi-IN",
  },
  pa: {
    code: "pa",
    label: "Punjabi",
    nativeName: "ਪੰਜਾਬੀ",
    flag: "🇮🇳",
    speechCode: "pa-IN",
  },
};

export const LOCALE_COOKIE_KEY = "NEXT_LOCALE";
export const LOCALE_STORAGE_KEY = "civic_tracker_locale";
