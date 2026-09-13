/**
 * Substitution safety tri-state (Step 4). Deterministic, reuses hard filter.
 * safe | unsafe | unknown — never label safe when uncertain.
 */
import { ingredientViolatesTerm } from "./filter.js";

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

/**
 * @param {string} substituteName
 * @param {{ allergies?: string[], avoid_foods?: string[], avoidFoods?: string[] }} profile
 * @returns {"safe"|"unsafe"|"unknown"}
 */
export function substitutionSafety(substituteName, profile = {}) {
  const name = norm(substituteName);
  if (!name) return "unknown";
  const forbidden = [
    ...((profile.allergies ?? []).map(norm)),
    ...((profile.avoid_foods ?? profile.avoidFoods ?? []).map(norm)),
  ].filter(Boolean);
  if (forbidden.length === 0) return "unknown"; // no restrictions to check against — cannot assert safe
  for (const term of forbidden) {
    try {
      if (ingredientViolatesTerm(name, term)) return "unsafe";
    } catch {
      return "unknown";
    }
  }
  // No deterministic violation found, but absence of evidence is not proof:
  // mark safe only when we actually checked a non-empty restriction set.
  return "safe";
}

/** Validate an apply-substitution request body. Returns error string or null. */
export function validateSubstitutionInput({ recipeId, originalName, replacementName }) {
  if (!recipeId || typeof recipeId !== "string") return "recipeId is required";
  if (!originalName || typeof originalName !== "string" || !norm(originalName)) return "originalName is required";
  if (!replacementName || typeof replacementName !== "string" || !norm(replacementName)) return "replacementName is required";
  if (norm(originalName) === norm(replacementName)) return "replacement must differ from original";
  if (originalName.length > 120 || replacementName.length > 120) return "ingredient name too long";
  return null;
}
