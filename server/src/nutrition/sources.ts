/**
 * Nutrition source contract — every nutrition value served by Flavora carries
 * a source tag so the UI can never present a guessed number as measured.
 * - "authored": curated in data/recipes.json (current: all 80 recipes).
 * - "usda": USDA FoodData Central (CC0, optional online enrichment).
 * - "openfoodfacts": Open Food Facts (ODbL, optional online enrichment).
 * - "cache": previously enriched + cached locally (offline-safe).
 * - "unknown": no verified data — UI must say "unavailable", never invent.
 */
export type NutritionSource = "authored" | "usda" | "openfoodfacts" | "cache" | "unknown";

export interface NutritionValues {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export interface SourcedNutrition {
  values: NutritionValues;
  source: NutritionSource;
}

/** Authored recipe nutrition → tagged response (primary path, offline). */
export function authoredNutrition(raw: unknown): SourcedNutrition {
  const v = (raw ?? {}) as Record<string, unknown>;
  const pick = (k: string): number | null => {
    const n = v[k];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const values: NutritionValues = {
    calories: pick("calories"),
    protein_g: pick("protein_g"),
    carbs_g: pick("carbs_g"),
    fat_g: pick("fat_g"),
  };
  const hasAny = Object.values(values).some((n) => n != null);
  return hasAny ? { values, source: "authored" } : { values, source: "unknown" };
}

/** Merge cached/remote enrichment over authored data (authored always wins). */
export function mergeNutrition(primary: SourcedNutrition, extra: SourcedNutrition): SourcedNutrition {
  if (primary.source !== "unknown") return primary;
  if (extra.source === "unknown") return primary;
  return extra;
}
