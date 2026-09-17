/**
 * Conversational requirement gathering (§7-11).
 * In-memory sessions; only the resulting FoodRequest + profile prefs persist.
 * One concise contextual question at a time; multi-field answers, corrections
 * (last-wins), and skip/unknown ("don't care", "whatever", "skip") supported.
 */
import { randomUUID } from "node:crypto";
import { normalizeIntent, toFoodRequest } from "./intentSchema.js";
import { parseIntentHeuristic } from "./heuristicParser.js";
import type { FoodRequest, RecommendationIntent } from "./types.js";

export interface ConversationState {
  id: string;
  request: FoodRequest;
  turns: number;
  updatedAt: number;
  done: boolean;
}

const sessions = new Map<string, ConversationState>();
const TTL_MS = 30 * 60 * 1000;

function fresh(request: FoodRequest = {}): ConversationState {
  return { id: randomUUID(), request: { ...request }, turns: 0, updatedAt: Date.now(), done: false };
}

export function getSession(id?: string): ConversationState | undefined {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (!s || Date.now() - s.updatedAt > TTL_MS) {
    if (s) sessions.delete(id);
    return undefined;
  }
  return s;
}

export function createSession(initial: FoodRequest = {}): ConversationState {
  const s = fresh(initial);
  sessions.set(s.id, s);
  return s;
}

const SKIP_RE = /\b(don'?t care|whatever|anything( is)? fine|i don'?t know|skip( that| this)?|no preference|doesn'?t matter)\b/i;

/** Merge new intent into request; latest explicit instruction wins. */
export function mergeRequest(prev: FoodRequest, intent: RecommendationIntent, rawText: string): FoodRequest {
  const next: FoodRequest = { ...prev };
  const fr = toFoodRequest(intent);
  const text = String(rawText ?? "");

  // Corrections: explicit diet/meal mentions overwrite; skip-phrases never clear.
  if (SKIP_RE.test(text)) {
    // Fall through to non-diet fields only — never wipe known slots on "whatever".
  } else {
    if (fr.dietaryPreference) next.dietaryPreference = fr.dietaryPreference;
    if (fr.mealType) next.mealType = fr.mealType;
  }
  if (fr.craving && !SKIP_RE.test(text)) next.craving = fr.craving;
  if (fr.calorieTarget !== undefined) next.calorieTarget = fr.calorieTarget;
  if (fr.maxCookingTime !== undefined) next.maxCookingTime = fr.maxCookingTime;
  if (intent.timeLimit !== undefined) next.maxCookingTime = intent.timeLimit;
  if (fr.servings !== undefined) next.servings = fr.servings;
  if (fr.spiceLevel) next.spiceLevel = fr.spiceLevel;
  else if (intent.preferences?.spice) next.spiceLevel = intent.preferences.spice;
  if (fr.skillLevel) next.skillLevel = fr.skillLevel;
  else if (intent.preferences?.skill) next.skillLevel = intent.preferences.skill;
  if (fr.cuisine !== undefined && fr.cuisine !== null) next.cuisine = fr.cuisine;
  else if (intent.cuisine) next.cuisine = intent.cuisine;
  if (intent.availableIngredients?.length) {
    const seen = new Set((next.availableIngredients ?? []).map((s) => s.toLowerCase()));
    next.availableIngredients = [...(next.availableIngredients ?? [])];
    for (const ing of intent.availableIngredients) {
      if (!seen.has(ing.toLowerCase())) {
        seen.add(ing.toLowerCase());
        next.availableIngredients.push(ing);
      }
    }
  }
  // Safety additive-only: union, never remove.
  for (const k of ["allergies", "avoidFoods"] as const) {
    const add = intent[k] ?? fr[k];
    if (add?.length) {
      const seen = new Set((next[k] ?? []).map((s) => s.toLowerCase()));
      next[k] = [...(next[k] ?? [])];
      for (const a of add) {
        if (!seen.has(a.toLowerCase())) {
          seen.add(a.toLowerCase());
          next[k]!.push(a);
        }
      }
    }
  }
  return next;
}

/** Parse one user turn (heuristic now; FlavoraLM intent merges via same path). */
export function parseTurn(text: string): RecommendationIntent {
  return normalizeIntent(parseIntentHeuristic(text));
}

/**
 * Grounded gap-fill from FlavoraLM output: the model only fills scalar slots
 * the deterministic parse left empty, and ingredients only when the word
 * actually appears in the user's message (the small model can emit
 * in-vocabulary foods the user never mentioned). Safety fields stay
 * unioned (additive-only). Explicit user text always beats model guesses.
 */
export function mergeModelGapFill(
  prev: FoodRequest,
  intent: RecommendationIntent,
  rawText: string
): FoodRequest {
  const next: FoodRequest = { ...prev };
  const fr = toFoodRequest(intent);
  const text = String(rawText ?? "").toLowerCase();
  if (next.calorieTarget === undefined && fr.calorieTarget !== undefined) {
    next.calorieTarget = fr.calorieTarget;
  }
  if (!next.dietaryPreference && fr.dietaryPreference) next.dietaryPreference = fr.dietaryPreference;
  if (!next.mealType && fr.mealType) next.mealType = fr.mealType;
  if (!next.cuisine && fr.cuisine) next.cuisine = fr.cuisine;
  if (!next.spiceLevel) next.spiceLevel = fr.spiceLevel ?? intent.preferences?.spice;
  if (!next.skillLevel) next.skillLevel = fr.skillLevel ?? intent.preferences?.skill;
  if (next.servings === undefined && fr.servings !== undefined) next.servings = fr.servings;
  if (next.maxCookingTime === undefined) {
    next.maxCookingTime = fr.maxCookingTime ?? intent.timeLimit;
  }
  if (!next.craving && fr.craving) next.craving = fr.craving;
  // Ingredients: grounded — keep only words present in the user message.
  const grounded = (intent.availableIngredients ?? []).filter((ing) =>
    text.includes(ing.toLowerCase())
  );
  if (grounded.length) {
    const seen = new Set((next.availableIngredients ?? []).map((s) => s.toLowerCase()));
    next.availableIngredients = [...(next.availableIngredients ?? [])];
    for (const ing of grounded) {
      if (!seen.has(ing.toLowerCase())) {
        seen.add(ing.toLowerCase());
        next.availableIngredients.push(ing);
      }
    }
  }
  return next;
}

type Slot = keyof FoodRequest;

/** Priority-ordered missing slots. Craving is satisfied by any food signal. */
export function missingSlots(r: FoodRequest): Slot[] {
  const out: Slot[] = [];
  const hasFoodSignal =
    (r.availableIngredients?.length ?? 0) > 0 || (r.craving?.trim()?.length ?? 0) > 0;
  if (!hasFoodSignal) out.push("craving");
  if (r.calorieTarget === undefined) out.push("calorieTarget");
  if (!r.dietaryPreference) out.push("dietaryPreference");
  if ((r.availableIngredients?.length ?? 0) === 0) out.push("availableIngredients");
  if (!r.mealType) out.push("mealType");
  return out;
}

const QUESTIONS: Record<Slot, (r: FoodRequest) => string> = {
  craving: () => "What are you craving today?",
  calorieTarget: () => "About how many calories are you aiming for?",
  dietaryPreference: () => "Vegetarian, vegan, or non-veg?",
  availableIngredients: () => "What ingredients do you have on hand?",
  mealType: () => "Is this for breakfast, lunch, dinner, or a snack?",
  allergies: () => "Any allergies I should avoid?",
  avoidFoods: () => "Anything you'd like to avoid?",
  cuisine: () => "Any cuisine in mind?",
  spiceLevel: () => "How spicy — mild, medium, or hot?",
  servings: () => "How many servings?",
  maxCookingTime: () => "How many minutes do you have to cook?",
  skillLevel: () => "How would you rate your cooking — beginner, intermediate, or advanced?",
};

/** Advance a session one turn. Returns the follow-up question or done. */
export function advanceConversation(
  sessionId: string | undefined,
  message: string,
  opts?: { profile?: Partial<FoodRequest>; parsedIntent?: RecommendationIntent }
): { session: ConversationState; question: string | null; done: boolean } {
  let session = getSession(sessionId);
  if (!session) {
    session = createSession({ ...(opts?.profile ?? {}) });
    sessions.set(session.id, session);
  }
  // Deterministic parse first (explicit user text wins); validated FlavoraLM
  // output only gap-fills (grounded) when the caller has it. Same merge
  // path either way; safety stays additive-only.
  const heuristic = parseTurn(message);
  session.request = mergeRequest(session.request, heuristic, message);
  if (opts?.parsedIntent) {
    session.request = mergeModelGapFill(session.request, opts.parsedIntent, message);
    // Safety union from the model too — but grounded: only words actually
    // present in the message (the model once filed "garlic" as an allergy
    // the user never mentioned). Additive-only, never removes.
    const textLower = String(message ?? "").toLowerCase();
    const ground = (xs?: string[]) => (xs ?? []).filter((w) => textLower.includes(w.toLowerCase()));
    session.request = mergeRequest(
      session.request,
      { allergies: ground(opts.parsedIntent.allergies), avoidFoods: ground(opts.parsedIntent.avoidFoods) },
      message
    );
  }
  session.turns += 1;
  session.updatedAt = Date.now();

  const missing = missingSlots(session.request).filter((s) => {
    // Don't ask for what the profile already supplied.
    const p = opts?.profile as Record<string, unknown> | undefined;
    if (!p) return true;
    const v = p[s as string];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length === 0 || session.turns >= 6) {
    session.done = true;
    return { session, question: null, done: true };
  }
  // One question at a time: the highest-priority missing slot.
  const slot = missing[0];
  return { session, question: QUESTIONS[slot](session.request), done: false };
}

/** Engine-ready intent from a completed FoodRequest (deterministic mapping). */
export function foodRequestToIntent(r: FoodRequest, fallbackMode?: "normal" | "food_waste" | "budget"): RecommendationIntent {
  const mode =
    fallbackMode ??
    ((r.availableIngredients?.length ?? 0) > 0 ? "food_waste" : "normal");
  return normalizeIntent({
    availableIngredients: r.availableIngredients ?? [],
    timeLimit: r.maxCookingTime,
    maxCookingTime: r.maxCookingTime,
    cuisine: r.cuisine,
    mode,
    craving: r.craving ?? null,
    calorieTarget: r.calorieTarget,
    mealType: r.mealType,
    dietaryPreference: r.dietaryPreference,
    servings: r.servings,
    spiceLevel: r.spiceLevel,
    skillLevel: r.skillLevel,
    allergies: r.allergies ?? [],
    avoidFoods: r.avoidFoods ?? [],
    preferences: {
      ...(r.spiceLevel ? { spice: r.spiceLevel } : {}),
      ...(r.skillLevel ? { skill: r.skillLevel } : {}),
    },
  });
}
