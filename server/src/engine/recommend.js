/**
 * Guide step 4 — orchestrator (literal .js path).
 * candidates -> passesHardFilter -> features+score -> sort -> top 5 -> reasons.
 * Learning never gets a vote on allergens: filter always runs first.
 */
import { passesHardFilter } from "./filter.js";
import { computeFeatures } from "./features.js";
import { scoreWithFeatures, DEFAULT_WEIGHTS } from "./scorer.js";

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

/** Count how many recipe ingredients the user has (for "uses X of Y" reasons). */
function countHits(recipe, have) {
  const ingredients = recipe.ingredients ?? [];
  let hits = 0;
  for (const ing of ingredients) {
    const ingNorm = norm(ing);
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
 * @param {{ingredient_overlap:number,cuisine_match:number,time_fit:number,nutrition_fit:number,spice_fit:number,budget_fit:number}} features
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
  if (features.cuisine_match === 1 && recipe.cuisine) {
    reasons.push(`matches your ${recipe.cuisine} preference`);
  }
  if ((request.mode ?? "normal") === "budget" && features.budget_fit >= 0.6) {
    reasons.push("budget-friendly pick");
  }
  if (features.spice_fit === 1) reasons.push("matches your spice preference");
  if (features.nutrition_fit >= 0.8) reasons.push("fits your nutrition goal");
  if (reasons.length === 0) reasons.push("good all-round match");
  return reasons.slice(0, 3);
}

/**
 * @param {any[]} candidates
 * @param {any} profile supports guide snake_case + legacy camelCase
 * @param {{availableIngredients?:string[],ingredients?:string[],timeLimit?:number,maxTime?:number,mode?:string,craving?:string}} [request]
 * @param {Record<string, number>} [weights]
 * @param {number} [topN]
 */
export function recommendWithEngine(candidates, profile, request = {}, weights = DEFAULT_WEIGHTS, topN = 5) {
  const safe = candidates.filter((r) => passesHardFilter(r, profile));
  return safe
    .map((recipe) => {
      const features = computeFeatures(recipe, profile, request);
      const score = scoreWithFeatures(features, weights);
      return { recipe, features, score, matchReasons: buildReasons(recipe, features, request) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
