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

/** Only loopback/localhost hosts qualify as "local". Strict: localhost, 127/8, ::1. */
export function isLocalHost(host: string): boolean {
  try {
    const url = new URL(host);
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (h === "localhost" || h.endsWith(".localhost")) return true;
    if (h === "::1") return true;
    // 127.0.0.0/8 loopback range (127.0.0.1, 127.0.0.2, ...).
    // 0.0.0.0 (all interfaces) and *.local (mDNS LAN) are NOT loopback — refuse.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
      return h.split(".").every((oct) => {
        const n = Number(oct);
        return Number.isInteger(n) && n >= 0 && n <= 255;
      });
    }
    return false;
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

/** Clamp inference timeouts to a sane range (1s–120s). NaN/0/negative → default. */
export function clampTimeout(v: unknown, dflt = DEFAULT_TIMEOUT_MS): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(120_000, Math.max(1_000, n));
}

/** Result of probing the FlavoraLM service — each field measured, never assumed. */
export interface LocalLlmStatus {
  runtimeReachable: boolean;
  modelInstalled: boolean;
  usable: boolean;
  /** Machine-readable probe outcome: ok | unloaded (up but weights not loaded) | unreachable. */
  detail: "ok" | "unloaded" | "unreachable";
  /** HTTP status from /health when the runtime answered (e.g. 503 = starting). */
  httpStatus?: number;
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

export type LocalEngine = "torch" | "numpy";

export class LocalLlmProvider implements AIProvider {
  readonly name = "local";
  private readonly host: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly engine: LocalEngine;
  private availabilityCache: { ok: boolean; checkedAt: number } | null = null;
  private static readonly AVAILABILITY_TTL_MS = 30_000;

  constructor(opts?: { host?: string; model?: string; timeoutMs?: number; engine?: LocalEngine }) {
    const host = opts?.host ?? DEFAULT_HOST;
    if (!isLocalHost(host)) {
      throw new LocalLlmError(`Refusing non-local AI host "${host}" — the local provider only talks to loopback/localhost.`);
    }
    this.host = host.replace(/\/$/, "");
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.timeoutMs = clampTimeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const eng = opts?.engine ?? (process.env.FLAVORA_LM_ENGINE === "numpy" ? "numpy" : "torch");
    this.engine = eng === "numpy" ? "numpy" : "torch";
  }

  get engineName(): LocalEngine {
    return this.engine;
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
      let res: Response;
      try {
        res = await fetch(`${this.host}/health`, { signal: controller.signal });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/abort/i.test(msg)) {
          this.availabilityCache = { ok: false, checkedAt: Date.now() };
          return { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable" };
        }
        this.availabilityCache = { ok: false, checkedAt: Date.now() };
        return { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable" };
      }
      if (!res.ok) {
        // 503 is our service reporting weights-loading ("unloaded", still ours).
        // Any other non-OK status means the responder is NOT FlavoraLM
        // (e.g. macOS AirPlay Receiver squatting :5000 returns 404/405) —
        // report unreachable, never claim our service is reachable.
        if (res.status === 503) {
          this.availabilityCache = { ok: false, checkedAt: Date.now() };
          return {
            runtimeReachable: true,
            modelInstalled: false,
            usable: false,
            detail: "unloaded",
            httpStatus: res.status,
          };
        }
        this.availabilityCache = { ok: false, checkedAt: Date.now() };
        return {
          runtimeReachable: false,
          modelInstalled: false,
          usable: false,
          detail: "unreachable",
          httpStatus: res.status,
        };
      }
      let data: FlavoraHealth;
      try {
        data = (await res.json()) as FlavoraHealth;
      } catch {
        // 200 with a non-JSON body is not our service (port squat) — unreachable.
        this.availabilityCache = { ok: false, checkedAt: Date.now() };
        return { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable", httpStatus: 200 };
      }
      if (typeof data !== "object" || data === null || !("loaded" in data) || !("model" in data)) {
        // 200 JSON without the FlavoraLM health shape is not our service.
        this.availabilityCache = { ok: false, checkedAt: Date.now() };
        return { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable", httpStatus: 200 };
      }
      const modelName = String(data.model ?? "");
      // Our model, any version: FlavoraLM or FlavoraLM-dev.
      const modelInstalled = data.loaded === true && /^flavoraLM/i.test(modelName);
      const status: LocalLlmStatus = {
        runtimeReachable: true,
        modelInstalled,
        // Reachable but not loaded (loaded:false, wrong name) = starting/unloaded.
        usable: modelInstalled,
        detail: modelInstalled ? "ok" : "unloaded",
        httpStatus: 200,
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
      return { runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Structured-intent completion via FlavoraLM.
   * Primary path: POST /intent (torch) or /intent-numpy (NumPy v0.2 sidecar,
   * selected via engine opt or FLAVORA_LM_ENGINE=numpy). Both validate
   * server-side; invalid responses fall back honestly via LocalLlmError.
   * Returns the intent as a JSON string so the standard
   * extractJsonObject → normalizeIntent pipeline applies unchanged.
   */
  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    void systemPrompt;
    const path = this.engine === "numpy" ? "/intent-numpy" : "/intent";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.host}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userMessage }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 503) {
          throw new LocalLlmError(`FlavoraLM model not loaded (weights starting, ${path} HTTP 503): ${body.slice(0, 200)}`);
        }
        throw new LocalLlmError(`FlavoraLM ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
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
