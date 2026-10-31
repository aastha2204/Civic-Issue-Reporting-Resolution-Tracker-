"use client";

import React, { useState, useEffect } from "react";
import TextToSpeechButton from "@/components/TextToSpeechButton";

interface OfficerAiTranslationCardProps {
  originalText: string;
  className?: string;
}

export default function OfficerAiTranslationCard({
  originalText,
  className = "",
}: OfficerAiTranslationCardProps) {
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [isAlreadyEnglish, setIsAlreadyEnglish] = useState<boolean>(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [landmarks, setLandmarks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!originalText || !originalText.trim()) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: originalText }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.ok) {
          setTranslatedText(data.translated_text);
          setDetectedLanguage(data.detected_language);
          setIsAlreadyEnglish(!!data.is_already_english);
          setSummary(data.summary || null);
          setLandmarks(data.landmarks_extracted || []);
        } else {
          setError(data.error || "Failed to translate complaint.");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError("Network error while requesting AI translation.");
        console.error(err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [originalText]);

  if (!originalText || !originalText.trim()) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Original Citizen Complaint */}
      <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Citizen Description (Original)
            </span>
            {detectedLanguage && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 text-slate-700">
                {detectedLanguage}
              </span>
            )}
          </div>
          <TextToSpeechButton text={originalText} size="sm" variant="pill" />
        </div>
        <p className="text-sm text-slate-800 leading-relaxed font-normal whitespace-pre-wrap">
          {originalText}
        </p>
      </div>

      {/* 2. AI English Translation for Officers */}
      <div className="space-y-2 bg-gradient-to-br from-indigo-50/70 via-blue-50/40 to-white p-4 rounded-2xl border border-indigo-200/80 shadow-2xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-base select-none">✨</span>
            <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-950">
              AI English Translation (Gemini)
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
              {isAlreadyEnglish ? "Original in English" : "Officer English View"}
            </span>
          </div>

          {translatedText && !isLoading && (
            <TextToSpeechButton
              text={translatedText}
              langCode="en-IN"
              label="Read English"
              size="sm"
              variant="pill"
            />
          )}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 py-2 text-xs font-semibold text-indigo-700">
            <span className="animate-spin text-sm">⏳</span>
            <span>Translating complaint into English using Gemini...</span>
          </div>
        )}

        {error && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <span>{error}</span>
          </div>
        )}

        {translatedText && !isLoading && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900 leading-relaxed bg-white/90 p-3 rounded-xl border border-indigo-100 shadow-2xs whitespace-pre-wrap">
              {translatedText}
            </p>

            {landmarks && landmarks.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 text-xs">
                <span className="text-slate-500 font-medium">📍 Landmarks:</span>
                {landmarks.map((mark, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-white text-slate-700 text-[11px] font-semibold border border-slate-200"
                  >
                    {mark}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
