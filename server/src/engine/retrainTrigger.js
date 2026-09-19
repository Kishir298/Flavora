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
const VENV_PYTHON = path.resolve(here, "./.venv/bin/python");

export const RETRAIN_EVERY_N = 20;

// Only labelled outcomes train the model — shown/viewed are display events.
export const OUTCOME_ACTIONS = ["saved", "unsaved", "cooked", "rated_positive", "rated_negative", "skipped", "rated"];

function resolvePython() {
  try {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  } catch {
    /* ignore */
  }
  return "python3";
}

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
    const child = spawnFn(resolvePython(), [RETRAIN_SCRIPT, "--user-id", safeUser], {
      detached: true,
      stdio: "ignore",
    });
    child?.unref?.();
    return { triggered: true, count };
  } catch (e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "retrain_spawn_failed", error: String(e) }));
    return { triggered: false, count };
  }
}
