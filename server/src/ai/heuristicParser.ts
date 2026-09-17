import { CUISINES, normalizeIntent } from "./intentSchema.js";
import type { RecommendationIntent } from "./types.js";

// Structured craving parsing lives in engine/craving.js (single source of
// truth); assistantService layers it on top of this parser's output.

/**
 * Deterministic NL → intent fallback when FlavoraLM is unavailable.
 * Never invents recipes — only structured recommendation parameters.
 */
export function parseIntentHeuristic(message: string): RecommendationIntent {
  const text = String(message ?? "").toLowerCase().trim();
  const raw: Record<string, unknown> = {};

  // Time: "20 minutes", "in 30 min", "only have 15 minutes"
  const timeMatch = text.match(/\b(\d{1,3})\s*(?:minutes?|mins?|min)\b/);
  if (timeMatch) {
    raw.timeLimit = Number(timeMatch[1]);
    raw.maxCookingTime = Number(timeMatch[1]);
  }

  // Calorie target: "around 600", "under 600 calories", "roughly 700 kcal"
  const calMatch = text.match(/\b(?:around|about|roughly|under|below|max|up to|~)?\s*(\d{2,4})\s*(?:calories?|kcal|cals?)\b/);
  if (calMatch) raw.calorieTarget = Number(calMatch[1]);

  // Meal type: "for dinner", "dinner", "lunch"
  const mealMatch = text.match(/\b(breakfast|lunch|dinner|snack)\b/);
  if (mealMatch) raw.mealType = mealMatch[1];

  // Dietary preference (check non-veg BEFORE veg: "non-veg" contains "veg").
  // Latest explicit wins at merge time; the parser just extracts.
  if (/\bnon[- ]?veg\b|\bnon[- ]?vegetarian\b/.test(text)) raw.dietaryPreference = "non-vegetarian";
  else if (/\bvegan\b/.test(text)) raw.dietaryPreference = "vegan";
  else if (/\bvegetarian\b|\bveg\b|\bno meat\b|\bmeatless\b/.test(text)) raw.dietaryPreference = "vegetarian";
  else if (/\bchicken is fine\b|\bmeat is fine\b/.test(text)) {
    raw.dietaryPreference = "non-vegetarian";
  }

  // Servings: "for 2", "serves 4", "2 servings"
  const servMatch = text.match(/\b(?:for|serves?|servings?[:\s]*)\s*(\d{1,2})\b/) ?? text.match(/\b(\d{1,2})\s*servings?\b/);
  if (servMatch) raw.servings = Number(servMatch[1]);

  // Spice level phrases
  if (/\b(not too spicy|mild)\b/.test(text)) raw.spiceLevel = "mild";
  else if (/\bspicy\b|\bhot\b/.test(text) && !raw.preferences) raw.spiceLevel = "hot";

  // Skip / unknown: "don't care", "whatever", "anything is fine", "skip"
  // → deliberately leave slots unset so safe defaults apply downstream.

  // Mode signals
  if (/\b(cheap|budget|inexpensive|low[- ]?cost|affordable)\b/.test(text)) {
    raw.mode = "budget";
  } else if (
    /\b(what i (already )?have|use (up|what)|leftover|food waste|with what i)\b/.test(text) ||
    /\bi have\b/.test(text)
  ) {
    raw.mode = "food_waste";
  } else {
    raw.mode = "normal";
  }

  // Cuisine
  for (const c of CUISINES) {
    if (text.includes(c)) {
      raw.cuisine = c;
      break;
    }
  }
  if (!raw.cuisine && /\bindian food\b/.test(text)) raw.cuisine = "indian";

  // Spice / skill preferences
  const preferences: Record<string, unknown> = {};
  if (/\b(spicy|hot)\b/.test(text)) preferences.spice = "hot";
  else if (/\bmild\b/.test(text)) preferences.spice = "mild";
  if (/\b(beginner|easy|simple)\b/.test(text)) preferences.skill = "beginner";
  else if (/\badvanced\b/.test(text)) preferences.skill = "advanced";
  if (/\bhigh[- ]?protein\b/.test(text) || /\bprotein\b/.test(text)) preferences.highProtein = true;
  if (/\blow[- ]?carb\b/.test(text)) preferences.lowCarb = true;
  if (Object.keys(preferences).length) raw.preferences = preferences;

  // Ingredients after "I have …" / "with …"
  const haveMatch =
    text.match(/\bi have\s+([^.?!]+)/i) ||
    text.match(/\bwith\s+([^.?!]+?)(?:\.|$|\?|what|make)/i) ||
    text.match(/\busing\s+([^.?!]+)/i);
  if (haveMatch) {
    const chunk = haveMatch[1]
      .replace(/\band\b/g, ",")
      // Strip calorie/time tails so "rice under 600 calories" → "rice".
      .replace(/\b(under|over|below|around|about|roughly)\s+\d+.*$/, " ")
      .replace(/\b\d+\s*(calories?|kcal|cals?|minutes?|mins?|min)\b.*$/, " ")
      .replace(/\b(what|can|i|make|cook|tonight|already|only|just|got|get)\b/g, " ");
    const parts = chunk
      .split(/,|\/|&/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40 && !/^\d+$/.test(s));
    if (parts.length) raw.availableIngredients = parts;
  }
  // Bare ingredient lists without "I have/with/using" ("chicken rice onions
  // and peppers, for dinner"): harvest known-food words so multi-field
  // conversational answers are not lost.
  if (!raw.availableIngredients) {
    const words = text
      .replace(/\band\b/g, ",")
      .split(/[,;.!?]+/)
      .flatMap((s) => s.trim().split(/\s+/))
      .map((w) => w.toLowerCase().trim())
      .filter((w) => KNOWN_FOODS.has(w) || KNOWN_FOODS.has(w.replace(/s$/, "")));
    const unique = [...new Set(words)];
    if (unique.length >= 2) raw.availableIngredients = unique.slice(0, 8);
  }

  // Soft craving: keep short free-text when vague
  if (/\b(surprise|don't know|dont know|anything|whatever)\b/.test(text)) {
    raw.craving = "surprise me";
  } else if (/\bspicy\b/.test(text)) {
    raw.craving = "something spicy";
  } else if (/\bcomfort\b/.test(text)) {
    raw.craving = "comfort food";
  }

  // Additive safety constraints stated in natural language.
  // These only ever ADD exclusions downstream (unioned with the stored
  // profile before the deterministic hard filter). Kept conservative:
  // candidates must intersect a known-food vocabulary to avoid capturing
  // taste words ("not too spicy") or sentence fragments as foods.
  const allergies = extractAllergies(text);
  if (allergies.length) raw.allergies = allergies;
  const avoidFoods = extractAvoidFoods(text);
  if (avoidFoods.length) raw.avoidFoods = avoidFoods;

  return normalizeIntent(raw);
}

/** Foods the parser is allowed to treat as exclusions (conservative allowlist). */
const KNOWN_FOODS = new Set(
  (
    "peanut peanuts peanut butter dairy milk cheese butter cream yogurt egg eggs " +
    "gluten wheat flour bread shellfish shrimp crab soy tofu pork beef chicken turkey " +
    "fish salmon tuna mushrooms mushroom onion garlic tomato potato carrot rice pasta " +
    "noodles beans lentils chickpeas spinach broccoli corn peas zucchini eggplant okra " +
    "olives cilantro coconut lemon lime apple banana nuts almond walnut sesame mustard " +
    "celery bell pepper chili chocolate honey avocado kale cabbage cauliflower"
  ).split(/\s+/)
);

/** Taste/texture words that must never become food exclusions. */
const NON_FOOD_WORDS = new Set(
  "spicy sweet salty sour bitter savory hot mild warm cold creamy crispy crunchy".split(/\s+/)
);

function cleanFoodWord(w: string): string {
  return w.toLowerCase().trim();
}

/** Leading verbs/articles that pollute captures ("want mushrooms" → "mushrooms"). */
const LEAD_FILLER = /^(want|wants|eat|eating|have|having|see|seeing|get|getting|like|need|needs|order|cook|make|try|give|me|something|anything|food|foods|dish|dishes|a|an|the|some|any)\b\s*/;

function stripLeadFiller(s: string): string {
  let prev = "";
  let cur = s.trim();
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(LEAD_FILLER, "").trim();
  }
  return cur;
}

/** "allergic to peanuts" / "allergy: dairy, eggs" → ["peanuts"] / ["dairy","eggs"]. */
export function extractAllergies(text: string): string[] {
  const t = String(text ?? "").toLowerCase();
  const out: string[] = [];
  const push = (w: string) => {
    const c = cleanFoodWord(w);
    if (c.length > 1 && c.length < 30 && !NON_FOOD_WORDS.has(c) && !out.includes(c)) out.push(c);
  };
  const m =
    t.match(/\ballerg(?:ic|y)\s+(?:to\s+)?([^.?!;]+)/) ||
    t.match(/\ballergens?\s*[:=]\s*([^.?!;]+)/);
  if (m) {
    for (const part of m[1].split(/,|\band\b|\bwith\b/)) {
      const words = stripLeadFiller(part).split(/\s+/).filter(Boolean);
      // Keep 1-2 word food names ("peanut butter", "tree nuts").
      const name = words.slice(0, 2).join(" ");
      if (name) push(name);
    }
  }
  return out.slice(0, 6);
}

/**
 * "don't want mushrooms" / "no pork" / "without cilantro" → ["mushrooms"].
 * Candidates must intersect KNOWN_FOODS to avoid false positives.
 */
export function extractAvoidFoods(text: string): string[] {
  const t = String(text ?? "").toLowerCase();
  const out: string[] = [];
  const push = (w: string) => {
    const c = cleanFoodWord(w);
    if (
      c.length > 1 &&
      c.length < 30 &&
      (KNOWN_FOODS.has(c) || KNOWN_FOODS.has(c.replace(/s$/, ""))) &&
      !NON_FOOD_WORDS.has(c) &&
      !out.includes(c)
    ) {
      out.push(c);
    }
  };
  const patterns = [
    /(?:don't|dont|do not|can not eat|never|avoid|hate|dislike|dislikes|can't eat|cannot eat|can't have|allergic to)\s+([a-z][a-z\s,]*?)(?=[.?!;]|$| but | and |please|tonight|for dinner|for lunch|with |in \d)/g,
    /\bno\s+([a-z][a-z\s,]*?)(?=[.?!;]|$| but | and |please|tonight|for |with |in \d)/g,
    /\bwithout\s+([a-z][a-z\s,]*?)(?=[.?!;]|$| but | and |please|tonight|for |with |in \d)/g,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      for (const part of m[1].split(/,|\band\b/)) {
        const words = stripLeadFiller(part).split(/\s+/).filter(Boolean);
        if (words.length === 0 || words.length > 2) continue;
        push(words.join(" "));
      }
    }
  }
  return out.slice(0, 6);
}
