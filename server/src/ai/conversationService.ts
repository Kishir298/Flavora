/**
 * Conversational requirement gathering (§7-11).
 * In-memory sessions; only the resulting FoodRequest + profile prefs persist.
 * One concise contextual question at a time; multi-field answers, corrections
 * (last-wins), and skip/unknown ("don't care", "whatever", "skip") supported.
 */
import { randomUUID } from "node:crypto";
import { normalizeIntent, toFoodRequest } from "./intentSchema.js";
import {
  bareNumber,
  hasFoodWords,
  isCorrection,
  isDietOnly,
  isGreeting,
  parseIntentHeuristic,
} from "./heuristicParser.js";
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
/** Bound the in-memory map: evict expired first, then oldest. */
const MAX_SESSIONS = 2000;
/** Amortized cleanup threshold — sweep when the map grows past this. */
const SWEEP_AT = 500;

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
  if (sessions.size > MAX_SESSIONS) sweepExpiredSessions();
  return s;
}

/** Delete expired sessions; if still over capacity, evict oldest. Returns removals. */
export function sweepExpiredSessions(now = Date.now()): number {
  let removed = 0;
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) {
      sessions.delete(id);
      removed++;
    }
  }
  if (sessions.size > MAX_SESSIONS) {
    const ordered = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const s of ordered.slice(0, sessions.size - MAX_SESSIONS)) {
      sessions.delete(s.id);
      removed++;
    }
  }
  return removed;
}

const SKIP_RE = /\b(don'?t care|whatever|anything( is)? fine|i don'?t know|skip( that| this)?|no preference|doesn'?t matter)\b/i;

/** Merge new intent into request; latest explicit instruction wins. */
export function mergeRequest(
  prev: FoodRequest,
  intent: RecommendationIntent,
  rawText: string,
  opts?: { suppressCraving?: boolean }
): FoodRequest {
  const next: FoodRequest = { ...prev };
  const fr = toFoodRequest(intent);
  const text = String(rawText ?? "");
  const correction = isCorrection(text);
  // New food info = the turn names food (or corrects earlier input).
  // Greetings/filler/bare numbers carry none, so they must never clobber an
  // established craving ("hi" after chicken must not replace it with "hi").
  // Pure diet statements ("veggie", "actually vegetarian") own the diet slot,
  // never the craving — even when they seed an ingredient word as a side
  // effect ("veggies" also harvests as an owned ingredient, which is fine).
  const dietOnly = isDietOnly(text);
  const newFoodSignal =
    ((intent.availableIngredients?.length ?? 0) > 0 && !dietOnly) ||
    (hasFoodWords(text) && !dietOnly) ||
    correction;

  // Corrections: explicit diet/meal mentions overwrite; skip-phrases never clear.
  if (SKIP_RE.test(text)) {
    // Fall through to non-diet fields only — never wipe known slots on "whatever".
  } else {
    if (fr.dietaryPreference) next.dietaryPreference = fr.dietaryPreference;
    if (fr.mealType) next.mealType = fr.mealType;
  }
  // Craving: monotonic unless corrected. Junk turns ("what", "20", "hi")
  // leave a food-grounded craving untouched. Unrecognized ingredient
  // attempts ("my dih") must not become cravings either — the caller
  // suppresses when the pending question is ingredients and nothing was
  // extracted.
  if (fr.craving && !SKIP_RE.test(text) && !opts?.suppressCraving) {
    if (!next.craving || newFoodSignal) next.craving = fr.craving;
  }
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
    // Corrections name the new reality ("actually beef" replaces chicken);
    // additive phrasing ("also have rice", "plus garlic") unions instead.
    // Safety exclusions are handled separately below and always union.
    const additive = /\b(also|plus|add|as well|too|another|more)\b/i.test(text);
    if (isCorrection(text) && !additive) {
      next.availableIngredients = [...intent.availableIngredients];
    } else {
      const seen = new Set((next.availableIngredients ?? []).map((s) => s.toLowerCase()));
      next.availableIngredients = [...(next.availableIngredients ?? [])];
      for (const ing of intent.availableIngredients) {
        if (!seen.has(ing.toLowerCase())) {
          seen.add(ing.toLowerCase());
          next.availableIngredients.push(ing);
        }
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

/** Missing slots minus what the profile already supplies. */
export function missingMinusProfile(request: FoodRequest, profile?: Partial<FoodRequest>): Slot[] {
  return missingSlots(request).filter((s) => {
    // Don't ask for what the profile already supplied.
    const p = profile as Record<string, unknown> | undefined;
    if (!p) return true;
    const v = p[s as string];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0);
  });
}

/** Highest-priority missing slot, excluding what the profile already supplies. */
export function pendingSlot(request: FoodRequest, profile?: Partial<FoodRequest>): Slot | undefined {
  return missingMinusProfile(request, profile)[0];
}

const NUMERIC_BOUNDS: Partial<Record<Slot, { min: number; max: number; label: string }>> = {
  calorieTarget: { min: 50, max: 5000, label: "calorie target" },
  servings: { min: 1, max: 20, label: "servings" },
  maxCookingTime: { min: 5, max: 180, label: "cooking time" },
};

const BARE_VALUES: Partial<Record<Slot, string[]>> = {
  dietaryPreference: ["vegetarian", "veg", "vegan", "non-vegetarian", "nonveg", "non-veg", "any"],
  mealType: ["breakfast", "lunch", "dinner", "snack"],
  spiceLevel: ["mild", "medium", "hot"],
  skillLevel: ["beginner", "intermediate", "advanced"],
  cuisine: ["italian", "indian", "chinese", "japanese", "mexican", "french", "american", "mediterranean", "middle eastern", "african"],
};

/**
 * True when the whole message is an unambiguous answer to the pending slot —
 * a bare in-range number, or a bare enum word ("vegetarian", "dinner").
 * Such turns never need the model; the deterministic path answers them.
 * Anything else (extra words, other slots) returns false so the full
 * parse+merge path runs and no information is lost.
 */
export function isBareSlotAnswer(message: string, slot: Slot | undefined): boolean {
  if (slot === undefined) return false;
  const t = String(message ?? "").toLowerCase().trim().replace(/[!?.\s]+$/, "");
  const bounds = NUMERIC_BOUNDS[slot];
  if (bounds) {
    if (!/^\d{1,6}$/.test(t)) return false;
    const n = Number(t);
    return n >= bounds.min && n <= bounds.max;
  }
  const values = BARE_VALUES[slot];
  if (!values) return false;
  const norm = t.replace(/[\s_]+/g, "-");
  return values.includes(t) || values.includes(norm);
}

export type ParserRoute = "pending-deterministic" | "flavoralm";

/**
 * Context-first routing decision (pure, unit-tested).
 *
 * A pending constrained requirement is answered deterministically: the
 * heuristic parser plus pending-slot fills extract everything a direct
 * answer can carry, and the merge is monotonic — a model call adds latency
 * but no information (proven: FlavoraLM returns valid:false on these
 * phrasings, and gap-fill only accepts message-grounded values the
 * heuristic already found). Free-form craving turns keep the model path
 * with heuristic fallback. No pending slot (fresh/complete) also routes
 * to the model path, which degrades honestly when the model is down.
 */
export function selectParserRoute(pendingBefore: Slot | undefined): ParserRoute {
  if (pendingBefore === undefined || pendingBefore === "craving") return "flavoralm";
  return "pending-deterministic";
}

/** Advance a session one turn. Returns the follow-up question or done.
 * `reset` is true when the requested id was missing/unknown/expired — or the
 * previous session was already done — so the UI can tell a fresh start apart
 * from a continuation instead of silently losing history. */
export function advanceConversation(
  sessionId: string | undefined,
  message: string,
  opts?: { profile?: Partial<FoodRequest>; parsedIntent?: RecommendationIntent }
): { session: ConversationState; question: string | null; done: boolean; reset: boolean } {
  if (sessions.size >= SWEEP_AT) sweepExpiredSessions();
  let session = getSession(sessionId);
  let reset = false;
  if (!session) {
    // Unknown/expired id (or first turn): explicit fresh start, never silent.
    reset = sessionId !== undefined;
    session = createSession({ ...(opts?.profile ?? {}) });
  } else if (session.done) {
    // Done is terminal: a new message starts a new conversation rather than
    // appending turns onto a completed request.
    reset = true;
    session = createSession({ ...(opts?.profile ?? {}) });
  }
  // The question the user is answering: highest-priority missing slot BEFORE
  // this turn's merge. Bare numbers ("600") only make sense against it.
  const pendingBefore = pendingSlot(session.request, opts?.profile);
  // Deterministic parse first (explicit user text wins); validated FlavoraLM
  // output only gap-fills (grounded) when the caller has it. Same merge
  // path either way; safety stays additive-only.
  const heuristic = parseTurn(message);
  // Unrecognized ingredient attempts ("my dih") must not become cravings:
  // when ingredients are pending and nothing was extracted, the merge keeps
  // hands off the craving slot so a clarification can be asked instead.
  const suppressCraving =
    pendingBefore === "availableIngredients" && !(heuristic.availableIngredients?.length ?? 0);
  session.request = mergeRequest(session.request, heuristic, message, { suppressCraving });
  // Context-aware numeric fill: a bare number answers the pending numeric
  // question ("600" after the calorie question). In-range values land in the
  // slot; out-of-range values get guidance instead of becoming junk craving.
  let guidance: string | null = null;
  const n = bareNumber(message);
  if (n !== null && pendingBefore !== undefined) {
    const b = NUMERIC_BOUNDS[pendingBefore];
    const current = session.request[pendingBefore];
    if (b && current === undefined) {
      if (n >= b.min && n <= b.max) {
        (session.request as Record<string, unknown>)[pendingBefore] = n;
      } else {
        guidance =
          `${n} seems ${n < b.min ? "low" : "high"} for a ${b.label} — ` +
          `aim for ${b.min}–${b.max}.`;
      }
    }
  }
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

  const missing = missingMinusProfile(session.request, opts?.profile);
  if (missing.length === 0 || session.turns >= 6) {
    session.done = true;
    return { session, question: null, done: true, reset };
  }
  // One question at a time: the highest-priority missing slot.
  const slot = missing[0];
  const base = QUESTIONS[slot](session.request);
  // Greetings carry no requirements — greet back, then repeat the pending
  // question instead of storing "hi" as a craving.
  if (isGreeting(message)) {
    return { session, question: guidance ? `Hi there! ${guidance} ${base}` : `Hi there! ${base}`, done: false, reset };
  }
  // Stalled on the same slot with nothing newly understood: clarify with a
  // concrete example instead of repeating the identical question. Greetings
  // keep their own phrasing above (a bare repeat would hide the greeting).
  const stalled = slot === pendingBefore && !isGreeting(message) && guidance === null;
  if (stalled && slot === "availableIngredients") {
    return {
      session,
      question: `I need the ingredients you currently have available. For example: chicken, rice, onions. ${base}`,
      done: false,
      reset,
    };
  }
  if (stalled && slot === "calorieTarget") {
    return {
      session,
      question: `I need a calorie number, like 500. ${base}`,
      done: false,
      reset,
    };
  }
  return { session, question: guidance ? `${guidance} ${base}` : base, done: false, reset };
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
