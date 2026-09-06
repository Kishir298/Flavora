import type { Recipe, UserProfileInput } from "./types.js";

/**
 * LAYER 1 — hard-constraint filter. Non-negotiable, runs first.
 * Any recipe whose ingredients mention an allergy or avoidFood (case-insensitive
 * substring + common derivatives) is excluded. This function is pure and has no
 * weights, no learning, no thresholds — it can only ever exclude.
 */

// Derivatives that must also trigger exclusion, e.g. "peanut" matches "peanut oil".
const DERIVATIVE_SUFFIXES = [" oil", " butter", " flour", " milk", " powder", " sauce"];

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** True if a single ingredient string violates a single forbidden term. */
export function ingredientViolatesTerm(ingredient: string, term: string): boolean {
  const ing = normalize(ingredient);
  const t = normalize(term);
  if (!t) return false;
  if (ing.includes(t)) return true;
  // Plural-ish tolerance: "peanuts" vs "peanut"
  if (t.endsWith("s") && ing.includes(t.slice(0, -1))) return true;
  if (ing.endsWith("s") && ing.includes(t) === false && t.includes(ing.slice(0, -1))) return true;
  // Derivative check is covered by substring (e.g. "peanut oil".includes("peanut")),
  // kept explicit for readability of intent.
  for (const suffix of DERIVATIVE_SUFFIXES) {
    if (ing.includes(t + suffix)) return true;
  }
  return false;
}

export function recipeViolatesProfile(recipe: Recipe, profile: UserProfileInput): boolean {
  const forbidden = [...(profile.allergies ?? []), ...(profile.avoidFoods ?? [])]
    .map(normalize)
    .filter(Boolean);
  if (forbidden.length === 0) return false;
  for (const ing of recipe.ingredients ?? []) {
    for (const term of forbidden) {
      if (ingredientViolatesTerm(ing, term)) return true;
    }
  }
  return false;
}

/** Layer 1 entry point: returns only safe recipes, preserving order. */
export function filterSafeRecipes(recipes: Recipe[], profile: UserProfileInput): Recipe[] {
  return recipes.filter((r) => !recipeViolatesProfile(r, profile));
}
