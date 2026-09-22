/**
 * Retrain trigger helper (guide step 8, literal .js path).
 * After every 20 new logged interactions for a user, run retrain.py
 * in the background. Prefers engine/.venv/bin/python when present.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RETRAIN_SCRIPT = path.resolve(here, "./retrain.py");
// Candidate interpreters, first-exists-wins. Env override first for tests and
// custom setups; canonical repo venv before the legacy engine-local one;
// PATH fallbacks last (may lack sklearn/torch — failure is logged, not silent).
const CANDIDATE_PYTHONS = [
  process.env.FLAVORA_PYTHON,
  process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, "bin", "python") : null,
  path.resolve(here, "../../../.flavoralm-venv/bin/python"),
  path.resolve(here, "../../../.flavoralm-venv/Scripts/python.exe"),
  path.resolve(here, "./.venv/bin/python"),
  "python3",
  "python",
].filter(Boolean);

function resolvePython() {
  for (const p of CANDIDATE_PYTHONS) {
    if (!p.includes("/") && !p.includes("\\")) return p; // PATH fallback, checked at spawn
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return "python3";
}

export const RETRAIN_EVERY_N = 20;

// Only labelled outcomes train the model — shown/viewed are display events.
export const OUTCOME_ACTIONS = ["saved", "unsaved", "cooked", "rated_positive", "rated_negative", "skipped", "rated"];

function sanitizeUserId(v) {
  const s = String(v ?? "local").trim();
  // Prevent argparse flag injection ("--db ...") — strict allowlist.
  return /^[a-zA-Z0-9_-]{1,32}$/.test(s) ? s : "local";
}

/**
 * @param {{ count: (args: any) => Promise<number> }} interactionDelegate prisma.interaction
 * @param {string} [userId]
 * @param {{ spawnFn?: typeof spawn }} [opts] injectable for tests
 * @returns {Promise<{triggered: boolean, count?: number}>}
 */
export async function maybeTriggerRetrain(interactionDelegate, userId = "local", opts = {}) {
  const spawnFn = opts.spawnFn ?? spawn;
  const safeUser = sanitizeUserId(userId);
  let count = 0;
  try {
    try {
      count = await interactionDelegate.count({ where: { action: { in: OUTCOME_ACTIONS } } });
    } catch {
      // Test doubles / old delegates without where-support: fall back to total.
      count = await interactionDelegate.count({});
    }
  } catch {
    return { triggered: false };
  }
  if (count === 0 || count % RETRAIN_EVERY_N !== 0) return { triggered: false, count };
  try {
    const python = resolvePython();
    const child = spawnFn(python, [RETRAIN_SCRIPT, "--user-id", safeUser], {
      detached: true,
      stdio: "ignore",
    });
    child?.unref?.();
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "retrain_triggered", count, resolved_python: python }));
    return { triggered: true, count };
  } catch (e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "retrain_spawn_failed", error: String(e) }));
    return { triggered: false, count };
  }
}
