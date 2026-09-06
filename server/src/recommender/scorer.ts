import type {
  Recipe,
  RecommendQuery,
  ScoreBreakdown,
  ScoredRecipe,
  UserProfileInput,
} from "./types.js";
import { filterSafeRecipes } from "./filter.js";

/**
 * LAYER 2 — weighted scoring over allergy-safe recipes only.
 * Transparent, deterministic, works with zero training data.
 * Weights sum to 1. Layer 3 (learning) may only nudge these weights — never Layer 1.
 */
export const DEFAULT_WEIGHTS = {
  ingredientOverlap: 0.4,
  timeFit: 0.2,
  cuisine: 0.15,
  spice: 0.1,
  nutrition: 0.1,
  craving: 0.05,
} as const;

export type Weights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

const SPICE_RANK = { mild: 0, medium: 1, hot: 2 } as const;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function tokenize(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

export function scoreRecipe(
  recipe: Recipe,
  profile: UserProfileInput,
  query: RecommendQuery = {},
  weights: Weights = { ...DEFAULT_WEIGHTS }
): ScoredRecipe {
  // Ingredient overlap: fraction of recipe ingredients covered by what user has.
  let ingredientOverlap = 0.5; // neutral when user lists nothing
  const have = new Set((query.ingredients ?? []).map(norm));
  if (have.size > 0 && recipe.ingredients.length > 0) {
    let hits = 0;
    for (const ing of recipe.ingredients) {
      const ingNorm = norm(ing);
      for (const h of have) {
        if (h && (ingNorm.includes(h) || h.includes(ingNorm))) {
          hits++;
          break;
        }
      }
    }
    ingredientOverlap = hits / recipe.ingredients.length;
  }

  // Time fit: 1 if within limit, decays linearly to 0 at 2x limit.
  const limit = query.maxTime ?? profile.maxCookTime ?? 30;
  const cook = recipe.cookTime ?? 30;
  let timeFit = 1;
  if (cook <= limit) timeFit = 1;
  else if (cook >= limit * 2) timeFit = 0;
  else timeFit = 1 - (cook - limit) / limit / 2;

  // Cuisine preference.
  let cuisine = 0.5;
  if (profile.cuisines?.length) {
    cuisine = profile.cuisines.map(norm).includes(norm(recipe.cuisine ?? "")) ? 1 : 0.2;
  }

  // Spice: exact=1, adjacent=0.6, far=0.2.
  let spice = 0.5;
  if (recipe.spice && profile.spice) {
    const d = Math.abs(SPICE_RANK[recipe.spice] - SPICE_RANK[profile.spice]);
    spice = d === 0 ? 1 : d === 1 ? 0.6 : 0.2;
  }

  // Nutrition goals (soft — never excludes).
  let nutrition = 0.5;
  const goals = profile.nutritionGoals ?? {};
  const nut = recipe.nutrition ?? {};
  const signals: number[] = [];
  if (goals.maxCalories && nut.calories !== undefined) {
    signals.push(nut.calories <= goals.maxCalories ? 1 : 0.2);
  }
  if (goals.highProtein && nut.protein !== undefined) {
    signals.push(nut.protein >= 20 ? 1 : nut.protein >= 10 ? 0.6 : 0.3);
  }
  if (goals.lowCarb && nut.carbs !== undefined) {
    signals.push(nut.carbs <= 30 ? 1 : nut.carbs <= 50 ? 0.6 : 0.3);
  }
  if (signals.length) nutrition = signals.reduce((a, b) => a + b, 0) / signals.length;

  // Craving: token overlap between craving text and title+ingredients.
  let craving = 0.5;
  if (query.craving?.trim()) {
    const qTokens = new Set(tokenize(query.craving));
    const hay = tokenize(`${recipe.title} ${(recipe.ingredients ?? []).join(" ")}`);
    const haySet = new Set(hay);
    let hits = 0;
    for (const t of qTokens) if (haySet.has(t)) hits++;
    craving = qTokens.size ? hits / qTokens.size : 0.5;
    // If craving mentions something but nothing matches, penalize lightly.
    if (craving === 0) craving = 0.2;
  }

  const breakdown: ScoreBreakdown = {
    ingredientOverlap,
    timeFit,
    cuisine,
    spice,
    nutrition,
    craving,
    total: 0,
  };
  const total =
    ingredientOverlap * weights.ingredientOverlap +
    timeFit * weights.timeFit +
    cuisine * weights.cuisine +
    spice * weights.spice +
    nutrition * weights.nutrition +
    craving * weights.craving;
  breakdown.total = total;
  return { recipe, score: total, breakdown };
}

/** Full Layer 1+2 pipeline: filter safe, score, sort desc, take topN (default 5). */
export function recommend(
  recipes: Recipe[],
  profile: UserProfileInput,
  query: RecommendQuery = {},
  topN = 5,
  weights?: Weights
): ScoredRecipe[] {
  const safe = filterSafeRecipes(recipes, profile);
  return safe
    .map((r) => scoreRecipe(r, profile, query, weights))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Layer 3 stub: learns weight nudges from interactions. Phase 3 will implement
// logistic-regression adjustment here. It MUST NOT touch Layer 1.
export function adjustWeightsFromInteractions(
  _stats: { savedCuisines: Record<string, number> },
  base: Weights = { ...DEFAULT_WEIGHTS }
): Weights {
  return { ...base };
}
