/**
 * Layer 1b — deterministic dietary eligibility (companion to filter.js).
 * Plain ESM JS, pure, no weights, no learning, no LLM.
 *
 * `passesDietaryFilter(recipe, dietaryPreference)` → boolean.
 *
 * Semantics (lacto-ovo vegetarian default; no product doc overrides it):
 * - "vegan":         no animal-derived ingredient evidence (meat, poultry,
 *                    fish/seafood, egg, dairy + derivatives, honey).
 * - "vegetarian":    no meat/poultry/fish/seafood (dairy + eggs allowed).
 * - "non-vegetarian" | "any" | undefined: no diet constraint.
 *
 * Matching reuses filter.js `ingredientViolatesTerm` (word-boundary aware,
 * plural tolerant) so "eggplant" never matches "egg" and "chicken breast"
 * still matches "chicken". Plant-named lookalikes are exempted explicitly
 * ("peanut butter" is not dairy; coconut/oat/soy milks are not dairy).
 *
 * Fail-closed: a recipe with no ingredient evidence at all cannot be
 * verified, so it is INELIGIBLE when a diet constraint is set (unknown is
 * never silently "safe"). Without a diet constraint everything passes.
 * diet_tags metadata is display-only and never trusted for eligibility —
 * tags have been wrong (seed audit), ingredients are the authority.
 *
 * @typedef {Object} RecipeLike
 * @property {(string|{name:string})[]} ingredients — seed rows use {name,quantity,unit} objects
 */
import { ingredientViolatesTerm } from "./filter.js";

/** Animal flesh: meat, poultry, fish, seafood (blocks vegan AND vegetarian). */
const MEAT_TERMS = [
  "chicken", "turkey", "duck", "goose",
  "beef", "pork", "bacon", "ham", "sausage", "pepperoni", "salami", "lamb", "veal", "venison",
  "fish", "tuna", "salmon", "cod", "tilapia", "sardine", "anchovy",
  "seafood", "shellfish", "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop",
  "meat", "poultry",
  // Stocks/broths/sauces derived from animals.
  "chicken stock", "chicken broth", "beef broth", "beef stock", "fish sauce", "fish stock",
  "oyster sauce", "worcestershire",
];

/** Egg + dairy + derivatives + honey (blocks vegan only; allowed for vegetarian). */
const ANIMAL_PRODUCT_TERMS = [
  "egg", "eggs", "mayonnaise", "mayo",
  "milk", "dairy", "cheese", "butter", "cream", "yogurt", "yoghurt",
  "whey", "ghee", "casein", "paneer", "ricotta", "parmesan", "mozzarella", "cheddar", "feta",
  "gelatin", "honey",
];

/**
 * Plant-named lookalikes that must NOT count as the animal term they resemble.
 * Keyed by forbidden term → ingredient-name fragments that exempt a match.
 * "dairy" expands (via filter.js synonyms) into milk/cheese/butter/cream, so
 * it inherits all of their exemptions — otherwise "peanut butter" would
 * falsely match "dairy".
 */
const MILK_EXEMPT = ["coconut milk", "oat milk", "soy milk", "almond milk", "cashew milk", "rice milk", "hemp milk", "plant milk"];
const BUTTER_EXEMPT = ["peanut butter", "cocoa butter", "shea butter", "apple butter"];
const CREAM_EXEMPT = ["coconut cream", "cashew cream", "oat cream", "soy cream"];
const LOOKALIKE_EXEMPTIONS = {
  butter: BUTTER_EXEMPT,
  milk: MILK_EXEMPT,
  cream: CREAM_EXEMPT,
  cheese: ["vegan cheese"],
  dairy: [...MILK_EXEMPT, ...BUTTER_EXEMPT, ...CREAM_EXEMPT, "vegan cheese"],
};

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function ingredientNames(recipe) {
  return (recipe?.ingredients ?? []).map((ing) =>
    norm(typeof ing === "string" ? ing : (ing?.name ?? ""))
  ).filter(Boolean);
}

/**
 * True when `ingredient` violates `term`, honoring plant-named lookalikes.
 * Delegates matching to filter.js so boundary/plural behavior stays in one place,
 * except short terms (<4 chars, e.g. "egg"): filter.js rewards recall there and
 * would match "eggplant", so diet matching requires a strict word boundary.
 */
export function violatesTerm(ingredient, term) {
  const ing = norm(ingredient);
  if (!ing) return false;
  for (const exempt of LOOKALIKE_EXEMPTIONS[term] ?? []) {
    if (ing.includes(exempt)) return false;
  }
  const t = norm(term);
  if (t && t.length < 4) {
    try {
      return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(ing);
    } catch {
      return false;
    }
  }
  return ingredientViolatesTerm(ing, term);
}

/** True when the recipe shows evidence of any listed term. */
function containsAny(recipe, terms) {
  const names = ingredientNames(recipe);
  for (const name of names) {
    for (const term of terms) {
      if (violatesTerm(name, term)) return true;
    }
  }
  return false;
}

/**
 * Guide entry point: true = eligible for the diet, false = reject.
 * Unknown diet strings behave like "any" (never invent a restriction), but
 * an EMPTY ingredient list with an active vegan/vegetarian constraint fails
 * closed — unverifiable is not servable.
 */
export function passesDietaryFilter(recipe, dietaryPreference) {
  const diet = norm(dietaryPreference);
  if (!diet || diet === "any" || diet === "non-vegetarian" || diet === "nonvegetarian" || diet === "non-veg") {
    return true;
  }
  const names = ingredientNames(recipe);
  if (diet === "vegan") {
    if (names.length === 0) return false;
    if (containsAny(recipe, MEAT_TERMS)) return false;
    if (containsAny(recipe, ANIMAL_PRODUCT_TERMS)) return false;
    return true;
  }
  if (diet === "vegetarian" || diet === "veg") {
    if (names.length === 0) return false;
    if (containsAny(recipe, MEAT_TERMS)) return false;
    return true;
  }
  return true;
}
