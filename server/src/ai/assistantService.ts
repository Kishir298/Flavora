import { config } from "../config.js";
import { createAIProvider, type ProviderSelection } from "./provider.js";
import { extractJsonObject, normalizeIntent } from "./intentSchema.js";
import { parseIntentHeuristic } from "./heuristicParser.js";
import { parseCravingSignals } from "../engine/craving.js";
import type { AIProvider, FallbackReason, ParsedAssistantRequest, RecommendationIntent } from "./types.js";
import { LocalLlmError, type LocalLlmStatus } from "./localLlmProvider.js";

export const INTENT_SYSTEM_PROMPT = `You are Flavora's intent parser for a local-first cooking app.
Extract structured recommendation parameters from the user's message.
Return ONLY a JSON object with these optional fields:
- availableIngredients: string[] (ingredients the user has on hand)
- timeLimit: number (minutes, 5-180)
- cuisine: one of italian|indian|chinese|japanese|mexican|french|american|mediterranean|middle eastern|african, or null
- mode: "normal" | "food_waste" | "budget"
  Use food_waste when they want to use what they have / leftovers.
  Use budget when they want cheap / low-cost meals.
- craving: short free-text mood (or null)
- cravingSignals: optional object drawn ONLY from this controlled vocabulary:
  { textures: [crispy|crunchy|creamy|tender|fluffy|chewy],
    flavors: [spicy|savory|sweet|tangy|smoky|fresh|cheesy|umami|herby],
    moods: [comforting|cozy|refreshing|indulgent|homely],
    temperature: [warm|hot dish|cold|chilled],
    satiety: [filling|hearty|light|substantial],
    mealStyle: [quick|one-pot|snack|breakfast|dessert|handheld] }
  Only include values the user's words clearly imply (e.g. "spicy and comforting"
  → { flavors: ["spicy"], moods: ["comforting"] }). Omit the field if nothing applies.
- preferences: { spice?: mild|medium|hot, skill?: beginner|intermediate|advanced, highProtein?: boolean, lowCarb?: boolean }
- mealType: breakfast|lunch|dinner|snack
- calorieTarget: number (50-5000)
- dietaryPreference: vegetarian|non-vegetarian|vegan|any
- spiceLevel: mild|medium|hot
- skillLevel: beginner|intermediate|advanced
- servings: number (1-20)
- allergies: string[] (only foods the user says they are allergic to)
- avoidFoods: string[] (only foods the user says to avoid)

Rules:
1. Do NOT invent recipes or ingredient lists beyond what the user said.
2. Never override allergies — you do not decide allergen safety.
3. Prefer food_waste mode when the user lists ingredients they have.
4. If the request is vague ("surprise me"), set craving and leave ingredients empty.
5. Omit fields you cannot infer.`;

const NOTICE_LOCAL_DOWN =
  "Local AI model not reachable — used deterministic local intent parsing instead. Core recommendations still run locally.";
const NOTICE_LOCAL_TIMEOUT =
  "Local AI model timed out — used deterministic local intent parsing instead. Core recommendations still run locally.";
const NOTICE_LOCAL_INVALID =
  "Local AI model returned an unusable answer — used deterministic local intent parsing instead. Core recommendations still run locally.";
const NOTICE_LOCAL_UNLOADED =
  "Local AI model is starting (weights not loaded yet) — used deterministic local intent parsing instead. Core recommendations still run locally.";
const NOTICE_HEURISTIC_MODE =
  "Deterministic local intent parsing (AI provider disabled). Core recommendations still run locally.";

/** Enrich heuristic intent with structured craving signals from the local vocabulary parser. */
function heuristicWithSignals(text: string): RecommendationIntent {
  const heuristic = parseIntentHeuristic(text);
  const signals = parseCravingSignals(text);
  const hasSignals = Object.values(signals).some((v) => v.length > 0);
  return hasSignals ? { ...heuristic, cravingSignals: signals } : heuristic;
}

/**
 * Additive safety union: FlavoraLM is narrow and may miss an exclusion the
 * deterministic parser catches ("avoid pork"). The model can never REMOVE
 * exclusions — heuristic-found allergies/avoidFoods are unioned in.
 */
function withHeuristicSafety(intent: RecommendationIntent, text: string): RecommendationIntent {
  const h = parseIntentHeuristic(text);
  const union = (a?: string[], b?: string[]): string[] | undefined => {
    const merged = [...new Set([...(a ?? []), ...(b ?? [])].map((s) => s.toLowerCase().trim()).filter(Boolean))];
    return merged.length ? merged : undefined;
  };
  const allergies = union(intent.allergies, h.allergies);
  const avoidFoods = union(intent.avoidFoods, h.avoidFoods);
  return {
    ...intent,
    ...(allergies ? { allergies } : {}),
    ...(avoidFoods ? { avoidFoods } : {}),
  };
}

function classifyLocalError(e: unknown): { reason: FallbackReason; notice: string; detail: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed out|timeout|abort/i.test(msg)) return { reason: "local-timeout", notice: NOTICE_LOCAL_TIMEOUT, detail: msg.slice(0, 300) };
  if (/503|not loaded|weights/i.test(msg)) return { reason: "local-unloaded", notice: NOTICE_LOCAL_UNLOADED, detail: msg.slice(0, 300) };
  if (/no usable intent|empty\/invalid|malformed|empty AI|invalid|empty FlavoraLM/i.test(msg)) {
    return { reason: "local-invalid", notice: NOTICE_LOCAL_INVALID, detail: msg.slice(0, 300) };
  }
  return { reason: "local-unreachable", notice: NOTICE_LOCAL_DOWN, detail: msg.slice(0, 300) };
}

type ProbedProvider = AIProvider & {
  probeAvailability?: () => Promise<boolean>;
  probeStatus?: () => Promise<LocalLlmStatus>;
};

/** Probe with full fidelity: prefer probeStatus() so unloaded ≠ unreachable. */
async function probeProvider(p: ProbedProvider): Promise<{ reachable: boolean; status: LocalLlmStatus | null }> {
  if (typeof p.probeStatus === "function") {
    try {
      const status = await p.probeStatus();
      return { reachable: status.usable, status };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { reachable: false, status: { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable" } };
    }
  }
  try {
    const reachable =
      typeof p.probeAvailability === "function" ? await p.probeAvailability() : p.isAvailable();
    return { reachable, status: null };
  } catch (e) {
    return { reachable: false, status: null };
  }
}

/**
 * Parse natural language into a validated RecommendationIntent.
 *
 * Flavora is local-only: the only LLM is FlavoraLM.
 * - "local" (default): FlavoraLM; unreachable/timeout/invalid → deterministic
 *   heuristic with an explicit fallbackReason (never a silent remote switch).
 * - "heuristic": always deterministic parsing (no LLM).
 *
 * All provider output is schema-validated; malformed output falls back to
 * heuristics. The engine's hard allergy/avoid filter always runs after this
 * regardless of source.
 */
export async function parseUserIntent(
  message: string,
  opts?: {
    provider?: AIProvider;
    selection?: ProviderSelection;
    provided?: RecommendationIntent;
  }
): Promise<ParsedAssistantRequest> {
  if (opts?.provided && Object.keys(opts.provided).length > 0) {
    return { intent: normalizeIntent(opts.provided), source: "provided", fallbackReason: "none" };
  }

  const text = String(message ?? "").trim();
  if (!text) {
    return {
      intent: normalizeIntent({ mode: "normal" }),
      source: "heuristic",
      notice: "Empty request — using defaults.",
      fallbackReason: "heuristic-mode",
    };
  }

  /** Pick the right system prompt: local providers may use a compact CPU-friendly one. */
  const systemPromptFor = (p: AIProvider): string => {
    const local = p as AIProvider & { intentSystemPrompt?: () => string };
    return typeof local.intentSystemPrompt === "function" ? local.intentSystemPrompt() : INTENT_SYSTEM_PROMPT;
  };

  // Injected provider (tests / custom wiring). Local-only: groq-named
  // providers are treated as unavailable (no remote calls allowed).
  if (opts?.provider) {
    if (opts.provider.name === "groq") {
      return {
        intent: heuristicWithSignals(text),
        source: "heuristic",
        notice: NOTICE_HEURISTIC_MODE,
        fallbackReason: "heuristic-mode",
      };
    }
    const probed = opts.provider as ProbedProvider;
    const { reachable, status } = await probeProvider(probed);
    if (!reachable) {
      if (status?.detail === "unloaded" || status?.runtimeReachable === true) {
        return {
          intent: heuristicWithSignals(text),
          source: "heuristic",
          notice: NOTICE_LOCAL_UNLOADED,
          fallbackReason: "local-unloaded",
          detail: `probe httpStatus=${status?.httpStatus ?? "?"} model=${status?.model ?? "?"} loaded=${status?.modelInstalled ?? false}`,
        };
      }
      return {
        intent: heuristicWithSignals(text),
        source: "heuristic",
        notice: NOTICE_LOCAL_DOWN,
        fallbackReason: "local-unreachable",
        detail: status ? `probe detail=${status.detail} reachable=${status.runtimeReachable}` : "probe failed",
      };
    }
    try {
      const rawText = await opts.provider.complete(systemPromptFor(opts.provider), text);
      const parsed = withHeuristicSafety(normalizeIntent(extractJsonObject(rawText)), text);
      return { intent: parsed, source: "local", fallbackReason: "none" };
    } catch (e) {
      const { reason, notice, detail } = classifyLocalError(e);
      return { intent: heuristicWithSignals(text), source: "heuristic", notice, fallbackReason: reason, detail };
    }
  }

  const selection: ProviderSelection = opts?.selection ?? config.aiProvider;
  const { provider, resolvedMode } = createAIProvider({ selection });

  // Heuristic mode: no LLM ever.
  if (resolvedMode === "heuristic") {
    return {
      intent: heuristicWithSignals(text),
      source: "heuristic",
      notice: NOTICE_HEURISTIC_MODE,
      fallbackReason: "heuristic-mode",
    };
  }

  // Local mode (the only LLM path): await certainty via probeStatus —
  // never the cold-start sync isAvailable() cache — then complete.
  // probeStatus distinguishes "up but weights loading" (unloaded/starting)
  // from genuinely unreachable, so the UI notice is honest.
  const localProvider = provider as ProbedProvider;
  const { reachable, status } = await probeProvider(localProvider);
  if (!reachable) {
    if (status?.detail === "unloaded" || status?.runtimeReachable === true) {
      return {
        intent: heuristicWithSignals(text),
        source: "heuristic",
        notice: NOTICE_LOCAL_UNLOADED,
        fallbackReason: "local-unloaded",
        detail: `probe httpStatus=${status?.httpStatus ?? "?"} model=${status?.model ?? "?"} loaded=${status?.modelInstalled ?? false}`,
      };
    }
    return {
      intent: heuristicWithSignals(text),
      source: "heuristic",
      notice: NOTICE_LOCAL_DOWN,
      fallbackReason: "local-unreachable",
      detail: status ? `probe detail=${status.detail} reachable=${status.runtimeReachable}` : "probe failed",
    };
  }
  try {
    const rawText = await localProvider.complete(systemPromptFor(localProvider), text);
    const parsed = withHeuristicSafety(normalizeIntent(extractJsonObject(rawText)), text);
    return { intent: parsed, source: "local", fallbackReason: "none" };
  } catch (e) {
    const { reason, notice, detail } = classifyLocalError(e);
    return { intent: heuristicWithSignals(text), source: "heuristic", notice, fallbackReason: reason, detail };
  }
}

/** Build a short conversational explanation from real engine matchReasons (no invented recipes). */
export function buildAssistantReply(
  message: string,
  intent: RecommendationIntent,
  recommendations: { title: string; matchReasons: string[] }[],
  notice?: string
): string {
  const parts: string[] = [];
  if (notice) parts.push(notice);

  if (recommendations.length === 0) {
    parts.push(
      "I couldn't find a strong match in your local recipe library for that request. Try adding more ingredients, increasing your time limit, or picking another cuisine — allergy and avoid-food filters always stay on."
    );
    return parts.join(" ");
  }

  const modeHint =
    intent.mode === "food_waste"
      ? "Prioritising recipes that use what you already have."
      : intent.mode === "budget"
        ? "Prioritising lower cost-tier recipes (not live grocery prices)."
        : "Here are allergy-safe picks from your local library.";

  parts.push(modeHint);
  const top = recommendations.slice(0, 3);
  for (const r of top) {
    const why = (r.matchReasons ?? []).slice(0, 2).join("; ");
    parts.push(`${r.title}${why ? ` — ${why}` : ""}.`);
  }
  if (intent.cuisine) parts.push(`Filtered to ${intent.cuisine} cuisine.`);
  void message;
  return parts.join(" ");
}
