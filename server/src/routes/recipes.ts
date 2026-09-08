import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { getRecipeById, rowToRecipe, substitutesFor, flattenSubstitutions } from "../recipesDb.js";

export const recipesRouter = Router();

function ingredientDisplay(ing: string | { name: string; quantity?: number | null; unit?: string | null }): string {
  if (typeof ing === "string") return ing;
  const qty = ing.quantity ?? "";
  const unit = ing.unit ?? "";
  return `${qty} ${unit} ${ing.name}`.trim();
}

function toDetail(
  recipe: NonNullable<Awaited<ReturnType<typeof getRecipeById>>>,
  substitutionsDetailed: Awaited<ReturnType<typeof substitutesFor>>,
  owned?: string[]
) {
  const have = (owned ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const ingredients = recipe.ingredients.map((ing) => {
    const name = typeof ing === "string" ? ing : ing.name;
    const usedOwned = have.length > 0 && have.some((h) => name.toLowerCase().includes(h) || h.includes(name.toLowerCase()));
    return { ...(typeof ing === "string" ? { name: ing, quantity: null, unit: null } : ing), display: ingredientDisplay(ing), usedOwned };
  });
  return {
    id: recipe.id,
    title: recipe.title,
    cuisine: recipe.cuisine,
    cookTime: recipe.cookTimeMinutes,
    difficulty: recipe.difficulty,
    spiceLevel: recipe.spiceLevel,
    dietTags: recipe.dietTags,
    // Full ingredient list, always rendered in full (§4.4 — final manual allergy check).
    ingredients: ingredients.map((i) => i.display),
    ingredientDetails: ingredients,
    instructions: recipe.instructions,
    nutrition: recipe.nutrition,
    costTier: recipe.costTier,
    storage: recipe.storageTips,
    storageTips: recipe.storageTips,
    // Flat names (back-compat) + detailed options with notes.
    substitutions: flattenSubstitutions(substitutionsDetailed),
    substitutionDetails: substitutionsDetailed,
  };
}

recipesRouter.get("/:id", async (req, res, next) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const recipe = await getRecipeById(id);
    if (!recipe) return res.status(404).json({ error: "recipe not found" });

    await ensureProfileRow();
    const profileRow = await prisma.userProfile.findUnique({ where: { id: 1 } });
    const profile = profileRow
      ? {
          allergies: JSON.parse(profileRow.allergies) as string[],
          avoidFoods: JSON.parse(profileRow.avoidFoods) as string[],
        }
      : undefined;

    const substitutionsDetailed = await substitutesFor(recipe.ingredients, profile);
    const have =
      typeof req.query.have === "string" && req.query.have.length > 0
        ? req.query.have.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    await prisma.interaction.create({ data: { recipeId: id, action: "viewed" } });
    res.json(toDetail(recipe, substitutionsDetailed, have));
  } catch (e) {
    next(e);
  }
});

// Back-compat helper used by /api/saved in app.ts.
export async function savedRecipes(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.recipe.findMany({ where: { id: { in: ids } } });
  return rows.map((r) => toDetail(rowToRecipe(r), {}));
}
