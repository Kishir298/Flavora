/**
 * Layer 1 — hard-constraint filter (guide step 2).
 * Plain ESM JS (literal .js path per spec). Pure, no weights, no learning.
 * `passesHardFilter(recipe, profile)` → boolean (true = safe to show).
 *
 * Logic: reject if any ingredient text-matches any entry in
 * profile.allergies / profile.avoid_foods (case-insensitive substring),
 * expanded through SYNONYMS for cases text-matching alone would miss.
 * Best-effort only — recipe data can be incomplete; the detail page must
 * show full ingredients so the user does a final check.
 *
 * @typedef {Object} RecipeLike
 * @property {(string|{name:string})[]} ingredients — seed rows use {name,quantity,unit} objects
 * @typedef {Object} ProfileLike
 * @property {string[]} [allergies]
 * @property {string[]} [avoid_foods]
 * @property {string[]} [avoidFoods]
 */

/** Synonym expansion for common allergy terms. Keys + values lowercase. */
export const SYNONYMS = {
  dairy: ["milk", "cheese", "butter", "cream", "parmesan", "mozzarella", "cheddar", "feta", "ricotta", "yogurt", "yoghurt", "whey", "ghee", "casein", "paneer"],
  milk: ["dairy", "whey", "casein", "ghee"],
  "tree nuts": ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "brazil nut", "pine nut", "chestnut", "macadamia"],
  "tree nut": ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "chestnut", "macadamia"],
  nut: ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "peanut"],
  peanuts: ["peanut", "peanut butter", "peanut oil", "groundnut"],
  peanut: ["peanut butter", "peanut oil", "groundnut"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "shrimp paste", "fish sauce"],
  gluten: ["wheat", "flour", "bread", "pasta", "barley", "rye", "oats", "semolina", "couscous"],
  wheat: ["flour", "bread", "pasta", "semolina", "couscous"],
  egg: ["eggs", "mayonnaise", "mayo"],
  eggs: ["egg", "mayonnaise", "mayo"],
  soy: ["soy sauce", "tofu", "miso", "edamame", "tempeh"],
  sesame: ["sesame oil", "tahini", "sesame seeds"],
  mustard: ["mustard seeds", "mustard oil"],
  celery: ["celeriac", "celery salt"],
  fish: ["fish sauce", "anchovy", "tuna", "salmon"],
  coconut: ["coconut milk", "coconut oil"],
};

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

/** Expand a forbidden term into itself + known synonyms. */
export function expandTerm(term) {
  const t = normalize(term);
  if (!t) return [];
  const out = new Set([t]);
  if (SYNONYMS[t]) {
    for (const s of SYNONYMS[t]) out.add(normalize(s));
  }
  // Reverse lookup: "parmesan" entered directly still matches itself (already in set).
  // Also map plural tolerance at match time.
  return [...out];
}

function matchesWithPlural(haystack, needle) {
  if (!needle) return false;
  // Word-boundary matching: "oil" must not match "boil", "milk" must not
  // match "milkweed" misspellings etc. Short terms (<4 chars) require a word
  // boundary; longer terms keep substring + plural tolerance for recall.
  if (needle.length < 4) {
    try {
      const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`);
      if (re.test(haystack)) return true;
    } catch {
      /* fall through to substring */
    }
  }
  if (haystack.includes(needle)) {
    // Guard the classic false positive: single-word short needles inside
    // longer words (oil/boil). For needles >= 4 chars substring is fine.
    if (needle.length < 4) {
      try {
        const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
        return re.test(haystack);
      } catch {
        return false;
      }
    }
    return true;
  }
  if (needle.endsWith("s") && haystack.includes(needle.slice(0, -1))) return true;
  const singularHay = haystack.endsWith("s") ? haystack.slice(0, -1) : haystack;
  if (singularHay.includes(needle)) return true;
  return false;
}

/** True if a single ingredient string violates a single forbidden term (with synonyms). */
export function ingredientViolatesTerm(ingredient, term) {
  const ing = normalize(ingredient);
  if (!ing) return false;
  for (const variant of expandTerm(term)) {
    if (matchesWithPlural(ing, variant)) return true;
  }
  return false;
}

/**
 * Guide entry point: true = passes (safe), false = reject.
 * Accepts ingredient strings or {name,quantity,unit} objects (seed shape).
 * @param {RecipeLike} recipe
 * @param {ProfileLike} profile
 */
export function passesHardFilter(recipe, profile) {
  const forbidden = [...(profile.allergies ?? []), ...(profile.avoid_foods ?? []), ...(profile.avoidFoods ?? [])]
    .map(normalize)
    .filter(Boolean);
  if (forbidden.length === 0) return true;
  const ingredients = (recipe.ingredients ?? []).map((ing) =>
    typeof ing === "string" ? ing : (ing?.name ?? "")
  );
  for (const ing of ingredients) {
    for (const term of forbidden) {
      if (ingredientViolatesTerm(ing, term)) return false;
    }
  }
  return true;
}

// ---- Back-compat aliases for the pre-guide TS recommender (removed at cutover) ----
/** @type {(recipe: RecipeLike, profile: ProfileLike) => boolean} */
export function recipeViolatesProfile(recipe, profile) {
  return !passesHardFilter(recipe, profile);
}

/** @type {(recipes: any[], profile: ProfileLike) => any[]} */
export function filterSafeRecipes(recipes, profile) {
  return recipes.filter((r) => passesHardFilter(r, profile));
}
