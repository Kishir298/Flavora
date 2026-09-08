import { createAIProvider } from "./provider.js";
import { extractJsonObject, normalizeIntent } from "./intentSchema.js";
import { parseIntentHeuristic } from "./heuristicParser.js";
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
- preferences: { spice?: mild|medium|hot, skill?: beginner|intermediate|advanced, highProtein?: boolean, lowCarb?: boolean }

Rules:
1. Do NOT invent recipes or ingredient lists beyond what the user said.
2. Never override allergies — you do not decide allergen safety.
3. Prefer food_waste mode when the user lists ingredients they have.
4. If the request is vague ("surprise me"), set craving and leave ingredients empty.
5. Omit fields you cannot infer.`;

/**
 * Parse natural language into a validated RecommendationIntent.
 * Uses Groq when available; falls back to deterministic heuristics.
 */
export async function parseUserIntent(
  message: string,
  opts?: { provider?: AIProvider; provided?: RecommendationIntent }
): Promise<ParsedAssistantRequest> {
  if (opts?.provided && Object.keys(opts.provided).length > 0) {
    return { intent: normalizeIntent(opts.provided), source: "provided" };
  }

  const text = String(message ?? "").trim();
  if (!text) {
    return { intent: normalizeIntent({ mode: "normal" }), source: "heuristic", notice: "Empty request — using defaults." };
  }

  const provider = opts?.provider ?? createAIProvider();
  if (provider.isAvailable()) {
    try {
      const rawText = await provider.complete(INTENT_SYSTEM_PROMPT, text);
      const parsed = normalizeIntent(extractJsonObject(rawText));
      return { intent: parsed, source: "groq" };
    } catch {
      const intent = parseIntentHeuristic(text);
      return {
        intent,
        source: "heuristic",
        notice: "AI assistant unavailable — used local intent parsing instead.",
      };
    }
  }

  return {
    intent: parseIntentHeuristic(text),
    source: "heuristic",
    notice: "No GROQ_API_KEY configured — using local intent parsing. Core recommendations still run locally.",
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
