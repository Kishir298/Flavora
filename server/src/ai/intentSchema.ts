import type { CravingSignals, DietaryPreference, FoodRequest, MealType, RecommendationIntent, RecommendMode } from "./types.js";

/**
 * Controlled craving vocabulary — mirrors engine/craving.js CRAVING_VOCABULARY.
 * Kept in sync manually; AI output values outside this set are dropped.
 */
const CRAVING_VOCABULARY: Record<keyof CravingSignals, string[]> = {
  textures: ["crispy", "crunchy", "creamy", "tender", "fluffy", "chewy"],
  flavors: ["spicy", "savory", "sweet", "tangy", "smoky", "fresh", "cheesy", "umami", "herby"],
  moods: ["comforting", "cozy", "refreshing", "indulgent", "homely"],
  temperature: ["warm", "hot dish", "cold", "chilled"],
  satiety: ["filling", "hearty", "light", "substantial"],
  mealStyle: ["quick", "one-pot", "snack", "breakfast", "dessert", "handheld"],
};

/** Validate untrusted craving signals against the controlled vocabulary. */
function asCravingSignals(v: unknown): CravingSignals | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const src = v as Record<string, unknown>;
  const out: CravingSignals = {};
  for (const [dim, allowed] of Object.entries(CRAVING_VOCABULARY)) {
    const arr = src[dim];
    if (!Array.isArray(arr)) continue;
    const values = arr
      .map((x) => String(x ?? "").toLowerCase().trim())
      .filter((x) => allowed.includes(x));
    if (values.length) (out as Record<string, string[]>)[dim] = [...new Set(values)].slice(0, 4);
  }
  return Object.keys(out).length ? out : undefined;
}

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

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function asMealType(v: unknown): MealType | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.toLowerCase().trim() as string;
  // FlavoraLM grammar historically emits "dessert" (mealStyle vocab leak).
  // Dessert is not a meal slot — map it to snack so the value isn't silently dropped.
  if (m === "dessert") return "snack";
  return (MEAL_TYPES as string[]).includes(m) ? (m as MealType) : undefined;
}

function asCalories(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < 50 || n > 5000) return undefined;
  return n;
}

function asDiet(v: unknown): DietaryPreference | undefined {
  if (typeof v !== "string") return undefined;
  const d = v.toLowerCase().trim().replace(/[_\s]+/g, "-");
  if (d === "vegetarian" || d === "veg") return "vegetarian";
  if (d === "vegan") return "vegan";
  if (d === "non-vegetarian" || d === "nonvegetarian" || d === "non-veg" || d === "nonveg") return "non-vegetarian";
  if (d === "any" || d === "anything" || d === "no-preference") return "any";
  return undefined;
}

function asServings(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < 1 || n > 20) return undefined;
  return n;
}

/** Build the canonical FoodRequest view from any raw intent object. */
export function toFoodRequest(intent: RecommendationIntent): FoodRequest {
  const fr: FoodRequest = { ...(intent.foodRequest ?? {}) };
  if (intent.craving != null && fr.craving === undefined) fr.craving = intent.craving ?? undefined;
  if (intent.cuisine !== undefined && fr.cuisine === undefined) fr.cuisine = intent.cuisine;
  if (intent.availableIngredients && fr.availableIngredients === undefined) {
    fr.availableIngredients = intent.availableIngredients;
  }
  if (intent.allergies && fr.allergies === undefined) fr.allergies = intent.allergies;
  if (intent.avoidFoods && fr.avoidFoods === undefined) fr.avoidFoods = intent.avoidFoods;
  if (intent.timeLimit !== undefined && fr.maxCookingTime === undefined) fr.maxCookingTime = intent.timeLimit;
  if (intent.preferences?.spice && fr.spiceLevel === undefined) fr.spiceLevel = intent.preferences.spice;
  if (intent.preferences?.skill && fr.skillLevel === undefined) fr.skillLevel = intent.preferences.skill;
  return fr;
}

/**
 * Validate / normalize model or heuristic output into a safe RecommendationIntent.
 * Rejects unknown fields and clamps values to what the engine supports.
 */
export function normalizeIntent(raw: unknown): RecommendationIntent {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Accept an already-normalized foodRequest (e.g. heuristic output passed
  // through normalizeIntent twice) — top-level aliases override it below.
  const nestedFr =
    src.foodRequest && typeof src.foodRequest === "object" && !Array.isArray(src.foodRequest)
      ? (src.foodRequest as Record<string, unknown>)
      : {};
  const nested = (k: string): unknown => (nestedFr[k] !== undefined ? nestedFr[k] : undefined);
  const prefsRaw =
    src.preferences && typeof src.preferences === "object"
      ? (src.preferences as Record<string, unknown>)
      : {};

  const spiceRaw =
    typeof prefsRaw.spice === "string"
      ? prefsRaw.spice
      : typeof src.spicePreference === "string"
        ? (src.spicePreference as string)
        : typeof src.spice === "string"
          ? (src.spice as string)
          : undefined;
  const spice =
    typeof spiceRaw === "string" && SPICES.has(spiceRaw.toLowerCase())
      ? (spiceRaw.toLowerCase() as "mild" | "medium" | "hot")
      : undefined;
  const skillRaw =
    typeof prefsRaw.skill === "string"
      ? prefsRaw.skill
      : typeof src.skillLevel === "string"
        ? (src.skillLevel as string)
        : typeof src.skill === "string"
          ? (src.skill as string)
          : undefined;
  const skill =
    typeof skillRaw === "string" && SKILLS.has(skillRaw.toLowerCase())
      ? (skillRaw.toLowerCase() as "beginner" | "intermediate" | "advanced")
      : undefined;

  const intent: RecommendationIntent = {};
  const ingredients = asStringArray(src.availableIngredients ?? src.ingredients);
  if (ingredients) intent.availableIngredients = ingredients;
  const expiring = asStringArray(src.expiringIngredients ?? (src as Record<string, unknown>).expiring);
  if (expiring) intent.expiringIngredients = expiring.slice(0, 12);
  const rawTime = src.timeLimit ?? (src as Record<string, unknown>).timelimit ?? (src as Record<string, unknown>).time_limit ?? src.maxTime;
  const time = asTime(rawTime);
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
  const cravingSignals = asCravingSignals(src.cravingSignals);
  if (cravingSignals) intent.cravingSignals = cravingSignals;

  const preferences: NonNullable<RecommendationIntent["preferences"]> = {};
  if (spice) preferences.spice = spice;
  if (skill) preferences.skill = skill;
  if (prefsRaw.highProtein === true) preferences.highProtein = true;
  if (prefsRaw.lowCarb === true) preferences.lowCarb = true;
  if (Object.keys(preferences).length) intent.preferences = preferences;

  // Additive safety constraints from natural language ("allergic to peanuts",
  // "no mushrooms"). These only ever ADD exclusions downstream — the route
  // unions them with the stored profile before the hard filter runs.
  const allergies = asStringArray(src.allergies ?? src.allergens);
  if (allergies) intent.allergies = allergies.slice(0, 12);
  const avoidFoods = asStringArray(src.avoidFoods ?? src.avoid_foods ?? src.avoid);
  if (avoidFoods) intent.avoidFoods = avoidFoods.slice(0, 12);

  // Conversational slots (§15) — top-level aliases accepted from FlavoraLM.
  // Mirror flat slots onto the intent too so single-turn callers that read
  // intent.mealType / calorieTarget directly (not via foodRequest) keep working.
  const mealType = asMealType(nested("mealType") ?? src.mealType ?? src.meal);
  const calorieTarget = asCalories(nested("calorieTarget") ?? src.calorieTarget ?? src.calories ?? src.maxCalories);
  const dietaryPreference = asDiet(nested("dietaryPreference") ?? src.dietaryPreference ?? src.diet ?? src.dietary);
  const spiceRawTop = nested("spiceLevel") ?? src.spiceLevel;
  const spiceLevel =
    typeof spiceRawTop === "string" && SPICES.has(String(spiceRawTop).toLowerCase())
      ? (String(spiceRawTop).toLowerCase() as "mild" | "medium" | "hot")
      : undefined;
  const skillRawTop = nested("skillLevel") ?? src.skillLevel;
  const skillLevel =
    typeof skillRawTop === "string" && SKILLS.has(String(skillRawTop).toLowerCase())
      ? (String(skillRawTop).toLowerCase() as "beginner" | "intermediate" | "advanced")
      : undefined;
  const servings = asServings(nested("servings") ?? src.servings);
  const maxCookingTime = asTime(nested("maxCookingTime") ?? src.maxCookingTime ?? src.cookTime ?? src.cookingTime);
  if (mealType) intent.mealType = mealType;
  if (calorieTarget !== undefined) intent.calorieTarget = calorieTarget;
  if (dietaryPreference) intent.dietaryPreference = dietaryPreference;
  if (spiceLevel) intent.spiceLevel = spiceLevel;
  if (skillLevel) intent.skillLevel = skillLevel;
  if (servings !== undefined) intent.servings = servings;
  if (maxCookingTime !== undefined) intent.maxCookingTime = maxCookingTime;
  if (mealType || calorieTarget !== undefined || dietaryPreference || spiceLevel || skillLevel || servings !== undefined || maxCookingTime !== undefined) {
    const fr: FoodRequest = { ...(intent.foodRequest ?? {}) };
    if (mealType) fr.mealType = mealType;
    if (calorieTarget !== undefined) fr.calorieTarget = calorieTarget;
    if (dietaryPreference) fr.dietaryPreference = dietaryPreference;
    if (spiceLevel) fr.spiceLevel = spiceLevel;
    if (skillLevel) fr.skillLevel = skillLevel;
    if (servings !== undefined) fr.servings = servings;
    if (maxCookingTime !== undefined) fr.maxCookingTime = maxCookingTime;
    if (typeof src.craving === "string" && src.craving.trim() && fr.craving === undefined) {
      fr.craving = src.craving.trim().slice(0, 120);
    }
    if (intent.availableIngredients && fr.availableIngredients === undefined) {
      fr.availableIngredients = intent.availableIngredients;
    }
    if (intent.allergies && fr.allergies === undefined) fr.allergies = intent.allergies;
    if (intent.avoidFoods && fr.avoidFoods === undefined) fr.avoidFoods = intent.avoidFoods;
    if (intent.cuisine !== undefined && fr.cuisine === undefined) fr.cuisine = intent.cuisine;
    intent.foodRequest = fr;
  }

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

export { CUISINES, MODES, CRAVING_VOCABULARY };
