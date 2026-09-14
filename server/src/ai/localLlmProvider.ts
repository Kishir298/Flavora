import type { AIProvider } from "./types.js";

/**
 * Local LLM provider (Ollama-compatible chat API).
 * Genuinely local: the configured host must be a loopback/localhost address,
 * so selecting this provider can never contact a remote service.
 * All requests stay on the user's machine.
 */

const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:3b";
/** Generous default: CPU-only machines may need ~40s cold model load + very slow prompt eval. */
const DEFAULT_TIMEOUT_MS = 300_000;
/**
 * Compact intent prompt for local models: long prompts dominate CPU prompt-eval
 * time (seconds per token on low-end hardware), so the default system prompt is
 * a minimal variant. Set LOCAL_LLM_FULL_PROMPT=true to use the full one.
 */
export const LOCAL_INTENT_SYSTEM_PROMPT = `Cooking request to JSON. Optional keys: availableIngredients (string[]), timeLimit (5-180), cuisine (italian|indian|chinese|japanese|mexican|french|american|mediterranean|middle eastern|african|null), mode (normal|food_waste|budget), cravingSignals (ONLY textures [crispy|creamy], flavors [spicy|savory|sweet|fresh], moods [comforting|refreshing], temperature [warm|cold], satiety [filling|light], mealStyle [quick|breakfast|dessert]). Never invent ingredients. Output ONLY the JSON object.`;

/** Only loopback/localhost hosts qualify as "local". IPv4/IPv6 loopback + localhost names. */
export function isLocalHost(host: string): boolean {
  try {
    const url = new URL(host);
    const h = url.hostname.toLowerCase();
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "[::1]" ||
      h === "0.0.0.0" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export class LocalLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalLlmError";
  }
}

/** Full-featured prompt (optional; long — costs significant CPU prompt-eval time). */
const FULL_LOCAL_INTENT_PROMPT = `You are Flavora's intent parser for a local-first cooking app.
Extract structured recommendation parameters from the user's message.
Return ONLY a JSON object with these optional fields:
- availableIngredients: string[] (ingredients the user has on hand)
- timeLimit: number (minutes, 5-180)
- cuisine: one of italian|indian|chinese|japanese|mexican|french|american|mediterranean|middle eastern|african, or null
- mode: "normal" | "food_waste" | "budget" (food_waste when using what they have; budget when cheap)
- craving: short free-text mood (or null)
- cravingSignals: optional object drawn ONLY from this controlled vocabulary:
  { textures: [crispy|crunchy|creamy|tender|fluffy|chewy], flavors: [spicy|savory|sweet|tangy|smoky|fresh|cheesy|umami|herby], moods: [comforting|cozy|refreshing|indulgent|homely], temperature: [warm|hot dish|cold|chilled], satiety: [filling|hearty|light|substantial], mealStyle: [quick|one-pot|snack|breakfast|dessert|handheld] }
- preferences: { spice?: mild|medium|hot, skill?: beginner|intermediate|advanced, highProtein?: boolean, lowCarb?: boolean }
Rules: do NOT invent recipes or ingredients; never override allergies; omit fields you cannot infer.`;

export class LocalLlmProvider implements AIProvider {
  readonly name = "local";
  private readonly host: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fullPrompt: boolean;
  private availabilityCache: { ok: boolean; checkedAt: number } | null = null;
  private static readonly AVAILABILITY_TTL_MS = 30_000;

  constructor(opts?: { host?: string; model?: string; timeoutMs?: number; fullPrompt?: boolean }) {
    const host = opts?.host ?? DEFAULT_HOST;
    if (!isLocalHost(host)) {
      throw new LocalLlmError(`Refusing non-local LLM host "${host}" — the local provider only talks to loopback/localhost.`);
    }
    this.host = host.replace(/\/$/, "");
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fullPrompt = opts?.fullPrompt ?? false;
  }

  get hostUrl(): string {
    return this.host;
  }

  get modelName(): string {
    return this.model;
  }

  /** System prompt for intent extraction (compact by default for CPU inference). */
  intentSystemPrompt(): string {
    return this.fullPrompt ? FULL_LOCAL_INTENT_PROMPT : LOCAL_INTENT_SYSTEM_PROMPT;
  }

  /** Cheap check: is a local runtime listening and does it list our model? Cached briefly. */
  isAvailable(): boolean {
    // Synchronous contract (AIProvider). Kick off async probe + serve cached value.
    // First call may report stale/false; callers that need certainty use probeAvailability().
    const cached = this.availabilityCache;
    if (cached && Date.now() - cached.checkedAt < LocalLlmProvider.AVAILABILITY_TTL_MS) return cached.ok;
    void this.probeAvailability().catch(() => {});
    return cached?.ok ?? false;
  }

  /** Async availability probe: /api/tags must succeed and list the configured model. */
  async probeAvailability(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
      if (!res.ok) throw new LocalLlmError(`local LLM /api/tags HTTP ${res.status}`);
      const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
      const models = data.models ?? [];
      const wanted = this.model.toLowerCase();
      const ok = models.some((m) => String(m.name ?? m.model ?? "").toLowerCase() === wanted);
      this.availabilityCache = { ok, checkedAt: Date.now() };
      return ok;
    } catch (e) {
      this.availabilityCache = { ok: false, checkedAt: Date.now() };
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          // Small structured-intent JSON: cap generation so slow CPUs stay inside the timeout.
          options: { temperature: 0.2, num_predict: 160 },
          keep_alive: "10m",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LocalLlmError(`local LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new LocalLlmError("empty local LLM content");
      return content;
    } catch (e) {
      if (e instanceof LocalLlmError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // Distinguish timeout/abort from connection failure for clearer notices.
      if (msg.includes("aborted") || msg.includes("abort")) {
        throw new LocalLlmError(`local LLM timed out after ${this.timeoutMs}ms`);
      }
      throw new LocalLlmError(`local LLM unreachable at ${this.host} (${msg})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
