/**
 * Guide steps 1/6/9 — weight loading (literal .js path).
 * Single-user local app: userId is always "local".
 */
import { DEFAULT_WEIGHTS } from "./scorer.js";

export { DEFAULT_WEIGHTS };

/** Minimum explicit outcomes before learned weights are trusted (guide step 6). */
export const COLD_START_MIN_OUTCOMES = 20;

/** @param {Record<string, number>} weights */
export function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!sum || sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = v / sum;
  return out;
}

/** @param {{featureName:string,weightValue:number}[]} rows */
export function weightsFromRows(rows) {
  const w = { ...DEFAULT_WEIGHTS };
  for (const r of rows ?? []) {
    if (r.featureName in w) w[r.featureName] = Number(r.weightValue);
  }
  return w;
}

/**
 * Resolve effective weights: learned rows only when outcomeCount >= threshold,
 * else static defaults (guide step 6 — never learn from too little signal).
 * @param {{outcomeCount?: number, rows?: {featureName:string,weightValue:number}[]}} args
 */
export function resolveWeights({ outcomeCount = 0, rows = [] } = {}) {
  if (outcomeCount >= COLD_START_MIN_OUTCOMES && rows.length > 0) {
    return weightsFromRows(rows);
  }
  return { ...DEFAULT_WEIGHTS };
}
