/**
 * Guide step 3 — weighted scorer (literal .js path).
 * score = Σ (weight_i × feature_i). Weights sum to 1.
 */
import { computeFeatures } from "./features.js";

/** Static defaults before any learning exists (guide step 3 table). */
export const DEFAULT_WEIGHTS = {
  ingredient_overlap: 0.3,
  time_fit: 0.2,
  cuisine_match: 0.15,
  nutrition_fit: 0.15,
  spice_fit: 0.1,
  budget_fit: 0.1,
};

/**
 * @param {{ingredient_overlap:number,cuisine_match:number,time_fit:number,nutrition_fit:number,spice_fit:number,budget_fit:number}} features
 * @param {Record<string, number>} [weights]
 * @returns {number}
 */
export function scoreWithFeatures(features, weights = DEFAULT_WEIGHTS) {
  let total = 0;
  for (const [k, w] of Object.entries(weights)) {
    total += (features[k] ?? 0.5) * w;
  }
  return total;
}

/**
 * @param {any} recipe
 * @param {any} profile
 * @param {any} [request]
 * @param {Record<string, number>} [weights]
 * @returns {{features: ReturnType<typeof computeFeatures>, score: number}}
 */
export function scoreRecipe(recipe, profile, request = {}, weights = DEFAULT_WEIGHTS) {
  const features = computeFeatures(recipe, profile, request);
  return { features, score: scoreWithFeatures(features, weights) };
}
