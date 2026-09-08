import type { RecommendationIntent, RecommendMode } from "./types.js";

const MODES = new Set<RecommendMode>(["normal", "food_waste", "budget"]);
const SPICES = new Set(["mild", "medium", "hot"]);
const SKILLS = new Set(["beginner", "intermediate", "advanced"]);

const CUISINES = [
  "italian",
  "indian",
  "chinese",
  "japanese",
  "mexican",
  "french",
  "american",
  "mediterranean",
  "middle eastern",
  "african",
];

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x ?? "").toLowerCase().trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function asMode(v: unknown): RecommendMode | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.toLowerCase().trim() as RecommendMode;
  return MODES.has(m) ? m : undefined;
}

function asCuisine(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const c = v.toLowerCase().trim();
  if (!c) return null;
  const hit = CUISINES.find((x) => x === c || c.includes(x) || x.includes(c));
  return hit ?? null;
}

function asTime(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < 5 || n > 180) return undefined;
  return n;
}

/**
 * Validate / normalize model or heuristic output into a safe RecommendationIntent.
 * Rejects unknown fields and clamps values to what the engine supports.
 */
export function normalizeIntent(raw: unknown): RecommendationIntent {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const prefsRaw =
    src.preferences && typeof src.preferences === "object"
      ? (src.preferences as Record<string, unknown>)
      : {};

  const spice =
    typeof prefsRaw.spice === "string" && SPICES.has(prefsRaw.spice.toLowerCase())
      ? (prefsRaw.spice.toLowerCase() as "mild" | "medium" | "hot")
      : undefined;
  const skill =
    typeof prefsRaw.skill === "string" && SKILLS.has(prefsRaw.skill.toLowerCase())
      ? (prefsRaw.skill.toLowerCase() as "beginner" | "intermediate" | "advanced")
      : undefined;

  const intent: RecommendationIntent = {};
  const ingredients = asStringArray(src.availableIngredients ?? src.ingredients);
  if (ingredients) intent.availableIngredients = ingredients;
  const time = asTime(src.timeLimit ?? src.maxTime);
  if (time !== undefined) intent.timeLimit = time;
  const cuisine = asCuisine(src.cuisine);
  if (cuisine !== undefined) intent.cuisine = cuisine;
  const mode = asMode(src.mode);
  if (mode) intent.mode = mode;
  if (typeof src.craving === "string" && src.craving.trim()) {
    intent.craving = src.craving.trim().slice(0, 120);
  } else if (src.craving === null) {
    intent.craving = null;
  }

  const preferences: NonNullable<RecommendationIntent["preferences"]> = {};
  if (spice) preferences.spice = spice;
  if (skill) preferences.skill = skill;
  if (prefsRaw.highProtein === true) preferences.highProtein = true;
  if (prefsRaw.lowCarb === true) preferences.lowCarb = true;
  if (Object.keys(preferences).length) intent.preferences = preferences;

  return intent;
}

/** Extract first JSON object from a model reply (tolerates markdown fences). */
export function extractJsonObject(text: string): unknown {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("empty AI response");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("malformed AI JSON");
  }
}

export { CUISINES, MODES };
