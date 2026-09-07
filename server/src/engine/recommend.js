/**
 * Orchestrator (§7.3): query results in -> passesHardFilter -> score -> sort -> top 5 -> reasons.
 * Candidates come from the local `recipes` table (§5) via the caller — no
 * external fetch. Learning never gets a vote on allergens: filter always runs first.
 */
import { passesHardFilter } from "./filter.js";
import { computeFeatures } from "./features.js";
import { scoreWithFeatures, DEFAULT_WEIGHTS, weightsForMode } from "./scorer.js";

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function ingredientName(ing) {
  return typeof ing === "string" ? ing : (ing?.name ?? "");
}

/** Count how many recipe ingredients the user has (for "uses X of Y" reasons). */
function countHits(recipe, have) {
  const ingredients = recipe.ingredients ?? [];
  let hits = 0;
  for (const ing of ingredients) {
    const ingNorm = norm(ingredientName(ing));
    for (const h of have) {
      if (h && (ingNorm.includes(h) || h.includes(ingNorm))) {
        hits++;
        break;
      }
    }
  }
  return { hits, total: ingredients.length };
}

/**
 * @param {any} recipe
 * @param {Record<string, number>} features
 * @param {{availableIngredients?:string[],timeLimit?:number,mode?:string}} request
 * @returns {string[]}
 */
export function buildReasons(recipe, features, request = {}) {
  const reasons = [];
  const have = (request.availableIngredients ?? request.ingredients ?? []).map(norm).filter(Boolean);
  if (have.length > 0 && features.ingredient_overlap >= 0.4) {
    const { hits, total } = countHits(recipe, have);
    if (hits > 0) reasons.push(`uses ${hits} of your ${have.length} ingredient${have.length === 1 ? "" : "s"} (${hits}/${total} in recipe)`);
  }
  const limit = request.timeLimit ?? request.maxTime;
  if (limit !== undefined && features.time_fit >= 0.8) {
    reasons.push(`fits your ${limit}-minute limit`);
  }
  if (features.skill_fit === 1) reasons.push("matches your skill level");
  if (features.cuisine_match === 1 && recipe.cuisine) {
    reasons.push(`matches your ${recipe.cuisine} preference`);
  }
  if ((request.mode ?? "normal") === "budget" && features.budget_fit >= 0.5) {
    reasons.push("budget-friendly pick");
  }
  if (features.spice_fit === 1) reasons.push("matches your spice preference");
  if (features.nutrition_fit >= 0.8) reasons.push("fits your nutrition goal");
  if (reasons.length === 0) reasons.push("good all-round match");
  return reasons.slice(0, 3);
}

/**
 * @param {any[]} candidates rows from the local recipes table
 * @param {any} profile supports snake_case + legacy camelCase
 * @param {{availableIngredients?:string[],ingredients?:string[],timeLimit?:number,maxTime?:number,mode?:string,craving?:string}} [request]
 * @param {Record<string, number>} [weights] base (normal-mode) weights; request.mode re-weights
 * @param {number} [topN]
 */
export function recommendWithEngine(candidates, profile, request = {}, weights = DEFAULT_WEIGHTS, topN = 5) {
  const mode = request.mode ?? "normal";
  const effective = weightsForMode(weights, mode);
  const safe = candidates.filter((r) => passesHardFilter(r, profile));
  return safe
    .map((recipe) => {
      const features = computeFeatures(recipe, profile, request);
      const score = scoreWithFeatures(features, effective);
      return { recipe, features, score, matchReasons: buildReasons(recipe, features, request) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
