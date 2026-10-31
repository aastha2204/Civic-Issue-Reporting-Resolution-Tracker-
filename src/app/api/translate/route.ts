import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface TranslationResponse {
  detected_language: string;
  translated_text: string;
  is_already_english: boolean;
  summary?: string;
  landmarks_extracted?: string[];
}

/**
 * Heuristic detector for script classification when Gemini API is unavailable or offline.
 */
function heuristicTranslate(text: string): TranslationResponse {
  const isDevanagari = /[\u0900-\u097F]/.test(text);
  const isGurmukhi = /[\u0A00-\u0A7F]/.test(text);

  if (isGurmukhi) {
    return {
      detected_language: "Punjabi (ਪੰਜਾਬੀ)",
      is_already_english: false,
      translated_text: `[Punjabi] ${text} (Civic issue report requiring officer review)`,
      summary: "Citizen complaint submitted in Punjabi script.",
    };
  }

  if (isDevanagari) {
    return {
      detected_language: "Hindi (हिन्दी)",
      is_already_english: false,
      translated_text: `[Hindi] ${text} (Civic issue report requiring officer review)`,
      summary: "Citizen complaint submitted in Hindi / Devanagari script.",
    };
  }

  return {
    detected_language: "English",
    is_already_english: true,
    translated_text: text,
    summary: text.slice(0, 80),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({
        ok: true,
        translated_text: "",
        detected_language: "English",
        is_already_english: true,
      });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    // Fallback if Gemini key is not configured in current environment
    if (!geminiApiKey) {
      console.warn("GEMINI_API_KEY is not configured; using heuristic language translation.");
      const heuristic = heuristicTranslate(text);
      return NextResponse.json({
        ok: true,
        ...heuristic,
        fallback: true,
      });
    }

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      geminiModel
    )}:generateContent`;

    const promptText = `You are an expert civic complaint translator for Indian municipal corporations.
A citizen has submitted a public civic issue report. Municipal field officers need this translated into clear, professional English so they can inspect and resolve the problem promptly.

Instructions:
1. Detect the original language (e.g. "Hindi", "Punjabi", "English", "Hinglish", "Bengali", "Tamil", "Marathi", etc.).
2. If the text is already completely or predominantly in English, set is_already_english to true and keep the translated_text identical to the original (light grammatical cleanup only if needed).
3. If the text is in Hindi, Punjabi, Hinglish, or any other regional language, accurately translate it into fluent English.
4. Strictly preserve all specific locations, road names, lane numbers, landmarks, water bodies, shops, urgency levels, and safety hazards mentioned.
5. Provide a short 1-sentence summary of the core complaint.

Text to translate:
"""${text}"""`;

    const requestBody = {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            detected_language: { type: "STRING" },
            translated_text: { type: "STRING" },
            is_already_english: { type: "BOOLEAN" },
            summary: { type: "STRING" },
            landmarks_extracted: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
          required: ["detected_language", "translated_text", "is_already_english"],
        },
      },
    };

    const response = await fetch(geminiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`Gemini translation request failed with status: ${response.status}`);
      const heuristic = heuristicTranslate(text);
      return NextResponse.json({
        ok: true,
        ...heuristic,
        fallback: true,
        apiStatus: response.status,
      });
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      const heuristic = heuristicTranslate(text);
      return NextResponse.json({
        ok: true,
        ...heuristic,
        fallback: true,
      });
    }

    try {
      const parsed: TranslationResponse = JSON.parse(candidateText);
      return NextResponse.json({
        ok: true,
        detected_language: parsed.detected_language || "Unknown",
        translated_text: parsed.translated_text || text,
        is_already_english: !!parsed.is_already_english,
        summary: parsed.summary || "",
        landmarks_extracted: parsed.landmarks_extracted || [],
        model_used: geminiModel,
      });
    } catch {
      return NextResponse.json({
        ok: true,
        ...heuristicTranslate(text),
        fallback: true,
      });
    }
  } catch (err: any) {
    console.error("AI translation API error:", err);
    return NextResponse.json(
      { error: "Translation request timed out or failed", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
