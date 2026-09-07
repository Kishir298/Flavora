/**
 * Layer 2 — feature extraction (§7.2).
 * Computes a normalized (0–1) feature vector for a (recipe, profile, request) triple.
 *
 * Features: ingredient_overlap, time_fit, cuisine_match, nutrition_fit,
 * skill_fit, spice_fit, budget_fit.
 *
 * Accepts both the seed shape (cookTimeMinutes, spiceLevel, difficulty,
 * costTier, ingredients as {name,quantity,unit}[]) and legacy camelCase
 * shapes (cookTime, spice, pricePerServing, string[] ingredients) so unit
 * tests and fixtures keep working.
 *
 * @typedef {Object} RecipeLike
 * @typedef {Object} ProfileLike
 * @typedef {Object} RequestLike
 */

export const FEATURE_NAMES = [
  "ingredient_overlap",
  "time_fit",
  "cuisine_match",
  "nutrition_fit",
  "skill_fit",
  "spice_fit",
  "budget_fit",
];

const SPICE_RANK = { mild: 0, medium: 1, hot: 2 };

/** Beginner/intermediate/advanced × easy/medium/hard compatibility (§7.2). */
export const SKILL_FIT_TABLE = {
  beginner: { easy: 1.0, medium: 0.5, hard: 0.0 },
  intermediate: { easy: 0.75, medium: 1.0, hard: 0.5 },
  advanced: { easy: 0.5, medium: 0.75, hard: 1.0 },
};

const COST_TIER_FIT = { low: 1.0, medium: 0.5, high: 0.0 };

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}

function ingredientName(ing) {
  return typeof ing === "string" ? ing : (ing?.name ?? "");
}

function getHave(request) {
  return (request.availableIngredients ?? request.ingredients ?? []).map(norm).filter(Boolean);
}

function getCuisines(profile) {
  return (profile.favoriteCuisines ?? profile.favorite_cuisines ?? profile.cuisines ?? []).map(norm);
}

function getGoals(profile) {
  return profile.nutritionGoals ?? profile.nutrition_goals ?? {};
}

function getSkill(profile) {
  return norm(profile.skillLevel ?? profile.skill_level ?? profile.skill ?? "");
}

function getDifficulty(recipe) {
  return norm(recipe.difficulty ?? "easy");
}

function getSpice(recipe, profile) {
  return {
    recipe: norm(recipe.spiceLevel ?? recipe.spice ?? ""),
    profile: norm(profile.spicePreference ?? profile.spice_preference ?? profile.spice ?? ""),
  };
}

function getLimit(request, profile) {
  if (request.timeLimit !== undefined && request.timeLimit !== null) return Number(request.timeLimit);
  if (request.maxTime !== undefined && request.maxTime !== null) return Number(request.maxTime);
  const pref = profile.preferredCookTimeMinutes ?? profile.maxCookTime;
  return pref !== undefined ? Number(pref) : 30;
}

function getProtein(nut) {
  return nut.protein_g ?? nut.protein;
}

function getCarbs(nut) {
  return nut.carbs_g ?? nut.carbs;
}

function getFat(nut) {
  return nut.fat_g ?? nut.fat;
}

/**
 * @param {RecipeLike} recipe
 * @param {ProfileLike} profile
 * @param {RequestLike} [request]
 * @returns {{ingredient_overlap:number,time_fit:number,cuisine_match:number,nutrition_fit:number,skill_fit:number,spice_fit:number,budget_fit:number}}
 */
export function computeFeatures(recipe, profile, request = {}) {
  const ingredients = recipe.ingredients ?? [];

  // ingredient_overlap: |have ∩ recipe| / |recipe| (0.5 neutral if user listed nothing)
  let ingredient_overlap = 0.5;
  const have = getHave(request);
  if (have.length > 0) {
    if (ingredients.length === 0) {
      ingredient_overlap = 0;
    } else {
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
      ingredient_overlap = hits / ingredients.length;
    }
  }

  // cuisine_match: 1 if in favorites, else 0 (0.5 neutral when user has no preference)
  const favs = getCuisines(profile);
  let cuisine_match = 0.5;
  if (favs.length > 0) {
    cuisine_match = favs.includes(norm(recipe.cuisine ?? "")) ? 1 : 0;
  }

  // time_fit: 1 - |recipe.cook_time - requested.time_limit| / requested.time_limit, clipped [0,1]
  const limit = getLimit(request, profile);
  const cook = recipe.cookTimeMinutes ?? recipe.cookTime ?? 30;
  let time_fit;
  if (!limit || limit <= 0) time_fit = 0.5;
  else time_fit = clamp01(1 - Math.abs(cook - limit) / limit);

  // nutrition_fit: inverse normalized distance per goal signal, averaged
  const goals = getGoals(profile);
  const nut = recipe.nutrition ?? {};
  const signals = [];
  if (goals.maxCalories !== undefined && nut.calories !== undefined) {
    const goal = Number(goals.maxCalories);
    if (goal > 0) signals.push(nut.calories <= goal ? 1 : clamp01(1 - (nut.calories - goal) / goal));
  }
  if (goals.highProtein) {
    const protein = getProtein(nut);
    if (protein !== undefined) signals.push(clamp01(protein / 30));
  }
  if (goals.lowCarb) {
    const carbs = getCarbs(nut);
    if (carbs !== undefined) signals.push(carbs <= 30 ? 1 : clamp01(1 - (carbs - 30) / 50));
  }
  const nutrition_fit = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : 0.5;

  // skill_fit: profile.skill_level × recipe.difficulty lookup (§7.2)
  let skill_fit = 0.5;
  const skill = getSkill(profile);
  const difficulty = getDifficulty(recipe);
  if (SKILL_FIT_TABLE[skill] && SKILL_FIT_TABLE[skill][difficulty] !== undefined) {
    skill_fit = SKILL_FIT_TABLE[skill][difficulty];
  }

  // spice_fit: 1 match, 0.5 adjacent, 0 opposite (0.5 neutral when unknown)
  let spice_fit = 0.5;
  const { recipe: rSpice, profile: pSpice } = getSpice(recipe, profile);
  if (rSpice && pSpice && SPICE_RANK[rSpice] !== undefined && SPICE_RANK[pSpice] !== undefined) {
    const d = Math.abs(SPICE_RANK[rSpice] - SPICE_RANK[pSpice]);
    spice_fit = d === 0 ? 1 : d === 1 ? 0.5 : 0;
  }

  // budget_fit: from cost_tier (low=1.0, medium=0.5, high=0.0); legacy
  // pricePerServing supported as fallback; neutral 0.5 when unknown.
  let budget_fit = 0.5;
  const tier = norm(recipe.costTier ?? recipe.cost_tier ?? "");
  if (tier && COST_TIER_FIT[tier] !== undefined) {
    budget_fit = COST_TIER_FIT[tier];
  } else if (recipe.pricePerServing !== undefined && recipe.pricePerServing !== null) {
    budget_fit = clamp01(1 - Number(recipe.pricePerServing) / 5);
  }

  void getFat;
  return { ingredient_overlap, time_fit, cuisine_match, nutrition_fit, skill_fit, spice_fit, budget_fit };
}
