/**
 * Shared category emojis and helpers for the Civic Issue Tracker.
 * Used across the report submission form, issue detail page, and public tracker.
 */

export const CATEGORY_EMOJIS: Record<string, string> = {
  pothole: "🕳️",
  waterlogging: "🌊",
  garbage: "🗑️",
  broken_streetlight: "💡",
  open_manhole: "⚠️",
  water_leak: "🚰",
  drainage: "🚯",
  damaged_road_marking: "🛣️",
  other: "❓",
};

/**
 * Returns the corresponding emoji for a category key, falling back to ❓.
 */
export function getCategoryEmoji(category: string | null | undefined): string {
  if (!category) return "❓";
  return CATEGORY_EMOJIS[category.toLowerCase()] || "❓";
}
