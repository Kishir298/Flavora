/**
 * Structured craving understanding (mission §7).
 * A controlled vocabulary of craving dimensions parsed from free text, matched
 * against recipe signals (diet tags, spice level, ingredients, cook time).
 * Pure functions — no LLM, no network. Output feeds features.js craving_fit
 * and buildReasons; it never affects allergy safety.
 */

/** Controlled vocabulary. Keys are canonical signal values. */
export const CRAVING_VOCABULARY = {
  textures: ["crispy", "crunchy", "creamy", "tender", "fluffy", "chewy"],
  flavors: ["spicy", "savory", "sweet", "tangy", "smoky", "fresh", "cheesy", "umami", "herby"],
  moods: ["comforting", "cozy", "refreshing", "indulgent", "homely"],
  temperature: ["warm", "hot dish", "cold", "chilled"],
  satiety: ["filling", "hearty", "light", "substantial"],
  mealStyle: ["quick", "one-pot", "snack", "breakfast", "dessert", "handheld"],
};

/** All canonical values across dimensions, for validation. */
export const ALL_CRAVING_VALUES = Object.values(CRAVING_VOCABULARY).flat();

/** Free-text phrases that map to a canonical signal value. */
const PHRASE_MAP = [
  // textures
  [/\bcrispy|crunch\b/, "textures", "crispy"],
  [/\bcrunchy\b/, "textures", "crunchy"],
  [/\bcreamy|silky\b/, "textures", "creamy"],
  [/\btender|fall[- ]apart\b/, "textures", "tender"],
  [/\bfluffy\b/, "textures", "fluffy"],
  [/\bchewy\b/, "textures", "chewy"],
  // flavors
  [/\bspicy|hot and spicy\b/, "flavors", "spicy"],
  [/\bsavory|savoury\b/, "flavors", "savory"],
  [/\bsweet\b/, "flavors", "sweet"],
  [/\btangy|zesty\b/, "flavors", "tangy"],
  [/\bsmoky\b/, "flavors", "smoky"],
  [/\bfresh\b/, "flavors", "fresh"],
  [/\bcheesy|cheese\b/, "flavors", "cheesy"],
  [/\bumami\b/, "flavors", "umami"],
  [/\bherby|herbaceous|herby\b/, "flavors", "herby"],
  // moods
  [/\bcomfort(ing)?\b/, "moods", "comforting"],
  [/\bcozy\b/, "moods", "cozy"],
  [/\brefreshing\b/, "moods", "refreshing"],
  [/\bindulgent|decadent\b/, "moods", "indulgent"],
  [/\bhomely|homey|nostalgic\b/, "moods", "homely"],
  // temperature
  [/\bwarm(ing)?\b/, "temperature", "warm"],
  [/\bhot\b(?!\s*and\s*spicy)/, "temperature", "hot dish"],
  [/\bcold|chilled\b/, "temperature", "cold"],
  // satiety
  [/\bfilling|sticks to your ribs\b/, "satiety", "filling"],
  [/\bhearty\b/, "satiety", "hearty"],
  [/\blight(?!ning)\b/, "satiety", "light"],
  [/\bsubstantial\b/, "satiety", "substantial"],
  // meal style
  [/\bquick|fast\b/, "mealStyle", "quick"],
  [/\bone[- ]pot\b/, "mealStyle", "one-pot"],
  [/\bsnack\b/, "mealStyle", "snack"],
  [/\bbreakfast\b/, "mealStyle", "breakfast"],
  [/\bdessert\b/, "mealStyle", "dessert"],
  [/\bhandheld|wrap|sandwich|burger|taco\b/, "mealStyle", "handheld"],
  // spec aliases (§7.1): richness/spice/sweetness/freshness/comfort/satiety/prep map onto controlled dims
  [/\brich\b/, "satiety", "hearty"],
  [/\bheavy\b/, "satiety", "hearty"],
  [/\bbaked\b/, "mealStyle", "one-pot"],
  [/\bdinner\b/, "mealStyle", "snack"],
];

/**
 * Parse free-text craving into structured signals (validated vocabulary only).
 * Handles simple negation ("not too spicy", "but not heavy") by dropping negated hits.
 * @param {string} text
 * @returns {{textures:string[],flavors:string[],moods:string[],temperature:string[],satiety:string[],mealStyle:string[]}}
 */
export function parseCravingSignals(text) {
  const out = { textures: [], flavors: [], moods: [], temperature: [], satiety: [], mealStyle: [] };
  const t = String(text ?? "").toLowerCase();
  if (!t) return out;
  // find negated spans: "not X", "n't X", "but not X", "without X", "no X"
  const negated = new Set();
  const negRe = /\b(?:not|n't|without|no)\b([^.,;!?]{0,40})/g;
  let m;
  while ((m = negRe.exec(t)) !== null) {
    negated.add(m[1]);
  }
  const isNegated = (value) => {
    for (const span of negated) if (span.includes(value)) return true;
    return false;
  };
  for (const [re, dim, value] of PHRASE_MAP) {
    if (re.test(t) && !isNegated(value) && !out[dim].includes(value)) out[dim].push(value);
  }
  return out;
}

/** Recipe-side signals: derived from local data (diet tags, spice, ingredients, time). */
export function recipeCravingSignals(recipe) {
  const tags = (recipe.dietTags ?? recipe.diet_tags ?? []).map((t) => String(t).toLowerCase());
  const ingredients = (recipe.ingredients ?? []).map((i) => String(typeof i === "string" ? i : i?.name ?? "").toLowerCase());
  const sig = { textures: [], flavors: [], moods: [], temperature: [], satiety: [], mealStyle: [] };
  const add = (dim, v) => {
    if (!sig[dim].includes(v)) sig[dim].push(v);
  };

  if (tags.includes("vegan") || tags.includes("vegetarian")) add("satiety", "light");
  const cook = Number(recipe.cookTimeMinutes ?? recipe.cook_time_minutes ?? recipe.cookTime ?? 30);
  if (cook <= 25) add("mealStyle", "quick");
  const spice = String(recipe.spiceLevel ?? recipe.spice_level ?? recipe.spice ?? "").toLowerCase();
  if (spice === "hot") add("flavors", "spicy");
  if (spice === "medium") add("flavors", "savory");

  const blob = ingredients.join(" ");
  if (/\bcheese|parmesan|mozzarella|feta|cheddar\b/.test(blob)) add("flavors", "cheesy");
  if (/\bbutter|cream|b\u00e9chamel|heavy cream\b/.test(blob)) add("textures", "creamy");
  if (/\bbreadcrumb|panko|fried|crisp\b/.test(blob)) add("textures", "crispy");
  if (/\bcrunchy|granola|toast\b/.test(blob)) add("textures", "crunchy");
  if (/\bherb|basil|parsley|cilantro|oregano|thyme\b/.test(blob)) add("flavors", "herby");
  if (/\bsmok|char\b/.test(blob)) add("flavors", "smoky");
  if (/\blemon|lime|vinegar|tomato\b/.test(blob)) add("flavors", "fresh");
  if (/\bchili|pepper|cayenne|paprika\b/.test(blob)) add("flavors", "spicy");
  if (/\bsoup|stew|broth|curry|braise\b/.test(blob) || /soup|stew|braised/i.test(String(recipe.title ?? ""))) {
    add("temperature", "warm");
    add("satiety", "hearty");
    add("moods", "comforting");
  }
  if (/\bsalad|slaw\b/.test(blob) || /salad/i.test(String(recipe.title ?? ""))) {
    add("temperature", "cold");
    add("moods", "refreshing");
    add("satiety", "light");
  }
  if (/\btofu|beans|lentil|chickpea\b/.test(blob)) add("satiety", "filling");
  if (/\bsugar|chocolate|honey|maple|dessert\b/.test(blob) || /cake|cookie|brownie|tart/i.test(String(recipe.title ?? ""))) {
    add("flavors", "sweet");
    add("mealStyle", "dessert");
  }
  if (/\begg|oat|pancake|granola\b/.test(blob) || /breakfast/i.test(String(recipe.title ?? ""))) add("mealStyle", "breakfast");
  return sig;
}

/**
 * Craving fit: |requested ∩ recipe signals| / |requested| across all dimensions.
 * Returns 0.5 neutral when no signals were requested.
 * @param {{textures:string[],flavors:string[],moods:string[],temperature:string[],satiety:string[],mealStyle:string[]}} requested
 * @param {Record<string,string[]>} recipeSignals
 */
export function cravingSignalsFit(requested, recipeSignals) {
  let wanted = 0;
  let hits = 0;
  for (const dim of Object.keys(CRAVING_VOCABULARY)) {
    for (const v of requested[dim] ?? []) {
      wanted++;
      if ((recipeSignals[dim] ?? []).includes(v)) hits++;
    }
  }
  if (wanted === 0) return 0.5;
  return hits / wanted;
}

/** Human sentence for a signal value, e.g. "cheesy" → "cheesy". */
export function describeSignals(signals) {
  const parts = [];
  for (const [dim, values] of Object.entries(signals)) {
    for (const v of values) parts.push(v);
  }
  return parts;
}
