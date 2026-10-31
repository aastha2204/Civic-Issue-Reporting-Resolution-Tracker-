"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { LOCALE_META, Locale, LOCALES } from "@/i18n/config";

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  currentValue: string;
  className?: string;
}

export default function VoiceRecorder({
  onTranscript,
  currentValue,
  className = "",
}: VoiceRecorderProps) {
  const { locale, t } = useLanguage();
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimText, setInterimText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState<Locale>(locale);
  const [hasRecorded, setHasRecorded] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);

  // Sync voice language with global locale on initial or change
  useEffect(() => {
    setVoiceLang(locale);
  }, [locale]);

  // Check browser support on client mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore cleanup abort
        }
      }
    };
  }, []);

  const startListening = useCallback(() => {
    setErrorMessage(null);
    setInterimText("");

    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      setErrorMessage(t("voice.unsupportedBrowser", "Speech recognition is not supported in this browser. Please type manually."));
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = LOCALE_META[voiceLang]?.speechCode || "en-IN";

      recognition.onstart = () => {
        setIsListening(true);
        setHasRecorded(true);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (interimTranscript) {
          setInterimText(interimTranscript);
        }

        if (finalTranscript) {
          // Append final transcript cleanly to currentValue
          const trimmed = finalTranscript.trim();
          if (trimmed) {
            const separator = currentValue && !currentValue.endsWith(" ") ? " " : "";
            const newTotal = (currentValue + separator + trimmed).trim();
            onTranscript(newTotal);
            setInterimText("");
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setErrorMessage(
            t(
              "voice.micDenied",
              "Microphone permission denied. Please allow microphone access in your browser settings."
            )
          );
        } else if (event.error === "no-speech") {
          setErrorMessage(
            t("voice.noSpeech", "No speech detected. Please click Retry and speak clearly.")
          );
        } else if (event.error === "network") {
          setErrorMessage(
            t("voice.networkError", "Speech recognition network error. Please try again or type manually.")
          );
        } else {
          setErrorMessage(`Microphone error (${event.error}). Please type manually.`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err: any) {
      console.error("Failed to start speech recognition", err);
      setErrorMessage("Could not initialize microphone. Please type manually.");
      setIsListening(false);
    }
  }, [voiceLang, currentValue, onTranscript, t]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  const retryVoice = useCallback(() => {
    stopListening();
    setInterimText("");
    setErrorMessage(null);
    startListening();
  }, [stopListening, startListening]);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Voice Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-100 border border-slate-200">
        <div className="flex items-center gap-2">
          {!isListening ? (
            <button
              type="button"
              onClick={startListening}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold transition-all shadow-xs min-h-[36px]"
              title={t("voice.micButtonTooltip", "Speak complaint description")}
            >
              <span className="text-sm">🎙️</span>
              <span>{t("voice.startVoice", "Speak Description")}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopListening}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold transition-all shadow-xs animate-pulse min-h-[36px]"
            >
              <span className="text-sm">⏹️</span>
              <span>{t("voice.stop", "Done Speaking")}</span>
            </button>
          )}

          {hasRecorded && !isListening && (
            <button
              type="button"
              onClick={retryVoice}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold transition-all min-h-[36px]"
            >
              <span>🔄</span>
              <span>{t("voice.retry", "Retry")}</span>
            </button>
          )}
        </div>

        {/* Voice Language Toggle */}
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
          <span className="hidden sm:inline">{t("voice.speechLanguage", "Voice")}:</span>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden bg-white">
            {LOCALES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setVoiceLang(lang)}
                disabled={isListening}
                className={`px-2 py-1 text-[11px] font-bold transition-colors ${
                  voiceLang === lang
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                } ${isListening ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {LOCALE_META[lang].nativeName}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live speech feedback during listening */}
      {isListening && (
        <div className="p-2.5 rounded-xl bg-blue-50/80 border border-blue-200 text-xs text-blue-900 flex items-center gap-2 animate-in fade-in duration-150">
          <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold block">{t("voice.listening", "Listening... Speak now")}</span>
            {interimText && (
              <p className="text-blue-800 italic mt-0.5 truncate text-[11px]">
                &ldquo;{interimText}&rdquo;
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error or Fallback Message */}
      {errorMessage && (
        <div
          role="alert"
          className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2 shadow-2xs"
        >
          <span className="text-sm shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="leading-snug">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-amber-700 hover:text-amber-900 font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Unsupported Browser Fallback Notice */}
      {!isSupported && (
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
          <span>ℹ️</span>
          <span>
            {t(
              "voice.unsupportedBrowser",
              "Speech recognition is not supported in this browser. Please type manually."
            )}
          </span>
        </div>
      )}
    </div>
  );
}
