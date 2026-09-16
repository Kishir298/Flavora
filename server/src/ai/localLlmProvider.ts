import type { AIProvider } from "./types.js";

/**
 * Local AI provider — FlavoraLM, our own small language model.
 *
 * Talks only to the local FlavoraLM inference service
 * (training/flavora_lm/service.py, default http://127.0.0.1:5000):
 *   GET  /health    → model identity (measured, never fabricated)
 *   POST /generate  → actual token generation
 *   POST /intent    → natural language → validated structured intent
 *
 * Genuinely local: the configured host must be a loopback/localhost address,
 * so selecting this provider can never contact a remote service.
 * No Ollama, no pretrained third-party model, no hosted inference API.
 */

const DEFAULT_HOST = "http://127.0.0.1:5000";
const DEFAULT_MODEL = "FlavoraLM";
const DEFAULT_TIMEOUT_MS = 30_000;

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

/** Result of probing the FlavoraLM service — each field measured, never assumed. */
export interface LocalLlmStatus {
  runtimeReachable: boolean;
  modelInstalled: boolean;
  usable: boolean;
  /** Model identity reported by the service (undefined when unreachable). */
  model?: string;
  version?: string;
  device?: string;
  tokenizerVersion?: string;
  parameterCount?: number;
}

export interface FlavoraHealth {
  status: string;
  model: string | null;
  version: string | null;
  parameterCount: number | null;
  contextLength: number | null;
  tokenizerVersion: string | null;
  loaded: boolean;
  device: string;
}

export class LocalLlmProvider implements AIProvider {
  readonly name = "local";
  private readonly host: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private availabilityCache: { ok: boolean; checkedAt: number } | null = null;
  private static readonly AVAILABILITY_TTL_MS = 30_000;

  constructor(opts?: { host?: string; model?: string; timeoutMs?: number }) {
    const host = opts?.host ?? DEFAULT_HOST;
    if (!isLocalHost(host)) {
      throw new LocalLlmError(`Refusing non-local AI host "${host}" — the local provider only talks to loopback/localhost.`);
    }
    this.host = host.replace(/\/$/, "");
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get hostUrl(): string {
    return this.host;
  }

  get modelName(): string {
    return this.model;
  }

  /** System prompt (kept for the AIProvider contract; FlavoraLM's /intent needs only the user text). */
  intentSystemPrompt(): string {
    return "FlavoraLM structured intent extraction";
  }

  /** Cheap check: serves the cached probe result; callers needing certainty use probeAvailability(). */
  isAvailable(): boolean {
    const cached = this.availabilityCache;
    if (cached && Date.now() - cached.checkedAt < LocalLlmProvider.AVAILABILITY_TTL_MS) return cached.ok;
    void this.probeAvailability().catch(() => {});
    return cached?.ok ?? false;
  }

  /** Async availability probe: /health must report our model loaded. */
  async probeAvailability(): Promise<boolean> {
    const status = await this.probeStatus();
    return status.usable;
  }

  /**
   * Detailed probe used by the health endpoint. Distinguishes:
   * - runtimeReachable: the FlavoraLM service answered /health
   * - modelInstalled: the service reports our model loaded (name starts with FlavoraLM)
   * - usable: reachable AND loaded
   * Never fabricated: each value comes from the actual service response.
   */
  async probeStatus(): Promise<LocalLlmStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${this.host}/health`, { signal: controller.signal });
      if (!res.ok) throw new LocalLlmError(`FlavoraLM /health HTTP ${res.status}`);
      const data = (await res.json()) as FlavoraHealth;
      const modelName = String(data.model ?? "");
      // Our model, any version: FlavoraLM or FlavoraLM-dev.
      const modelInstalled = data.loaded === true && /^flavoraLM/i.test(modelName);
      const status: LocalLlmStatus = {
        runtimeReachable: true,
        modelInstalled,
        usable: modelInstalled,
        model: data.model ?? undefined,
        version: data.version ?? undefined,
        device: data.device,
        tokenizerVersion: data.tokenizerVersion ?? undefined,
        parameterCount: data.parameterCount ?? undefined,
      };
      this.availabilityCache = { ok: status.usable, checkedAt: Date.now() };
      return status;
    } catch {
      this.availabilityCache = { ok: false, checkedAt: Date.now() };
      return { runtimeReachable: false, modelInstalled: false, usable: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Structured-intent completion via FlavoraLM.
   * Primary path: POST /intent (model generates + validates server-side).
   * Returns the intent as a JSON string so the standard
   * extractJsonObject → normalizeIntent pipeline applies unchanged.
   */
  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    void systemPrompt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.host}/intent`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LocalLlmError(`FlavoraLM /intent HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { intent?: unknown; valid?: boolean };
      if (!data.valid || data.intent == null || typeof data.intent !== "object") {
        throw new LocalLlmError("FlavoraLM returned no usable intent (empty/invalid output)");
      }
      return JSON.stringify(data.intent);
    } catch (e) {
      if (e instanceof LocalLlmError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted") || msg.includes("abort")) {
        throw new LocalLlmError(`FlavoraLM timed out after ${this.timeoutMs}ms`);
      }
      throw new LocalLlmError(`FlavoraLM unreachable at ${this.host} (${msg})`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Raw text generation via FlavoraLM (used by verification + explanations). */
  async generate(prompt: string, opts?: { maxNewTokens?: number; temperature?: number }): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.host}/generate`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          maxNewTokens: opts?.maxNewTokens ?? 48,
          temperature: opts?.temperature ?? 0.2,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LocalLlmError(`FlavoraLM /generate HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { text?: string };
      if (!data.text) throw new LocalLlmError("empty FlavoraLM generation");
      return data.text;
    } catch (e) {
      if (e instanceof LocalLlmError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted") || msg.includes("abort")) {
        throw new LocalLlmError(`FlavoraLM timed out after ${this.timeoutMs}ms`);
      }
      throw new LocalLlmError(`FlavoraLM unreachable at ${this.host} (${msg})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
