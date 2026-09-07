/**
 * Weighted scorer (§7.2, §7.8). score = Σ (weight_i × feature_i). Weights sum to 1.
 * `mode` re-weighting scales the non-boosted features proportionally so the
 * total still sums to 1 (proportional-scaling approach).
 */
import { computeFeatures, FEATURE_NAMES } from "./features.js";

/** Static defaults before any learning exists (normal mode, §7.2). */
export const DEFAULT_WEIGHTS = {
  ingredient_overlap: 0.25,
  time_fit: 0.2,
  cuisine_match: 0.125,
  nutrition_fit: 0.125,
  skill_fit: 0.1,
  spice_fit: 0.1,
  budget_fit: 0.1,
};

/** Result of proportional re-weighting applied to DEFAULT_WEIGHTS. */
export const FOOD_WASTE_WEIGHTS = {
  ingredient_overlap: 0.5,
  time_fit: 0.133,
  cuisine_match: 0.083,
  nutrition_fit: 0.083,
  skill_fit: 0.067,
  spice_fit: 0.067,
  budget_fit: 0.067,
};

export const BUDGET_WEIGHTS = {
  ingredient_overlap: 0.194,
  time_fit: 0.156,
  cuisine_match: 0.097,
  nutrition_fit: 0.097,
  skill_fit: 0.078,
  spice_fit: 0.078,
  budget_fit: 0.3,
};

/** Which feature each mode boosts and to what value (§7.2). */
export const MODE_BOOST = {
  food_waste: { feature: "ingredient_overlap", value: 0.5 },
  budget: { feature: "budget_fit", value: 0.3 },
};

/**
 * Apply a mode boost to a base weight set (defaults or learned): set the
 * boosted feature to its mode value and scale every other feature down
 * proportionally so the total still sums to 1.
 * @param {Record<string, number>} base
 * @param {string} [mode] "normal" | "food_waste" | "budget"
 * @returns {Record<string, number>}
 */
export function weightsForMode(base = DEFAULT_WEIGHTS, mode = "normal") {
  const boost = MODE_BOOST[mode];
  if (!boost) return { ...base };
  const current = base[boost.feature] ?? 0;
  const rest = 1 - current;
  const out = {};
  for (const k of FEATURE_NAMES) {
    if (k === boost.feature) out[k] = boost.value;
    else out[k] = rest > 0 ? ((base[k] ?? 0) * (1 - boost.value)) / rest : 0;
  }
  return out;
}

/**
 * @param {Record<string, number>} features
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
 * @param {Record<string, number>} [weights] base (normal-mode) weights; mode applied from request.mode
 * @returns {{features: ReturnType<typeof computeFeatures>, score: number, weights: Record<string, number>}}
 */
export function scoreRecipe(recipe, profile, request = {}, weights = DEFAULT_WEIGHTS) {
  const features = computeFeatures(recipe, profile, request);
  const effective = weightsForMode(weights, request.mode ?? "normal");
  return { features, score: scoreWithFeatures(features, effective), weights: effective };
}
