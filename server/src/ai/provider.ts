import { config } from "../config.js";
import { GroqProvider } from "./groqProvider.js";
import type { AIProvider } from "./types.js";

/** Unavailable stub — isAvailable() false; complete() throws. */
class UnavailableProvider implements AIProvider {
  readonly name = "none";
  isAvailable(): boolean {
    return false;
  }
  async complete(): Promise<string> {
    throw new Error("No AI provider configured");
  }
}

/** Factory: Groq when GROQ_API_KEY is set, otherwise unavailable (heuristic fallback used upstream). */
export function createAIProvider(overrides?: { apiKey?: string; model?: string }): AIProvider {
  const key = overrides?.apiKey ?? config.groqApiKey;
  if (!key) return new UnavailableProvider();
  return new GroqProvider(key, overrides?.model ?? config.groqModel);
}
