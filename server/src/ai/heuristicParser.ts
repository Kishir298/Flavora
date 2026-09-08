import { CUISINES, normalizeIntent } from "./intentSchema.js";
import type { RecommendationIntent } from "./types.js";

/**
 * Deterministic NL → intent fallback when Groq is unavailable.
 * Never invents recipes — only structured recommendation parameters.
 */
export function parseIntentHeuristic(message: string): RecommendationIntent {
  const text = String(message ?? "").toLowerCase().trim();
  const raw: Record<string, unknown> = {};

  // Time: "20 minutes", "in 30 min", "only have 15 minutes"
  const timeMatch = text.match(/\b(\d{1,3})\s*(?:minutes?|mins?|min)\b/);
  if (timeMatch) raw.timeLimit = Number(timeMatch[1]);

  // Mode signals
  if (/\b(cheap|budget|inexpensive|low[- ]?cost|affordable)\b/.test(text)) {
    raw.mode = "budget";
  } else if (
    /\b(what i (already )?have|use (up|what)|leftover|food waste|with what i)\b/.test(text) ||
    /\bi have\b/.test(text)
  ) {
    raw.mode = "food_waste";
  } else {
    raw.mode = "normal";
  }

  // Cuisine
  for (const c of CUISINES) {
    if (text.includes(c)) {
      raw.cuisine = c;
      break;
    }
  }
  if (!raw.cuisine && /\bindian food\b/.test(text)) raw.cuisine = "indian";

  // Spice / skill preferences
  const preferences: Record<string, unknown> = {};
  if (/\b(spicy|hot)\b/.test(text)) preferences.spice = "hot";
  else if (/\bmild\b/.test(text)) preferences.spice = "mild";
  if (/\b(beginner|easy|simple)\b/.test(text)) preferences.skill = "beginner";
  else if (/\badvanced\b/.test(text)) preferences.skill = "advanced";
  if (/\bhigh[- ]?protein\b/.test(text) || /\bprotein\b/.test(text)) preferences.highProtein = true;
  if (/\blow[- ]?carb\b/.test(text)) preferences.lowCarb = true;
  if (Object.keys(preferences).length) raw.preferences = preferences;

  // Ingredients after "I have …" / "with …"
  const haveMatch =
    text.match(/\bi have\s+([^.?!]+)/i) ||
    text.match(/\bwith\s+([^.?!]+?)(?:\.|$|\?|what|make)/i) ||
    text.match(/\busing\s+([^.?!]+)/i);
  if (haveMatch) {
    const chunk = haveMatch[1]
      .replace(/\band\b/g, ",")
      .replace(/\b(what|can|i|make|cook|tonight|already|only|just)\b/g, " ");
    const parts = chunk
      .split(/,|\/|&/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40 && !/^\d+$/.test(s));
    if (parts.length) raw.availableIngredients = parts;
  }

  // Soft craving: keep short free-text when vague
  if (/\b(surprise|don't know|dont know|anything|whatever)\b/.test(text)) {
    raw.craving = "surprise me";
  } else if (/\bspicy\b/.test(text)) {
    raw.craving = "something spicy";
  } else if (/\bcomfort\b/.test(text)) {
    raw.craving = "comfort food";
  }

  return normalizeIntent(raw);
}
