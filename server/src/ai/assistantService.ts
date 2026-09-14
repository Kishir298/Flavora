import { createAIProvider, type ProviderSelection } from "./provider.js";
import { extractJsonObject, normalizeIntent } from "./intentSchema.js";
import { parseIntentHeuristic } from "./heuristicParser.js";
import { parseCravingSignals } from "../engine/craving.js";
import type { AIProvider, ParsedAssistantRequest, RecommendationIntent } from "./types.js";

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

Rules:
1. Do NOT invent recipes or ingredient lists beyond what the user said.
2. Never override allergies — you do not decide allergen safety.
3. Prefer food_waste mode when the user lists ingredients they have.
4. If the request is vague ("surprise me"), set craving and leave ingredients empty.
5. Omit fields you cannot infer.`;

const HEURISTIC_NOTICE_GROQ = "No GROQ_API_KEY configured — using local intent parsing. Core recommendations still run locally.";
const HEURISTIC_NOTICE_LOCAL_DOWN = "Local AI model not reachable — used deterministic local intent parsing instead. Core recommendations still run locally.";

/** Enrich heuristic intent with structured craving signals from the local vocabulary parser. */
function heuristicWithSignals(text: string): RecommendationIntent {
  const heuristic = parseIntentHeuristic(text);
  const signals = parseCravingSignals(text);
  const hasSignals = Object.values(signals).some((v) => v.length > 0);
  return hasSignals ? { ...heuristic, cravingSignals: signals } : heuristic;
}

/**
 * Parse natural language into a validated RecommendationIntent.
 *
 * Provider behaviour by selection mode (AI_PROVIDER):
 * - "local": ONLY the local LLM. If unreachable → deterministic heuristic parse
 *   with an explicit notice; never silently switches to a remote provider.
 * - "groq": Groq; on failure → deterministic heuristic with a notice.
 * - "heuristic": always deterministic parsing (no LLM).
 * - "auto": local LLM (if running) → Groq (if configured) → heuristic.
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
    return { intent: normalizeIntent(opts.provided), source: "provided" };
  }

  const text = String(message ?? "").trim();
  if (!text) {
    return { intent: normalizeIntent({ mode: "normal" }), source: "heuristic", notice: "Empty request — using defaults." };
  }

  /** Pick the right system prompt: local providers may use a compact CPU-friendly one. */
  const systemPromptFor = (p: AIProvider): string => {
    const local = p as AIProvider & { intentSystemPrompt?: () => string };
    return typeof local.intentSystemPrompt === "function" ? local.intentSystemPrompt() : INTENT_SYSTEM_PROMPT;
  };

  // Injected provider (tests / custom wiring).
  if (opts?.provider) {
    if (opts.provider.isAvailable()) {
      try {
        const rawText = await opts.provider.complete(systemPromptFor(opts.provider), text);
        const parsed = normalizeIntent(extractJsonObject(rawText));
        return { intent: parsed, source: opts.provider.name === "local" ? "local" : "groq" };
      } catch {
        return { intent: heuristicWithSignals(text), source: "heuristic", notice: "AI assistant unavailable — used local intent parsing instead." };
      }
    }
    return { intent: heuristicWithSignals(text), source: "heuristic", notice: "AI assistant unavailable — used local intent parsing instead." };
  }

  const selection: ProviderSelection = opts?.selection ?? "auto";
  const { provider, resolvedMode } = createAIProvider({ selection });

  // Heuristic mode: no LLM ever.
  if (resolvedMode === "heuristic") {
    return {
      intent: heuristicWithSignals(text),
      source: "heuristic",
      notice: "Deterministic local intent parsing (AI provider disabled). Core recommendations still run locally.",
    };
  }

  // Explicit "local" mode: probe certainty; do NOT fall back to Groq.
  if (resolvedMode === "local") {
    const localProvider = provider as AIProvider & { probeAvailability?: () => Promise<boolean> };
    const reachable = typeof localProvider.probeAvailability === "function"
      ? await localProvider.probeAvailability()
      : localProvider.isAvailable();
    if (!reachable) {
      return {
        intent: heuristicWithSignals(text),
        source: "heuristic",
        notice: HEURISTIC_NOTICE_LOCAL_DOWN,
      };
    }
    try {
      const rawText = await localProvider.complete(systemPromptFor(localProvider), text);
      const parsed = normalizeIntent(extractJsonObject(rawText));
      return { intent: parsed, source: "local" };
    } catch {
      // Model present but call failed (timeout/malformed) — deterministic fallback, still local-only.
      return { intent: heuristicWithSignals(text), source: "heuristic", notice: HEURISTIC_NOTICE_LOCAL_DOWN };
    }
  }

  // Groq / auto: try provider; malformed or failed output falls back deterministically.
  if (provider.isAvailable()) {
    try {
      const rawText = await provider.complete(systemPromptFor(provider), text);
      const parsed = normalizeIntent(extractJsonObject(rawText));
      return { intent: parsed, source: "groq" };
    } catch {
      return {
        intent: heuristicWithSignals(text),
        source: "heuristic",
        notice: "AI assistant unavailable — used local intent parsing instead.",
      };
    }
  }

  // auto resolved to groq (no local runtime, no key) or provider not available.
  return {
    intent: heuristicWithSignals(text),
    source: "heuristic",
    notice: resolvedMode === "groq" ? HEURISTIC_NOTICE_GROQ : HEURISTIC_NOTICE_LOCAL_DOWN,
  };
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
