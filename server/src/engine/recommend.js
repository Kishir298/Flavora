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

/** Matched on-hand ingredients (deduped display names). */
function matchedHaveNames(recipe, have) {
  const ingredients = recipe.ingredients ?? [];
  const matched = [];
  for (const ing of ingredients) {
    const ingNorm = norm(ingredientName(ing));
    const label = ingredientName(ing);
    for (const h of have) {
      if (h && (ingNorm.includes(h) || h.includes(ingNorm))) {
        matched.push(label || h);
        break;
      }
    }
  }
  return matched;
}

/**
 * @param {any} recipe
 * @param {Record<string, number>} features
 * @param {{availableIngredients?:string[],timeLimit?:number,mode?:string,craving?:string}} request
 * @returns {string[]}
 */
export function buildReasons(recipe, features, request = {}) {
  const reasons = [];
  const have = (request.availableIngredients ?? request.ingredients ?? []).map(norm).filter(Boolean);
  const mode = request.mode ?? "normal";

  if (have.length > 0 && features.ingredient_overlap >= 0.25) {
    const matched = matchedHaveNames(recipe, have);
    const hits = matched.length;
    if (hits > 0) {
      const list = matched.slice(0, 4).join(", ");
      const extra = matched.length > 4 ? "…" : "";
      reasons.push(`Uses ${hits} of your ${have.length} available ingredients (${list}${extra})`);
    }
  }

  if (mode === "food_waste" && features.ingredient_overlap >= 0.25) {
    reasons.push("Works well for your food-waste goal");
  }
  if (mode === "budget" && features.budget_fit >= 0.5) {
    const tier = recipe.costTier ?? recipe.cost_tier ?? "low";
    reasons.push(`Budget-friendly (${tier} cost tier — not live grocery prices)`);
  } else if (features.budget_fit === 1 && mode !== "budget") {
    reasons.push("Low cost-tier recipe");
  }

  const limit = request.timeLimit ?? request.maxTime;
  if (limit !== undefined && features.time_fit >= 0.8) {
    reasons.push(`Fits your ${limit}-minute cooking preference`);
  }
  if (features.skill_fit === 1) reasons.push("Fits your cooking skill level");
  else if (features.skill_fit >= 0.75) reasons.push("Manageable for your skill level");

  if (features.cuisine_match === 1 && recipe.cuisine) {
    reasons.push(`Matches your preferred ${recipe.cuisine} cuisine`);
  }
  if (features.spice_fit === 1) reasons.push("Matches your spice preference");
  if (features.nutrition_fit >= 0.8) reasons.push("Matches your nutritional goals");
  if (request.craving && features.craving_fit >= 0.6) {
    reasons.push(`Aligns with “${String(request.craving).slice(0, 40)}”`);
  }

  if (reasons.length === 0) reasons.push("Good all-round match from your local library");
  const unique = [];
  for (const r of reasons) {
    if (!unique.includes(r)) unique.push(r);
    if (unique.length >= 3) break;
  }
  return unique;
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
