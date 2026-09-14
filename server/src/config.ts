import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from server/, root/, and CWD — whichever exists (local-first dev).
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config({ path: path.resolve(here, "../.env") });

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  isDev: (process.env.NODE_ENV ?? "development") !== "production",
  /** Optional. Server-side only — never expose to the Vite client. */
  groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  /**
   * Local LLM (Ollama-compatible). All requests stay on this machine —
   * the host must be a local address; remote hosts are refused.
   */
  localLlmEnabled: parseBool(process.env.LOCAL_LLM_ENABLED, true),
  localLlmHost: process.env.LOCAL_LLM_HOST?.trim() || "http://127.0.0.1:11434",
  localLlmModel: process.env.LOCAL_LLM_MODEL?.trim() || "qwen2.5:3b",
  localLlmTimeoutMs: Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 300_000),
  /**
   * Provider selection: "local" | "groq" | "heuristic" | "auto".
   * auto = local (if reachable) → groq (if key set) → heuristic.
   * Explicit modes never silently switch providers.
   */
  aiProvider: parseProvider(process.env.AI_PROVIDER),
};

function parseBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function parseProvider(v: string | undefined): "local" | "groq" | "heuristic" | "auto" {
  const x = (v ?? "auto").toLowerCase().trim();
  return x === "local" || x === "groq" || x === "heuristic" ? x : "auto";
}
