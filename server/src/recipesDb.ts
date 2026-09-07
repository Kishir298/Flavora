/** Local recipe database access (§5). The `recipes` table IS the source of
 * truth — no external fetch, no cache-freshness concerns. */
import { prisma } from "./db.js";
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

/** Cheap-swap lookup from the local `ingredient_substitutes` table (§4.3). */
export async function substitutesFor(ingredients: Recipe["ingredients"]): Promise<Record<string, string[]>> {
  const names = ingredients.map((i) => (typeof i === "string" ? i : i.name).toLowerCase());
  if (names.length === 0) return {};
  const rows = await prisma.ingredientSubstitute.findMany({});
  const out: Record<string, string[]> = {};
  for (const ing of ingredients) {
    const raw = typeof ing === "string" ? ing : ing.name;
    const key = rows.find((r) => raw.toLowerCase().includes(r.ingredientName.toLowerCase()));
    if (key) {
      const label = typeof ing === "string" ? ing : ing.name;
      out[label] = [...(out[label] ?? []), key.substituteName];
    }
  }
  return out;
}
