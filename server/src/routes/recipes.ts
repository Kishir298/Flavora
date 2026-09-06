import { Router } from "express";
import { prisma } from "../db.js";
import { getRecipeById } from "../providers/recipes.js";
import { MOCK_RECIPES } from "../providers/mockData.js";

export const recipesRouter = Router();

// Cheap substitutions map (Phase 2 budget feature seed).
const SUBSTITUTIONS: Record<string, string[]> = {
  parmesan: ["nutritional yeast", "pecorino (if dairy ok)"],
  milk: ["oat milk", "water + 1 tsp oil"],
  butter: ["olive oil", "margarine"],
  chicken: ["chickpeas", "tofu"],
  pasta: ["rice", "zucchini noodles"],
  "peanut butter": ["sunflower seed butter (nut-free)", "tahini"],
};

function substitutionsFor(ingredients: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ing of ingredients) {
    const key = Object.keys(SUBSTITUTIONS).find((k) => ing.toLowerCase().includes(k));
    if (key) out[ing] = SUBSTITUTIONS[key];
  }
  return out;
}

recipesRouter.get("/:id", async (req, res, next) => {
  try {
    const id = decodeURIComponent(req.params.id);
    // 1. Local cache first (offline-friendly).
    const cached = await prisma.recipeCache.findUnique({ where: { id } });
    if (cached) {
      await prisma.interaction.create({ data: { recipeId: id, action: "viewed" } });
      return res.json({
        id: cached.id,
        source: cached.source,
        title: cached.title,
        cuisine: cached.cuisine,
        cookTime: cached.cookTime,
        nutrition: JSON.parse(cached.nutrition),
        ingredients: JSON.parse(cached.ingredients),
        instructions: JSON.parse(cached.instructions),
        image: cached.image,
        substitutions: substitutionsFor(JSON.parse(cached.ingredients)),
        storage: "Fridge 3 days in airtight container. Reheat to 165°F/74°C.",
        cached: true,
      });
    }
    // 2. Provider (mock fixtures cover no-key path).
    const recipe =
      (await getRecipeById(id)) ?? MOCK_RECIPES.find((r) => r.id === id) ?? null;
    if (!recipe) return res.status(404).json({ error: "recipe not found" });

    await prisma.recipeCache.upsert({
      where: { id: recipe.id },
      create: {
        id: recipe.id,
        source: recipe.source,
        title: recipe.title,
        cuisine: recipe.cuisine ?? "",
        cookTime: recipe.cookTime ?? 30,
        nutrition: JSON.stringify(recipe.nutrition ?? {}),
        ingredients: JSON.stringify(recipe.ingredients),
        instructions: JSON.stringify(recipe.instructions ?? []),
        image: recipe.image ?? "",
      },
      update: {},
    });
    await prisma.interaction.create({ data: { recipeId: id, action: "viewed" } });
    res.json({
      ...recipe,
      substitutions: substitutionsFor(recipe.ingredients),
      storage: "Fridge 3 days in airtight container. Reheat to 165°F/74°C.",
      cached: false,
    });
  } catch (e) {
    next(e);
  }
});
