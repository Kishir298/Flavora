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
  /** Local-first dev: no remote AI keys. All inference runs on this machine. */
  /**
   * FlavoraLM — our own local language model (training/flavora_lm).
   * All requests stay on this machine — the host must be a local address;
   * remote hosts are refused. `local` provider mode means FlavoraLM.
   *
   * FLAVORA_LM_* is canonical; legacy LOCAL_LLM_* vars still work as fallback.
   */
  localLlmEnabled: parseBool(process.env.FLAVORA_LM_ENABLED ?? process.env.LOCAL_LLM_ENABLED, true),
  localLlmHost:
    process.env.FLAVORA_LM_HOST?.trim() ||
    process.env.LOCAL_LLM_HOST?.trim() ||
    `http://127.0.0.1:${process.env.FLAVORA_LM_PORT?.trim() || "5000"}`,
  localLlmModel:
    process.env.FLAVORA_LM_MODEL?.trim() || process.env.LOCAL_LLM_MODEL?.trim() || "FlavoraLM",
  localLlmTimeoutMs: clampTimeoutMs(
    Number(process.env.FLAVORA_LM_TIMEOUT_MS ?? process.env.LOCAL_LLM_TIMEOUT_MS ?? 30_000)
  ),
  /**
   * Provider selection: "local" | "heuristic".
   * "local" (default) = FlavoraLM only; unreachable/invalid → honest
   * deterministic fallback with an explicit fallbackReason (never a
   * silent remote switch — there is no remote provider).
   * "heuristic" = deterministic local parsing, no LLM at all.
   */
  aiProvider: parseProvider(process.env.AI_PROVIDER),
};

function parseBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function parseProvider(v: string | undefined): "local" | "heuristic" {
  const x = (v ?? "local").toLowerCase().trim();
  return x === "heuristic" ? "heuristic" : "local";
}

function clampTimeoutMs(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 30_000;
  return Math.min(120_000, Math.max(1_000, Math.round(n)));
}
