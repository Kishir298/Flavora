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
  // conversational answers are not lost. Near-miss spellings ("chickewn")
  // resolve conservatively; safety extractors below stay exact-only.
  if (!raw.availableIngredients) {
    const words = text
      .replace(/\band\b/g, ",")
      .split(/[,;.!?]+/)
      .flatMap((s) => s.trim().split(/\s+/))
      .map((w) => w.toLowerCase().trim())
      .map((w) => (KNOWN_FOODS.has(w) || KNOWN_FOODS.has(w.replace(/s$/, "")) ? w : (fuzzyFood(w) ?? "")))
      .filter((w) => w.length > 0);
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

  // Free-text craving fallback: when NO food signal was recognized
  // ("i want chicken" is a single food word — below the bare-list threshold;
  // "something healthy" maps to no slot; typos match no vocabulary), the old
  // code returned an empty intent, so the conversation asked "What are you
  // craving today?" forever. Instead, keep the user's own short words as the
  // craving so the conversation always advances past answered input.
  // Never fires when a craving/ingredients were found, when the message was
  // purely a safety statement (allergies/avoid ask craving next — correct),
  // on skip/unknown phrases (safe defaults apply), or on bare slot words
  // ("dinner", "vegetarian" — the slot is captured, craving truly unknown).
  const hasFoodSignal = raw.craving || raw.availableIngredients;
  const safetyOnly = raw.allergies || raw.avoidFoods;
  // Greetings, filler and bare numbers are never food requirements: the
  // pending-slot filler downstream decides bare numbers; greetings get a
  // greeting response. Storing them as craving ("hi", "20") trapped the
  // conversation in a repeat loop.
  const noSignal = GREETING_RE.test(text) || FILLER_RE.test(text) || BARE_NUMBER_RE.test(text);
  if (!hasFoodSignal && !safetyOnly && !SKIP_LIKE_RE.test(text) && !noSignal) {
    const cleaned = stripCorrectionPrefix(
      stripLeadFiller(
        text
          .replace(/\b(under|over|below|around|about|roughly)\s+\d+.*$/, " ")
          .replace(/\b\d+\s*(calories?|kcal|cals?|minutes?|mins?|min)\b.*$/, " ")
          .replace(/^(i(\s+am|'m)?|we|you)\s+/i, "")
      )
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (cleaned.length >= 2 && cleaned.length <= 60 && !BARE_SLOT_WORD_RE.test(cleaned)) {
      raw.craving = cleaned;
      // Seed owned ingredients from any known (or near-miss) food words in
      // the phrase ("chicken for dinner" → [chicken]). Words the user never
      // typed are never added — each candidate comes from this message.
      const resolved = cleaned
        .split(/\s+/)
        .map((tok) => {
          const t = tok.toLowerCase().replace(/[^a-z-]/g, "");
          if (t.length < 2) return null;
          if (KNOWN_FOODS.has(t) || KNOWN_FOODS.has(t.replace(/s$/, ""))) return t;
          return fuzzyFood(t);
        })
        .filter((t): t is string => t !== null);
      const unique = [...new Set(resolved)];
      if (unique.length) raw.availableIngredients = unique.slice(0, 8);
    }
  }

  return normalizeIntent(raw);
}

/** Skip/unknown phrases — safe defaults apply, never stored as craving. */
const SKIP_LIKE_RE =
  /\b(don'?t care|whatever|anything( is)? fine|i don'?t know|skip( that| this)?|no preference|doesn'?t matter|surprise me)\b/i;

/** Pure greetings/smalltalk carry no food info — never become requirements. */
const GREETING_RE =
  /^(hi+|hello+|hey+|yo|sup|howdy|good\s+(morning|afternoon|evening)|how\s+are\s+you)[!?.\s]*$/i;

/** Filler with no slot content ("what?", "huh", "ok", bare numbers). */
const FILLER_RE =
  /^(what|huh|hmm+|um+|uh+|er+|oh+|ah+|ok(ay)?|yes+|yeah+|yep|nope?|sure|thanks?|thx|please|sorry|test|testing)[!?.\s]*$/i;

/** A bare number ("20", "500", "100000") — handled by pending-slot filling downstream. */
const BARE_NUMBER_RE = /^(\d{1,6})[!?.\s]*$/;

/** Explicit correction of earlier input ("actually beef", "make it spicy"). */
const CORRECTION_RE =
  /\b(actually|instead|rather|correction|i meant|make it|change (it|that|to)|no[,.]?\s+(i want|i meant))\b/i;

/** True for pure greetings/smalltalk/filler carrying no slot content. */
export function isNoSignal(text: string): boolean {
  const t = String(text ?? "").toLowerCase().trim();
  return GREETING_RE.test(t) || FILLER_RE.test(t) || BARE_NUMBER_RE.test(t) || SKIP_LIKE_RE.test(t);
}

/** True for greetings ("hi") as opposed to other filler. */
export function isGreeting(text: string): boolean {
  return GREETING_RE.test(String(text ?? "").toLowerCase().trim());
}

/** Bare-number answers ("20") for pending-slot filling; null otherwise. */
export function bareNumber(text: string): number | null {
  const m = String(text ?? "").toLowerCase().trim().match(BARE_NUMBER_RE);
  return m ? Number(m[1]) : null;
}

/** True when the user explicitly corrects earlier input. */
export function isCorrection(text: string): boolean {
  return CORRECTION_RE.test(String(text ?? "").toLowerCase());
}

/** True when any token is a known (or near-miss) food word. */
export function hasFoodWords(text: string): boolean {
  const toks = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter((t) => t.length >= 2);
  return toks.some((tok) => {
    if (KNOWN_FOODS.has(tok) || KNOWN_FOODS.has(tok.replace(/s$/, ""))) return true;
    return fuzzyFood(tok) !== null;
  });
}

/** Bare slot words carry no food info — the slot is captured, craving stays unknown. */
const BARE_SLOT_WORD_RE =
  /^(breakfast|lunch|dinner|snack|vegetarian|vegan|non[\s-]?veg(etarian)?|veg)$/i;

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

/** Classic edit distance (small words only — inputs are single tokens). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur0 = i;
    let prevDiag = i - 1;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(prev[j] + 1, cur0 + 1, prevDiag + cost);
      prevDiag = prev[j];
      prev[j - 1] = cur0;
      cur0 = next;
    }
    prev[n] = cur0;
  }
  return prev[n];
}

/**
 * Conservative typo resolution for craving/ingredient words ONLY.
 * Returns the known food when the word (≥4 chars) is exactly one edit away
 * from a single vocabulary entry, else null. Short words ("dih") stay
 * free-text; multi-word phrases are never fuzzy-matched. Safety extractors
 * (allergies/avoid) deliberately do NOT use this — exact allowlist there.
 */
export function fuzzyFood(word: string): string | null {
  const w = String(word ?? "").toLowerCase().trim();
  if (w.length < 4 || w.length > 30 || w.includes(" ")) return null;
  if (KNOWN_FOODS.has(w)) return w;
  const singular = (s: string) => (s.endsWith("s") ? s.slice(0, -1) : s);
  let best: string | null = null;
  for (const food of KNOWN_FOODS) {
    if (food.includes(" ")) continue;
    if (Math.abs(food.length - w.length) > 1) continue;
    if (singular(food) === singular(w)) continue; // plural variant — callers strip plurals first
    if (levenshtein(w, food) <= 1) {
      if (best !== null) return null; // ambiguous — refuse to guess
      best = food;
    }
  }
  return best;
}

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

/**
 * Strip explicit-correction framing so the corrected value — not the framing
 * — is stored ("actually beef" → "beef"; "actually vegetarian" →
 * "vegetarian", which then matches the bare-slot rule and leaves the craving
 * for the diet slot to own). Applied to free-text craving captures only;
 * slot extractors above already see the raw text.
 */
function stripCorrectionPrefix(s: string): string {
  return s
    .trim()
    .replace(/^(no[,.\s]+)?(actually|instead|rather)[,.\s]+/i, "")
    .replace(/^(make it|make that|change (it|that)( to)?|change to)\b\s*/i, "")
    .replace(/^(it|that|this)\b\s+/i, "")
    .trim();
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
