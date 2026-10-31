"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { LOCALE_META, Locale } from "@/i18n/config";

interface TextToSpeechButtonProps {
  text: string;
  label?: string;
  langCode?: string;
  size?: "sm" | "md";
  variant?: "pill" | "icon";
  className?: string;
}

export default function TextToSpeechButton({
  text,
  label,
  langCode,
  size = "sm",
  variant = "pill",
  className = "",
}: TextToSpeechButtonProps) {
  const { locale, t } = useLanguage();
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setIsSupported(false);
    }
  }, []);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSpeakToggle = useCallback(() => {
    if (!isSupported || !text || typeof window === "undefined") return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    // Cancel any previous speech
    window.speechSynthesis.cancel();

    const targetLang = langCode || LOCALE_META[locale]?.speechCode || "en-IN";
    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;
    utterance.lang = targetLang;
    utterance.rate = 0.95; // slightly slower for civic clarity

    // Select suitable voice if available
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      // Find matching voice or language prefix
      const match =
        voices.find((v) => v.lang.toLowerCase() === targetLang.toLowerCase()) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2).toLowerCase())) ||
        voices.find((v) => v.lang.toLowerCase().includes("in"));

      if (match) {
        utterance.voice = match;
      }
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, [isSupported, text, isSpeaking, langCode, locale]);

  if (!isSupported) {
    return null;
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleSpeakToggle}
        disabled={!text}
        className={`p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 ${
          isSpeaking ? "text-blue-600 bg-blue-50 animate-pulse" : ""
        } ${className}`}
        title={
          isSpeaking
            ? t("tts.stopReading", "Stop audio")
            : label || t("tts.readAloud", "Read aloud")
        }
        aria-label={label || t("tts.readAloud", "Read aloud")}
      >
        <span className="text-sm select-none" aria-hidden="true">
          {isSpeaking ? "⏹️" : "🔊"}
        </span>
      </button>
    );
  }

  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs gap-1.5 min-h-[32px]" : "px-3 py-1.5 text-xs gap-2 min-h-[38px]";

  return (
    <button
      type="button"
      onClick={handleSpeakToggle}
      disabled={!text}
      className={`inline-flex items-center rounded-xl border font-semibold transition-all shadow-2xs select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 ${
        isSpeaking
          ? "bg-rose-50 border-rose-300 text-rose-700 animate-pulse"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
      } ${sizeClasses} ${className}`}
      title={
        isSpeaking
          ? t("tts.stopReading", "Stop audio")
          : label || t("tts.readAloud", "Read aloud")
      }
    >
      <span className="text-sm" aria-hidden="true">
        {isSpeaking ? "⏹️" : "🔊"}
      </span>
      <span>
        {isSpeaking
          ? t("tts.stopReading", "Stop")
          : label || t("tts.readAloud", "Listen")}
      </span>
    </button>
  );
}
