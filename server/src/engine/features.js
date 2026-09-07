/**
 * Guide step 3 — feature extraction (literal .js path).
 * Computes a normalized (0–1) feature vector for a (recipe, profile, request) triple.
 *
 * Features: ingredient_overlap, cuisine_match, time_fit, nutrition_fit,
 * spice_fit, budget_fit.
 *
 * @typedef {Object} RecipeLike
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [cuisine]
 * @property {number} [cookTime]
 * @property {string} [spice] "mild" | "medium" | "hot"
 * @property {string[]} ingredients
 * @property {{calories?:number,protein?:number,carbs?:number,fat?:number}} [nutrition]
 * @property {number} [pricePerServing]
 * @typedef {Object} ProfileLike
 * @property {string[]} [cuisines]
 * @property {string[]} [favoriteCuisines]
 * @property {string} [spice]
 * @property {{maxCalories?:number,highProtein?:boolean,lowCarb?:boolean}} [nutritionGoals]
 * @property {{highProtein?:boolean,lowCarb?:boolean,maxCalories?:number}} [nutrition_goals]
 * @typedef {Object} RequestLike
 * @property {string[]} [availableIngredients]
 * @property {string[]} [ingredients]
 * @property {number} [timeLimit]
 * @property {number} [maxTime]
 * @property {string} [mode] "normal" | "budget"
 */

export const FEATURE_NAMES = [
  "ingredient_overlap",
  "cuisine_match",
  "time_fit",
  "nutrition_fit",
  "spice_fit",
  "budget_fit",
];

const SPICE_RANK = { mild: 0, medium: 1, hot: 2 };

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}

function getHave(request) {
  return (request.availableIngredients ?? request.ingredients ?? []).map(norm).filter(Boolean);
}

function getCuisines(profile) {
  return (profile.cuisines ?? profile.favoriteCuisines ?? []).map(norm);
}

function getGoals(profile) {
  return profile.nutritionGoals ?? profile.nutrition_goals ?? {};
}

function getLimit(request, profile) {
  if (request.timeLimit !== undefined && request.timeLimit !== null) return Number(request.timeLimit);
  if (request.maxTime !== undefined && request.maxTime !== null) return Number(request.maxTime);
  return profile.maxCookTime ?? 30;
}

/**
 * @param {RecipeLike} recipe
 * @param {ProfileLike} profile
 * @param {RequestLike} [request]
 * @returns {{ingredient_overlap:number,cuisine_match:number,time_fit:number,nutrition_fit:number,spice_fit:number,budget_fit:number}}
 */
export function computeFeatures(recipe, profile, request = {}) {
  const ingredients = recipe.ingredients ?? [];

  // ingredient_overlap: |have ∩ recipe| / |recipe| (0 when nothing matches; 0.5 neutral if user listed nothing)
  let ingredient_overlap = 0.5;
  const have = getHave(request);
  if (have.length > 0) {
    if (ingredients.length === 0) {
      ingredient_overlap = 0;
    } else {
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
      ingredient_overlap = hits / ingredients.length;
    }
  }

  // cuisine_match: 1 if in favorites, else 0 (0.5 neutral when user has no preference)
  const favs = getCuisines(profile);
  let cuisine_match = 0.5;
  if (favs.length > 0) {
    cuisine_match = favs.includes(norm(recipe.cuisine ?? "")) ? 1 : 0;
  }

  // time_fit: 1 - |cook - limit| / limit, clipped [0,1]
  const limit = getLimit(request, profile);
  const cook = recipe.cookTime ?? 30;
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
    if (nut.protein !== undefined) signals.push(clamp01(nut.protein / 30));
  }
  if (goals.lowCarb) {
    if (nut.carbs !== undefined) signals.push(nut.carbs <= 30 ? 1 : clamp01(1 - (nut.carbs - 30) / 50));
  }
  const nutrition_fit = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : 0.5;

  // spice_fit: 1 match, 0.5 adjacent, 0 opposite (0.5 neutral when unknown)
  let spice_fit = 0.5;
  if (recipe.spice && profile.spice && SPICE_RANK[recipe.spice] !== undefined && SPICE_RANK[profile.spice] !== undefined) {
    const d = Math.abs(SPICE_RANK[recipe.spice] - SPICE_RANK[profile.spice]);
    spice_fit = d === 0 ? 1 : d === 1 ? 0.5 : 0;
  }

  // budget_fit: inverse of price-per-serving; neutral 0.5 when price unknown
  let budget_fit = 0.5;
  if (recipe.pricePerServing !== undefined && recipe.pricePerServing !== null) {
    budget_fit = clamp01(1 - Number(recipe.pricePerServing) / 5);
  }

  return { ingredient_overlap, cuisine_match, time_fit, nutrition_fit, spice_fit, budget_fit };
}
