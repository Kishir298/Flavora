/** Local recipe database access (§5). The `recipes` table IS the source of
 * truth — no external fetch, no cache-freshness concerns. */
import { prisma } from "./db.js";
import { ingredientViolatesTerm } from "./engine/filter.js";
import type { Recipe } from "./types.js";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToRecipe(row: {
  id: string;
  title: string;
  cuisine: string;
  cookTimeMinutes: number;
  difficulty: string;
  spiceLevel: string;
  dietTags: string;
  ingredients: string;
  instructions: string;
  nutrition: string;
  costTier: string;
  storageTips: string;
}): Recipe {
  return {
    id: row.id,
    title: row.title,
    cuisine: row.cuisine,
    cookTimeMinutes: row.cookTimeMinutes,
    difficulty: row.difficulty as Recipe["difficulty"],
    spiceLevel: row.spiceLevel as Recipe["spiceLevel"],
    dietTags: parseJson<string[]>(row.dietTags, []),
    ingredients: parseJson<Recipe["ingredients"]>(row.ingredients, []),
    instructions: parseJson<string[]>(row.instructions, []),
    nutrition: parseJson<Recipe["nutrition"]>(row.nutrition, {}),
    costTier: row.costTier as Recipe["costTier"],
    storageTips: row.storageTips,
  };
}

export async function listRecipes(opts: { cuisine?: string; limit?: number } = {}): Promise<Recipe[]> {
  const rows = await prisma.recipe.findMany({
    orderBy: { title: "asc" },
    take: opts.limit ?? 200,
  });
  const recipes = rows.map(rowToRecipe);
  if (!opts.cuisine) return recipes;
  const want = opts.cuisine.toLowerCase();
  return recipes.filter((r) => (r.cuisine ?? "").toLowerCase() === want);
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const row = await prisma.recipe.findUnique({ where: { id } });
  return row ? rowToRecipe(row) : null;
}

export interface SubstituteOption {
  name: string;
  notes: string;
}

export interface ProfileRestrictions {
  allergies?: string[];
  avoidFoods?: string[];
  avoid_foods?: string[];
}

function forbiddenTerms(profile?: ProfileRestrictions): string[] {
  if (!profile) return [];
  return [...(profile.allergies ?? []), ...(profile.avoidFoods ?? []), ...(profile.avoid_foods ?? [])]
    .map((s) => String(s ?? "").toLowerCase().trim())
    .filter(Boolean);
}

/** True if a substitute string conflicts with allergies / avoid foods. */
export function substituteConflicts(substituteName: string, profile?: ProfileRestrictions): boolean {
  const forbidden = forbiddenTerms(profile);
  if (forbidden.length === 0) return false;
  for (const term of forbidden) {
    if (ingredientViolatesTerm(substituteName, term)) return true;
  }
  return false;
}

/**
 * Cheap-swap lookup from the local `ingredient_substitutes` table (§4.3).
 * Omits substitutes that conflict with the user's allergy/avoid profile —
 * a substitute is never treated as automatically allergen-safe.
 */
export async function substitutesFor(
  ingredients: Recipe["ingredients"],
  profile?: ProfileRestrictions
): Promise<Record<string, SubstituteOption[]>> {
  const names = ingredients.map((i) => (typeof i === "string" ? i : i.name).toLowerCase());
  if (names.length === 0) return {};
  const rows = await prisma.ingredientSubstitute.findMany({});
  const out: Record<string, SubstituteOption[]> = {};
  for (const ing of ingredients) {
    const raw = typeof ing === "string" ? ing : ing.name;
    const label = typeof ing === "string" ? ing : ing.name;
    const matches = rows.filter((r) => raw.toLowerCase().includes(r.ingredientName.toLowerCase()));
    for (const row of matches) {
      if (substituteConflicts(row.substituteName, profile)) continue;
      const entry: SubstituteOption = { name: row.substituteName, notes: row.notes || "" };
      const list = out[label] ?? (out[label] = []);
      if (!list.some((x) => x.name === entry.name)) list.push(entry);
    }
  }
  return out;
}

/** Back-compat flat map of substitute name strings (for older callers/tests). */
export function flattenSubstitutions(detailed: Record<string, SubstituteOption[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(detailed)) {
    out[k] = list.map((s) => s.name);
  }
  return out;
}
