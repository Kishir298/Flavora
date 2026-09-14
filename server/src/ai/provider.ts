import { config } from "../config.js";
import { GroqProvider } from "./groqProvider.js";
import { LocalLlmProvider, isLocalHost } from "./localLlmProvider.js";
import type { AIProvider } from "./types.js";

export type ProviderSelection = "local" | "groq" | "heuristic" | "auto";
export { isLocalHost };

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

export interface ProviderFactoryResult {
  provider: AIProvider;
  /** Resolved selection mode (auto resolved to its concrete first choice). */
  resolvedMode: Exclude<ProviderSelection, "auto">;
  /** For auto/local: the local provider when one is constructible. */
  localProvider?: LocalLlmProvider;
  groqProvider?: GroqProvider;
}

/**
 * Build providers according to the selection mode (AI_PROVIDER env):
 * - "local"     → LocalLlmProvider only. Caller decides fallback policy; we do
 *                 NOT silently switch to a remote provider in this mode.
 * - "groq"      → GroqProvider when a key exists, else unavailable.
 * - "heuristic" → unavailable (deterministic parsing used upstream).
 * - "auto"      → prefer local LLM (if constructible), then Groq (if key), else unavailable.
 */
export function createAIProvider(overrides?: {
  selection?: ProviderSelection;
  apiKey?: string;
  model?: string;
  localHost?: string;
  localModel?: string;
  localTimeoutMs?: number;
}): ProviderFactoryResult {
  const selection = overrides?.selection ?? config.aiProvider;
  const apiKey = overrides?.apiKey ?? config.groqApiKey;

  let localProvider: LocalLlmProvider | undefined;
  if (config.localLlmEnabled || overrides?.localHost) {
    try {
      localProvider = new LocalLlmProvider({
        host: overrides?.localHost ?? config.localLlmHost,
        model: overrides?.localModel ?? config.localLlmModel,
        timeoutMs: overrides?.localTimeoutMs ?? config.localLlmTimeoutMs,
      });
    } catch {
      localProvider = undefined; // refused non-local host — stays disabled
    }
  }

  const groqProvider = apiKey ? new GroqProvider(apiKey, overrides?.model ?? config.groqModel) : undefined;

  switch (selection) {
    case "local":
      return { provider: localProvider ?? new UnavailableProvider(), resolvedMode: "local", localProvider };
    case "groq":
      return { provider: groqProvider ?? new UnavailableProvider(), resolvedMode: "groq", groqProvider };
    case "heuristic":
      return { provider: new UnavailableProvider(), resolvedMode: "heuristic" };
    case "auto":
    default: {
      if (localProvider) return { provider: localProvider, resolvedMode: "local", localProvider };
      if (groqProvider) return { provider: groqProvider, resolvedMode: "groq", groqProvider };
      return { provider: new UnavailableProvider(), resolvedMode: "heuristic" };
    }
  }
}
