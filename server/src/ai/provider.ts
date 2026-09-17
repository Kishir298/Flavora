import { config } from "../config.js";
import { LocalLlmProvider, isLocalHost } from "./localLlmProvider.js";
import type { AIProvider } from "./types.js";

export type ProviderSelection = "local" | "heuristic";
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
  /** Resolved selection mode (local-only; no remote providers exist). */
  resolvedMode: ProviderSelection;
  /** The local provider when one is constructible. */
  localProvider?: LocalLlmProvider;
}

/**
 * Build providers. Flavora is local-only:
 * - "local"     → LocalLlmProvider. Caller decides fallback policy; we
 *                 never switch to a remote provider (none exists).
 * - "heuristic" → unavailable (deterministic parsing used upstream).
 */
export function createAIProvider(overrides?: {
  selection?: ProviderSelection;
  localHost?: string;
  localModel?: string;
  localTimeoutMs?: number;
}): ProviderFactoryResult {
  const selection = overrides?.selection ?? config.aiProvider;

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

  switch (selection) {
    case "heuristic":
      return { provider: new UnavailableProvider(), resolvedMode: "heuristic" };
    case "local":
    default:
      return { provider: localProvider ?? new UnavailableProvider(), resolvedMode: "local", localProvider };
  }
}
