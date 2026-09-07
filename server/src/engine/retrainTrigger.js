/**
 * Retrain trigger helper (guide step 8, literal .js path).
 * After every 20 new logged interactions for a user, run retrain.py
 * in the background. Daily-or-every-N is plenty for a cooking app.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RETRAIN_SCRIPT = path.resolve(here, "./retrain.py");

export const RETRAIN_EVERY_N = 20;

/**
 * @param {{ count: (args: any) => Promise<number> }} interactionDelegate prisma.interaction
 * @param {string} [userId]
 * @param {{ spawnFn?: typeof spawn }} [opts] injectable for tests
 * @returns {Promise<{triggered: boolean, count?: number}>}
 */
export async function maybeTriggerRetrain(interactionDelegate, userId = "local", opts = {}) {
  const spawnFn = opts.spawnFn ?? spawn;
  let count = 0;
  try {
    count = await interactionDelegate.count({});
  } catch {
    return { triggered: false };
  }
  if (count === 0 || count % RETRAIN_EVERY_N !== 0) return { triggered: false, count };
  try {
    const child = spawnFn("python3", [RETRAIN_SCRIPT, "--user-id", userId], {
      detached: true,
      stdio: "ignore",
    });
    child?.unref?.();
    return { triggered: true, count };
  } catch {
    return { triggered: false, count };
  }
}
